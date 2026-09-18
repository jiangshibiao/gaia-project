/**
 * bench 异步整局驱动——engine `playGame`（agents/random.ts）的 async 变体。
 *
 * playGame 只接受同步 PlayerAgent，驱动不了 async DecidingAgent（LLMAgent 要
 * 等 HTTP）。循环体与 playGame 同构（newGame → actingPlayer → enumerateActions
 * → decide → applyAction → 记 log，同 MAX_STEPS 防御上限 + settleSetupSkips
 * 跳过 setup 空枚举），座位注入 DecidingAgent[]，HeuristicAgent / LLMAgent /
 * 插件包装（registry.createAgent）同接口，天然支持混编对局。
 *
 * 每步顺手记 DecisionTrace：除决策结果（chosen/reason/degraded/usage）外，
 * 记录 chosenRank（所选在 scoreAction 降序中的名次，0 = 启发式最优）与
 * heuristicTop（启发式最优描述）——失败分析的对照锚点。
 */
import {
  applyAction,
  enumerateActions,
  newGame,
  settleSetupSkips,
  stableStringify,
  type Action,
  type GameConfig,
  type GameState,
  type PlayerIndex,
} from '@gaia/engine';
import type { DecidingAgent } from '../src/decision.js';
import { scoreAction } from '../src/heuristic.js';
import { describeAction } from '../src/summarize.js';

/** 单步决策记录（games.jsonl 之外另落 decisions.jsonl）。 */
export interface DecisionTrace {
  seq: number;
  seat: PlayerIndex;
  phase: GameState['phase'];
  round: number;
  /** 合法行动总数（LLM 的候选为其中 prescreen TopK）。 */
  legalCount: number;
  /** 所选行动在 scoreAction 降序名次（0 起；-1 = 不在 legal 内，不应出现）。 */
  chosenRank: number;
  /** 启发式最优行动描述（对照锚点）。 */
  heuristicTop: string;
  /** 所选行动描述。 */
  chosen: string;
  reason: string;
  degraded: boolean;
  usage: { inputTokens: number; outputTokens: number };
}

export interface DrivenGame {
  seed: number;
  /** 终局状态（VP/胜者在 state.players[*].vp 与 state.winner）。 */
  state: GameState;
  /** 完整 action log：newGame(同 config) + 逐条 applyAction 可纯重放。 */
  log: Action[];
  decisions: DecisionTrace[];
}

/** 与 playGame 同一防御上限：正常对局远小于此，超限即引擎死循环。 */
const MAX_STEPS = 100_000;

/** 当前应行动的玩家（与 engine playGame 同口径：pending 响应者 > setup 队首 > 当前回合玩家）。 */
function actingPlayer(state: GameState): PlayerIndex {
  const pending = state.pending;
  if (pending !== null) {
    return pending.kind === 'charge' ? pending.queue[0]!.player : pending.player;
  }
  if (state.phase === 'setup') {
    return state.setupQueue[0]!;
  }
  return state.currentPlayerIdx;
}

/**
 * 所选行动在 scoreAction 降序中的名次与启发式最优（对照锚点）。
 * 引用比较优先，退化稳定序列化比较。
 */
export function rankOf(
  state: GameState,
  player: PlayerIndex,
  legal: Action[],
  chosen: Action,
): { rank: number; top: Action } {
  const scored = legal
    .map((action, index) => ({ action, index, score: scoreAction(state, player, action) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        stableStringify(a.action).localeCompare(stableStringify(b.action)) ||
        a.index - b.index,
    );
  let rank = scored.findIndex((x) => x.action === chosen);
  if (rank === -1) {
    const key = stableStringify(chosen);
    rank = scored.findIndex((x) => stableStringify(x.action) === key);
  }
  return { rank, top: scored[0]!.action };
}

/**
 * 异步驱动一整局。agents 长度须等于 config.playerCount；decide 抛异常向上传
 * （LLMAgent 内部有降级兜底不抛；驱动层不吞错——bench 要暴露真问题）。
 */
export async function driveGame(
  config: GameConfig,
  agents: DecidingAgent[],
): Promise<DrivenGame> {
  let state = newGame(config);
  if (agents.length !== state.config.playerCount) {
    throw new Error(`driveGame: need ${state.config.playerCount} agents, got ${agents.length}`);
  }
  const log: Action[] = [];
  const decisions: DecisionTrace[] = [];
  let steps = 0;
  while (state.phase !== 'game-over') {
    const actor = actingPlayer(state);
    const legal = enumerateActions(state, actor);
    if (legal.length === 0) {
      // setup 队首无合法行动（ivits/LF 新族在 mines 阶段）：跳过该玩家。
      const settled = settleSetupSkips(state);
      if (settled !== state) {
        state = settled;
        continue;
      }
      throw new Error(
        `driveGame: no legal actions for player ${actor} ` +
          `(seed ${config.seed}, step ${steps}, phase ${state.phase}, round ${state.round})`,
      );
    }
    const d = await agents[actor]!.decide(state, actor, legal);
    const { rank, top } = rankOf(state, actor, legal, d.action);
    decisions.push({
      seq: steps,
      seat: actor,
      phase: state.phase,
      round: state.round,
      legalCount: legal.length,
      chosenRank: rank,
      heuristicTop: describeAction(state, actor, top),
      chosen: describeAction(state, actor, d.action),
      reason: d.reason,
      degraded: d.degraded,
      usage: d.usage ?? { inputTokens: 0, outputTokens: 0 },
    });
    state = applyAction(state, d.action);
    log.push(d.action);
    if (++steps > MAX_STEPS) {
      throw new Error(
        `driveGame: exceeded ${MAX_STEPS} steps without game-over (seed ${config.seed})`,
      );
    }
  }
  return { seed: config.seed, state, log, decisions };
}
