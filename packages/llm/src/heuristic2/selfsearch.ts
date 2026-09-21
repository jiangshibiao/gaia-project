/**
 * 自我深搜（假设不碰撞）：只展开"我"的行动序列，对手用占位填充
 * （主阶段恒 pass、充能恒拒绝、其他 pending/决胜取 legal[0]）——
 * 成本与人数无关，分支只有我自己的 topK。
 *
 * 与 max^n 的权衡：搜索里对手不抢东西（乐观偏差——我计划拿的星球/板/格
 * 在实际对局中可能被抢），用两层对冲缓解：
 * - 根节点取「0.8×最优 + 0.2×次优」的加权值（brittle plan 降权）；
 * - 公共/限量资源（高级片/L5/行动格/联邦标记）在静态分里有抢占溢价
 *   （见 score.ts 的 contested 项——不抢下轮可能就没）。
 *
 * 叶估值 = evaluateState（仅我的视角，1 份评估而非 max^n 的 4 份）。
 */
import {
  applyAction,
  enumerateActions,
  type Action,
  type GameState,
  type PlayerIndex,
} from '@gaia/engine';
import type { Cfg, DeepPartial } from './cfg.js';
import { evalCtx } from './context.js';
import { evaluateState } from './position.js';
import { pruneCandidates, scoredActions, type ScoredAction } from './lookahead.js';

export interface SelfSearchResult {
  action: Action;
  value: number;
  nodes: number;
  staticScore: number;
}

/** 当前行动者（与 actorOf 同口径；game-over 返回 null）。 */
function actorOfState(state: GameState): PlayerIndex | null {
  if (state.phase === 'game-over') return null;
  const pending = state.pending;
  if (pending !== null) {
    if (pending.kind === 'charge') return pending.queue[0]?.player ?? null;
    return pending.player;
  }
  if (state.turnHold !== null) return state.turnHold;
  if (state.phase === 'setup') return state.setupQueue[0] ?? null;
  return state.currentPlayerIdx;
}

/** 深搜内跳过回合完成闸：confirm-turn 是记账步骤（主行动后的免费兑换本就不建模），
 *  持闸时自动确认——保持深搜与设闸前的行动序列语义一致。 */
function skipTurnHold(state: GameState, seat: PlayerIndex): GameState | null {
  if (state.turnHold !== seat) return state;
  try {
    return applyAction(state, { type: 'confirm-turn' }, { assumeLegal: true });
  } catch {
    return null;
  }
}

/**
 * 对手占位推进一步：主阶段恒 pass（保留当前助推器），充能恒拒绝，
 * 其余（pending 决胜/setup）取 legal[0]。返回 null 表示无法推进（防御）。
 */
function opponentFiller(state: GameState, actor: PlayerIndex): GameState | null {
  const pending = state.pending;
  if (pending?.kind === 'charge') {
    try {
      return applyAction(state, { type: 'decline-charge' }, { assumeLegal: true });
    } catch {
      return null;
    }
  }
  if (state.phase === 'action') {
    // 恒 pass：从供应取第一块助推器（不能续用同款，见 engine pass.ts），
    // 第 6 轮必须 null——直接构造，不做昂贵的合法行动枚举。
    const booster = state.round >= 6 ? null : (state.board.boosters[0] ?? null);
    try {
      return applyAction(state, { type: 'pass', booster }, { assumeLegal: true });
    } catch {
      return null;
    }
  }
  // setup / 其他 pending：取 legal[0]。
  const legal = enumerateActions(state, actor);
  const first = legal[0];
  if (first === undefined) return null;
  try {
    return applyAction(state, first, { assumeLegal: true });
  } catch {
    return null;
  }
}

/** 快进到我的下一个决策点（对手全部占位）；返回 null 表示推进失败/终局。 */
function fastForwardToMe(state: GameState, seat: PlayerIndex): GameState | null {
  let s = state;
  for (let guard = 0; guard < 64; guard++) {
    const actor = actorOfState(s);
    if (actor === null) return s; // 终局
    if (actor === seat) return s;
    const next = opponentFiller(s, actor);
    if (next === null) return null;
    s = next;
  }
  return null;
}

interface SelfSearchState {
  nodes: number;
  budget: number;
  caps: readonly number[];
  myDepth: number;
  overrides: DeepPartial<Cfg> | undefined;
}

