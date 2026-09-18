/**
 * bench CLI：自对弈跑批 + 汇总。手动跑（烧 token，不进 CI）：
 *
 *   npm run bench -w @gaia/llm -- \
 *     --agents heuristic,random --games 10 --mirror --concurrency 4
 *
 * 参数：
 *   --agents spec     座位配置，逗号分隔：插件名（heuristic / random /
 *                     first-legal）或 `llm:<easy|normal|hard>`。人数 = spec 项数。
 *   --games N         种子数（默认 10）；种子 = seed-base + i。
 *   --seed-base S     种子起点（默认 1），同种子集跨轮可比。
 *   --mirror          每个种子换边再跑一局（默认开；--no-mirror 关）——消除
 *                     先手/座位/种族偏差，对比必备。
 *   --concurrency K   局间并行（默认 4；局内行动天然串行。网关限流别调高）。
 *   --out dir         输出目录（默认 bench/out/run-<时间戳>，bench/out/ 已 gitignore）。
 *   --factions mode   default=固定种族池（跨轮可比）| random=按种子从全集抽取
 *                     （内战均分覆盖面更广，评估 AI 通用强度用）。
 *   --no-lf           关闭 Lost Fleet 扩展（验证 base 变体差异用，默认开）。
 *
 * LLM 座位需要 ANTHROPIC_API_KEY（经 AnthropicClient，走 ANTHROPIC_BASE_URL
 * 网关）；纯插件对局不需要 key，免费秒级。
 * 汇总：各标签胜率（平局各记 0.5）、平均 VP、平均 VP 差、degraded 率、token。
 */
import type { FactionId, PlayerIndex } from '@gaia/engine';
import { createRng } from '@gaia/engine';
import { AnthropicClient } from '../src/client.js';
import type { DecidingAgent } from '../src/decision.js';
import { createAgent } from '../src/agents/registry.js';
import { LLMAgent, type Difficulty } from '../src/llm-agent.js';
import { driveGame } from './drive-game.js';
import { TraceWriter, gameRecord, type GameRecord } from './trace.js';

interface CliOptions {
  agentSpecs: string[];
  games: number;
  seedBase: number;
  mirror: boolean;
  concurrency: number;
  outDir: string;
  /** 种族池：default=固定池（跨轮可比）；random=按种子从全集抽取（内战均分覆盖更广）。 */
  factions: 'default' | 'random';
  /** Lost Fleet 扩展开关（默认开；--no-lf 关——验证变体差异用）。 */
  lostFleet: boolean;
}

const DIFFICULTIES = new Set(['easy', 'normal', 'hard']);
const PLUGIN_SPECS = new Set(['heuristic', 'heuristic2', 'random', 'first-legal']);

/** bench 默认种族池（固定便于跨轮可比；镜像换边消除种族偏差）。 */
const DEFAULT_FACTIONS: Record<number, FactionId[]> = {
  2: ['terrans', 'xenos'],
  3: ['terrans', 'xenos', 'geodens'],
  4: ['terrans', 'xenos', 'geodens', 'itars'],
};

/** 环境变量可覆盖固定池（逗号分隔，须与人数一致）——强势池/指定组合测试用。 */
function defaultFactions(playerCount: number): FactionId[] {
  const raw = process.env['GAIA_BENCH_FACTIONS'];
  if (raw !== undefined && raw !== '') {
    const list = raw.split(',') as FactionId[];
    if (list.length !== playerCount) {
      throw new Error(`GAIA_BENCH_FACTIONS 须 ${playerCount} 个族，收到 ${list.length}`);
    }
    return list;
  }
  const pool = DEFAULT_FACTIONS[playerCount];
  if (pool === undefined) throw new Error(`不支持的人数: ${playerCount}`);
  return pool;
}

const BASE_FACTION_POOL: FactionId[] = [
  'terrans', 'lantids', 'xenos', 'gleens', 'taklons', 'ambas', 'hadsch-hallas',
  'ivits', 'geodens', 'baltaks', 'firaks', 'bescods', 'nevlas', 'itars',
];
const LF_FACTION_POOL: FactionId[] = [
  ...BASE_FACTION_POOL, 'tinkeroids', 'darkanians', 'moweyds', 'space-giants',
];

