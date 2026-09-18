/**
 * 2-ply 前瞻 + 候选剪枝（参照 BrassBirmingham heuristic-core 的主循环）：
 *
 * 1. scoreAction 给全部 legal 打分排序；
 * 2. 按行动域 topK 剪枝（Brass 经验：K 过大反而更差——噪声候选挤掉好候选）；
 * 3. 每个候选用 applyAction(assumeLegal) 真实仿真：
 *    - 若仿真后仍是我方行动（免费行动/连锁决策）→ value += alpha × max(0, 次动分)；
 *    - value += leafWeight × evaluatePosition(结果局面)（绝对局面值，候选间比较
 *      天然是差分——行动分之外的长期后果由叶估值捕捉）；
 * 4. 取 max；仿真失败的候选退回静态分。
 */
import {
  applyAction,
  enumerateActions,
  stableStringify,
  type Action,
  type GameState,
  type PlayerIndex,
} from '@gaia/engine';
import type { Cfg, DeepPartial } from './cfg.js';
import { evalCtx, type EvalCtx } from './context.js';
import { evaluateState } from './position.js';
import { scoreAction } from './score.js';

export interface ScoredAction {
  action: Action;
  index: number;
  score: number;
}

/** 评分兜底：单个行动评分抛异常记 −1e9 排末位（decide 对任何 legal 不抛）。 */
export function safeScore(ctx: EvalCtx, action: Action): number {
  try {
    return scoreAction(ctx, action);
  } catch {
    return -1e9;
  }
}

/** 全部合法行动打分 + 确定性排序（分降序 → stableStringify 字典序 → 原 index）。 */
export function scoredActions(ctx: EvalCtx, legal: Action[]): ScoredAction[] {
  return legal
    .map((action, index) => ({ action, index, score: safeScore(ctx, action) }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        stableStringify(a.action).localeCompare(stableStringify(b.action)) ||
        a.index - b.index,
    );
}

/** 行动域（剪枝粒度）。 */
function domainOf(action: Action): keyof Cfg['lookahead']['topK'] {
  switch (action.type) {
    case 'build-mine':
    case 'free-mine':
      return 'mine';
    case 'upgrade':
      return 'upgrade';
    case 'research':
      return 'research';
    case 'form-federation':
      return 'federation';
    case 'power-action':
    case 'qic-action':
      return 'board';
    case 'special-action':
      return 'special';
    case 'ship-action':
    case 'inspect-artifact':
      return 'ship';
    case 'start-gaia-project':
      return 'gaia';
    case 'explore-ship':
      return 'explore';
    case 'pass':
      return 'pass';
    case 'free-conversion':
    case 'burn':
      return 'free';
    case 'place-initial-mine':
    case 'choose-booster':
      return 'setup';
    default:
      return 'misc';
  }
}

/** 按行动域 topK 剪枝（输入已排序；free 域只留正分——负分转换仿真无意义）。 */
export function pruneCandidates(ctx: EvalCtx, scored: ScoredAction[]): ScoredAction[] {
  const k = ctx.cfg.lookahead.topK;
  const counts: Record<string, number> = {};
  const out: ScoredAction[] = [];
  for (const s of scored) {
    const d = domainOf(s.action);
    const cap = k[d];
    const used = counts[d] ?? 0;
    if (used >= cap) continue;
    if (d === 'free' && s.score < -0.05) continue;
    counts[d] = used + 1;
    out.push(s);
  }
  return out;
}

/** 仿真后仍是我方行动？（pending 响应/setup 队首/当前行动者，与 actorOf 同口径）。 */
function stillMyTurn(state: GameState, seat: PlayerIndex): boolean {
  if (state.phase === 'game-over') return false;
  const pending = state.pending;
  if (pending !== null) {
    if (pending.kind === 'charge') return pending.queue[0]?.player === seat;
    return pending.player === seat;
  }
  if (state.phase === 'setup') return state.setupQueue[0] === seat;
  return state.currentPlayerIdx === seat;
}

/** 次动最佳静态分（stillMyTurn 时调用；无合法行动返回 null）。 */
function bestFollowUpScore(
  state: GameState,
  seat: PlayerIndex,
  overrides: DeepPartial<Cfg> | undefined,
): number | null {
  const legal = enumerateActions(state, seat);
  if (legal.length === 0) return null;
  const ctx = evalCtx(state, seat, overrides);
  let best = -Infinity;
  for (const a of legal) best = Math.max(best, safeScore(ctx, a));
  return best;
}

export interface LookaheadResult {
  action: Action;
  value: number;
  /** 决策轨迹用：静态分、是否走了仿真。 */
  staticScore: number;
  simulated: boolean;
}

/**
 * 前瞻主循环：对剪枝后的候选逐一仿真求值，取 value 最大者。
 * 全部候选仿真都失败时退回静态 Top-1（scored[0]，调用方保证非空）。
 */
export function chooseWithLookahead(
  ctx: EvalCtx,
  scored: ScoredAction[],
  overrides?: DeepPartial<Cfg>,
): LookaheadResult {
  const candidates = pruneCandidates(ctx, scored);
  const la = ctx.cfg.lookahead;
  let best: LookaheadResult | null = null;
  for (const c of candidates) {
    let value = c.score;
    let simulated = false;
    try {
      const s1 = applyAction(ctx.state, c.action, { assumeLegal: true });
      simulated = true;
      if (stillMyTurn(s1, ctx.seat)) {
        const follow = bestFollowUpScore(s1, ctx.seat, overrides);
        if (follow !== null && follow > 0) value += la.alpha * follow;
      }
      value += la.leafWeight * evaluateState(s1, ctx.seat, overrides);
    } catch {
      // 仿真失败：退回静态分（不含叶估值，候选间仍可比——都退回时退化为静态排序）。
    }
    if (best === null || value > best.value) {
      best = { action: c.action, value, staticScore: c.score, simulated };
    }
  }
  const fallback = scored[0]!;
  return best ?? { action: fallback.action, value: fallback.score, staticScore: fallback.score, simulated: false };
}