function capAt(caps: readonly number[], ply: number): number {
  return caps[Math.min(ply, caps.length - 1)]!;
}

/**
 * 自我深搜递归：返回"从该局面（轮到我）出发，我还能拿到的最优叶值"。
 * 每个我的决策点：静态评分 + 域帽 + 层帽剪枝，候选间取 max。
 */
function selfSearch(state: GameState, seat: PlayerIndex, myPly: number, st: SelfSearchState): number {
  if (state.phase === 'game-over' || myPly >= st.myDepth || st.nodes >= st.budget) {
    return evaluateState(state, seat, st.overrides);
  }
  st.nodes++;
  const ctx = evalCtx(state, seat, st.overrides);
  const legal = enumerateActions(state, seat);
  if (legal.length === 0) return evaluateState(state, seat, st.overrides);
  const candidates = pruneCandidates(ctx, scoredActions(ctx, legal)).slice(
    0,
    capAt(st.caps, myPly),
  );
  let best = -Infinity;
  for (const c of candidates) {
    let s1: GameState | null;
    try {
      s1 = skipTurnHold(applyAction(state, c.action, { assumeLegal: true }), seat);
    } catch {
      continue;
    }
    if (s1 === null) continue;
    // 行动后可能仍是我的决策点（免费行动/连锁），也可能轮到对手——快进到
    // 我的下一个决策点。沿途状态取我的叶估值与递归值的较大者（行动序列
    // 任意前缀都可以是"停止规划"的选择）。
    const stillMe = actorOfState(s1) === seat;
    const next = stillMe ? s1 : fastForwardToMe(s1, seat);
    const here = evaluateState(s1, seat, st.overrides);
    let v: number;
    if (next === null) {
      v = here;
    } else {
      v = Math.max(here, selfSearch(next, seat, myPly + 1, st));
    }
    if (v > best) best = v;
    if (st.nodes >= st.budget) break;
  }
  return best === -Infinity ? evaluateState(state, seat, st.overrides) : best;
}

/**
 * 自我深搜选行动：根候选各自深搜，根值 = 0.8×最优 + 0.2×次优
 * （对 brittle plan 的对冲——不碰撞假设下过于依赖单一路径的候选降权）。
 * 平局裁决：加权值降序 → 静态分降序（确定性）。
 */
export function chooseWithSelfSearch(
  state: GameState,
  seat: PlayerIndex,
  scored: ScoredAction[],
  cfg: Cfg,
  overrides?: DeepPartial<Cfg>,
): SelfSearchResult {
  const ctx = evalCtx(state, seat, overrides);
  const candidates = pruneCandidates(ctx, scored).slice(0, capAt(cfg.selfSearch.caps, 0));
  const st: SelfSearchState = {
    nodes: 0,
    budget: cfg.selfSearch.nodeBudget,
    caps: cfg.selfSearch.caps,
    myDepth: cfg.selfSearch.depth,
    overrides,
  };
  // 每个根候选的深搜值；随后做 top-2 加权。
  const valued: { c: ScoredAction; v: number }[] = [];
  for (const c of candidates) {
    let s1: GameState | null = null;
    try {
      s1 = skipTurnHold(applyAction(state, c.action, { assumeLegal: true }), seat);
      st.nodes++;
    } catch {
      continue;
    }
    if (s1 === null) continue;
    const stillMe = actorOfState(s1) === seat;
    const next = stillMe ? s1 : fastForwardToMe(s1, seat);
    const here = evaluateState(s1, seat, overrides);
    const v = next === null ? here : Math.max(here, selfSearch(next, seat, 1, st));
    valued.push({ c, v });
    if (st.nodes >= st.budget) break;
  }
  valued.sort((a, b) => b.v - a.v || b.c.score - a.c.score);
  const best = valued[0];
  if (best === undefined) {
    const fallback = scored[0]!;
    return { action: fallback.action, value: fallback.score, nodes: st.nodes, staticScore: fallback.score };
  }
  const second = valued[1];
  const hedge = cfg.selfSearch.secondWeight;
  const value = second === undefined ? best.v : (1 - hedge) * best.v + hedge * second.v;
  return {
    action: best.c.action,
    value,
    nodes: st.nodes,
    staticScore: best.c.score,
  };
}