/** 按种子从种族全集无重复抽取 playerCount 个（random 模式）。 */
function randomFactions(seed: number, playerCount: number, lostFleet: boolean): FactionId[] {
  const pool = lostFleet ? LF_FACTION_POOL : BASE_FACTION_POOL;
  return createRng(seed * 7919 + 17).shuffle(pool).slice(0, playerCount);
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    agentSpecs: ['heuristic', 'random'],
    games: 10,
    seedBase: 1,
    mirror: true,
    concurrency: 4,
    outDir: `bench/out/run-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    factions: 'default',
    lostFleet: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const take = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} 缺参数值`);
      return v;
    };
    switch (arg) {
      case '--agents':
        opts.agentSpecs = take().split(',');
        break;
      case '--games':
        opts.games = Number(take());
        break;
      case '--seed-base':
        opts.seedBase = Number(take());
        break;
      case '--mirror':
        opts.mirror = true;
        break;
      case '--no-mirror':
        opts.mirror = false;
        break;
      case '--concurrency':
        opts.concurrency = Number(take());
        break;
      case '--out':
        opts.outDir = take();
        break;
      case '--factions': {
        const v = take();
        if (v !== 'default' && v !== 'random') throw new Error(`--factions 只支持 default|random，收到 ${v}`);
        opts.factions = v;
        break;
      }
      case '--no-lf':
        opts.lostFleet = false;
        break;
      case '--help':
        console.log('见本文件头注释。');
        process.exit(0);
      default:
        throw new Error(`未知参数: ${arg}（--help 看用法）`);
    }
  }
  if (!Number.isInteger(opts.games) || opts.games < 1) {
    throw new Error(`--games 须为正整数，收到 ${opts.games}`);
  }
  if (
    !Number.isInteger(opts.concurrency) ||
    opts.concurrency < 1 ||
    opts.concurrency > 16
  ) {
    throw new Error(`--concurrency 须为 1..16，收到 ${opts.concurrency}`);
  }
  if (opts.agentSpecs.length < 2 || opts.agentSpecs.length > 4) {
    throw new Error(`--agents 须为 2..4 个座位，收到 ${opts.agentSpecs.length}`);
  }
  for (const spec of opts.agentSpecs) {
    if (PLUGIN_SPECS.has(spec)) continue;
    const m = /^llm:([a-z]+)$/.exec(spec);
    if (!m || !DIFFICULTIES.has(m[1]!)) {
      throw new Error(
        `未知 agent: ${spec}（支持 ${[...PLUGIN_SPECS].join('/')} / llm:easy|normal|hard）`,
      );
    }
  }
  return opts;
}

/** agent 工厂：LLM 座位共用一个 AnthropicClient（无状态）；插件座位走 registry。 */
function makeAgents(specs: string[]): { agents: DecidingAgent[]; labels: string[] } {
  const needsLLM = specs.some((s) => s.startsWith('llm:'));
  // 网关环境可能用 AUTH_TOKEN 而非 API_KEY（SDK 两者皆认）——都放行。
  const authed =
    (process.env['ANTHROPIC_API_KEY'] ?? '') !== '' ||
    (process.env['ANTHROPIC_AUTH_TOKEN'] ?? '') !== '';
  if (needsLLM && !authed) {
    throw new Error(
      '含 llm 座位须设 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN（纯插件对局不需要）',
    );
  }
  const client = needsLLM ? new AnthropicClient() : null;
  const agents = specs.map((spec, seat): DecidingAgent => {
    if (spec.startsWith('llm:')) {
      return new LLMAgent(client!, spec.slice(4) as Difficulty);
    }
    return createAgent(`builtin:${spec}`, { seat: seat as PlayerIndex });
  });
  return { agents, labels: [...specs] };
}

