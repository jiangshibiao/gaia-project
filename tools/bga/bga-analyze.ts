/**
 * BGA 日志统计分析：从 reference/bga-cache/logs/*.json 蒸馏人类对局特征，
 * 用于校准 AI 估价（联邦数/形状、建造与研究路径、ELO-分数分布、上船时点）。
 *
 *   npx vite-node tools/bga/bga-analyze.ts [--min-elo 0]
 *
 * 输出：聚合统计（不写文件）；--csv 时把每局一行写到 data/bga/game-stats.csv。
 * 事件口径见 tools/bga/README.md（packet.data[].type/args）。
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CACHE = join(__dirname, '..', '..', 'reference', 'bga-cache');

interface Packet {
  data?: { type?: string; log?: string; args?: Record<string, unknown> }[];
}
interface LogFile {
  dead?: boolean;
  data?: { logs?: Packet[]; players?: Record<string, { name?: string }> };
}
interface TableInfo {
  data?: {
    result?: { player?: { player_id: string; name: string; score: string; rank_after_game: string }[] };
    options?: Record<string, { name: string; value: string }>;
  };
}

interface GameStats {
  tableId: string;
  lf: boolean;
  playerCount: number;
  elos: number[];
  scores: number[];
  maxScore: number;
  federations: number; // 全局组建联邦次数
  fedPerPlayer: number;
  gaiaProjects: number;
  builds: number;
  upgrades: number;
  researches: number;
  charges: number;
  shipExplores: number; // LF 上船次数（事件名待确认，暂按关键词匹配）
  turns: number;
}

const BUILDING_NAMES: Record<string, string> = {
  '1': 'gaiaformer', '2': 'gaiaformer?', '4': 'mine', '5': 'ts', '6': 'lab', '7': 'pi', '8': 'ac1', '9': 'ac2',
};

function analyzeOne(id: string): GameStats | null {
  const logPath = join(CACHE, 'logs', `${id}.json`);
  if (!existsSync(logPath)) return null;
  const raw = JSON.parse(readFileSync(logPath, 'utf8')) as LogFile;
  if (raw.dead === true || raw.data?.logs === undefined) return null;
  const infoPath = join(CACHE, 'infos', `${id}.json`);
  const info: TableInfo | null = existsSync(infoPath)
    ? (JSON.parse(readFileSync(infoPath, 'utf8')) as TableInfo)
    : null;
  const players = info?.data?.result?.player ?? [];
  const lf = Object.values(info?.data?.options ?? {}).some(
    (o) => /lost fleet|舰队/i.test(o.name) && o.value !== '0' && !/^off$/i.test(o.value),
  );
  const s: GameStats = {
    tableId: id,
    lf,
    playerCount: players.length || 0,
    elos: players.map((p) => Math.round(Number(p.rank_after_game))),
    scores: players.map((p) => Number(p.score)),
    maxScore: Math.max(0, ...players.map((p) => Number(p.score))),
    federations: 0,
    fedPerPlayer: 0,
    gaiaProjects: 0,
    builds: 0,
    upgrades: 0,
    researches: 0,
    charges: 0,
    shipExplores: 0,
    turns: 0,
  };
  for (const packet of raw.data.logs) {
    for (const d of packet.data ?? []) {
      switch (d.type) {
        case 'notifyFormFederation':
          s.federations++;
          break;
        case 'notifyStartGaia':
          s.gaiaProjects++;
          break;
        case 'notifyBuild':
          s.builds++;
          break;
        case 'notifyUpgrade':
          s.upgrades++;
          break;
        case 'notifyResearch':
          s.researches++;
          break;
        case 'notifyChargePower':
          s.charges++;
          break;
        case 'notifyPass':
          s.turns++;
          break;
        default:
          // 行动编号按规则书口径：11=探索飞船、12=检视神器（其余 1-10 为研究板行动格）。
          if (d.type === 'notifyAction' && d.args?.actionId === 11) s.shipExplores++;
      }
    }
  }
  s.fedPerPlayer = s.playerCount > 0 ? s.federations / s.playerCount : 0;
  return s;
}

function main(): void {
  const args = process.argv.slice(2);
  const minEloIdx = args.indexOf('--min-elo');
  const minElo = minEloIdx >= 0 ? Number(args[minEloIdx + 1]) : 0;
  const dir = join(CACHE, 'logs');
  if (!existsSync(dir)) {
    console.log('无日志缓存');
    return;
  }
  const all: GameStats[] = [];
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const s = analyzeOne(f.replace('.json', ''));
    if (s !== null && (minElo <= 0 || Math.max(...s.elos) >= minElo)) all.push(s);
  }
  if (all.length === 0) {
    console.log('缓存中无可分析日志');
    return;
  }
  const avg = (f: (s: GameStats) => number): string =>
    (all.reduce((a, s) => a + f(s), 0) / all.length).toFixed(2);
  const lfGames = all.filter((s) => s.lf);
  console.log(`局数 ${all.length}（LF ${lfGames.length}）`);
  console.log(`均分 ${avg((s) => s.scores.reduce((a, b) => a + b, 0) / Math.max(1, s.scores.length))} | 场均最高 ${avg((s) => s.maxScore)}`);
  console.log(`联邦/局 ${avg((s) => s.federations)} | 联邦/人 ${avg((s) => s.fedPerPlayer)}`);
  console.log(`盖亚计划/局 ${avg((s) => s.gaiaProjects)} | 建矿 ${avg((s) => s.builds)} | 升级 ${avg((s) => s.upgrades)} | 研究 ${avg((s) => s.researches)}`);
  console.log(`充能接受 ${avg((s) => s.charges)} | 上船 ${avg((s) => s.shipExplores)}`);
  if (args.includes('--csv')) {
    const head = 'tableId,lf,pc,maxElo,scores,feds,gaia,builds,upgrades,researches,charges,ships\n';
    const rows = all
      .map((s) =>
        [s.tableId, s.lf ? 1 : 0, s.playerCount, Math.max(...s.elos), s.scores.join('/'), s.federations, s.gaiaProjects, s.builds, s.upgrades, s.researches, s.charges, s.shipExplores].join(','),
      )
      .join('\n');
    const out = join(__dirname, '..', '..', 'data', 'bga', 'game-stats.csv');
    writeFileSync(out, head + rows + '\n');
    console.log(`已写 ${out}`);
  }
}

main();