interface GameTask {
  seed: number;
  mirrored: boolean;
  /** 本局座位顺序（镜像局 = 基准座位反转）。 */
  order: number[];
}

function summarize(records: GameRecord[], labels: string[]): void {
  console.log('\n========== bench 汇总 ==========');
  console.log(`总局数: ${records.length}`);
  const unique = [...new Set(labels)];
  for (const label of unique) {
    let games = 0;
    let wins = 0;
    let vpSum = 0;
    let marginSum = 0;
    let degraded = 0;
    let decisions = 0;
    let input = 0;
    let output = 0;
    for (const r of records) {
      r.seatLabels.forEach((l, seat) => {
        if (l !== label) return;
        games++;
        if (r.winner === null) wins += 0.5;
        else if (r.winner === seat) wins += 1;
        const vp = r.vps[seat]!;
        const others = r.vps.filter((_, i) => i !== seat);
        vpSum += vp;
        marginSum += vp - Math.max(...others);
        degraded += r.degraded[seat]!;
        decisions += r.decisions[seat]!;
        input += r.usage[seat]!.inputTokens;
        output += r.usage[seat]!.outputTokens;
      });
    }
    console.log(
      `${label}: 胜率 ${((wins / games) * 100).toFixed(1)}% (${wins}/${games})` +
        ` | 平均VP ${(vpSum / games).toFixed(1)}` +
        ` | 平均VP差 ${(marginSum / games).toFixed(1)}` +
        ` | degraded ${((degraded / Math.max(1, decisions)) * 100).toFixed(1)}%` +
        ` | token in=${input} out=${output}`,
    );
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const playerCount = opts.agentSpecs.length;
  const fixedFactions = defaultFactions(playerCount);
  const { agents, labels } = makeAgents(opts.agentSpecs);
  const writer = new TraceWriter(opts.outDir);

  const tasks: GameTask[] = [];
  for (let i = 0; i < opts.games; i++) {
    const seed = opts.seedBase + i;
    const base = agents.map((_, seat) => seat);
    tasks.push({ seed, mirrored: false, order: base });
    if (opts.mirror) tasks.push({ seed, mirrored: true, order: [...base].reverse() });
  }

  console.log(
    `[bench] ${tasks.length} 局（${opts.games} 种子${opts.mirror ? ' × 镜像' : ''}），` +
      `座位 ${labels.join(' vs ')}，并发 ${opts.concurrency}，输出 ${opts.outDir}`,
  );

  const records: GameRecord[] = [];
  let next = 0;
  let done = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const task = tasks[next++]!;
      const started = Date.now();
      // 每局重新构造 agent 实例，杜绝跨局隐式状态（当前实现均无状态，防御性）。
      const { agents: seatAgents } = makeAgents(
        task.order.map((seat) => opts.agentSpecs[seat]!),
      );
      const seatLabels = task.order.map((seat) => labels[seat]!);
      const game = await driveGame(
        {
          playerCount,
          seed: task.seed,
          factions:
            opts.factions === 'random'
              ? randomFactions(task.seed, playerCount, opts.lostFleet)
              : fixedFactions,
          lostFleet: opts.lostFleet,
        },
        seatAgents,
      );
      const record = gameRecord(game, seatLabels, task.mirrored, Date.now() - started);
      for (const d of game.decisions) {
        writer.decision({ ...d, seed: task.seed, mirrored: task.mirrored });
      }
      writer.game(record);
      records.push(record);
      done++;
      const vps = record.vps.map((v, i) => `P${i}(${seatLabels[i]})=${v}`).join(' ');
      console.log(
        `[bench ${done}/${tasks.length}] seed=${task.seed}` +
          `${task.mirrored ? ' 镜像' : ''} ${vps} 胜者=${record.winner ?? '平'}` +
          ` (${(record.durationMs / 1000).toFixed(0)}s)`,
      );
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(opts.concurrency, tasks.length) }, worker),
  );

  summarize(records, labels);
}

main().catch((e: unknown) => {
  console.error('[bench] 失败', e);
  process.exit(1);
});
