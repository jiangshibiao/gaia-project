/**
 * 确定性深搜（max^n，非 MCTS）：每个节点由当前行动者按"自己的叶估值最大"
 * 选行动，根节点取根座位视角的值向量做决策。盖亚无隐藏信息且引擎确定，
 * 深搜让联邦/高级片/L5/计分板等竞争性资源首次以真实对抗进入估值——
 * 静态估价最大的盲区（"不拿就被对手拿"）由此闭合。
 *
 * 成本控制：
 * - 候选剪枝沿用静态评分 + 按行动域 topK（随深度衰减 caps[depth]）；
 * - 节点预算 nodeBudget 封顶（确定性：按节点数而非墙钟，超预算的子树直接
 *   取叶估值——同局面同决策，回放可复现）；
 * - 叶估值 = evaluateState 全座位向量（max^n 需要每个行动者自己的分量）。
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
import { evalCtx } from './context.js';
import { evaluateState } from './position.js';
import { pruneCandidates, scoredActions, type ScoredAction } from './lookahead.js';

export interface SearchResult {
  action: Action;
  /** 根座位视角的搜索值。 */
  value: number;
  nodes: number;
  /** 根候选的静态分（决策轨迹用）。 */
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

interface SearchState {
  nodes: number;
  budget: number;
  caps: readonly number[];
  depth: number;
  overrides: DeepPartial<Cfg> | undefined;
}

/** 按层数（离根距离）衰减的候选帽：caps[ply]（超出数组取末位）。 */
function capAt(caps: readonly number[], ply: number): number {
  return caps[Math.min(ply, caps.length - 1)]!;
}

/** 值向量叶估值（每座位一个分量；预算耗尽或到达深度上限/终局时调用）。 */
function leafVector(
  state: GameState,
  playerCount: number,
  overrides: DeepPartial<Cfg> | undefined,
): number[] {
  const out: number[] = [];
  for (let seat = 0; seat < playerCount; seat++) {
    out.push(evaluateState(state, seat, overrides));
  }
  return out;
}

/**
 * max^n 递归：返回值向量（每座位一个分量）。
 * 当前行动者在自己的分量上取 max；预算耗尽时退化为叶估值。
 */
function searchNode(state: GameState, depthLeft: number, st: SearchState): number[] {
  const playerCount = state.players.length;
  const actor = actorOfState(state);
  if (actor === null || depthLeft <= 0 || st.nodes >= st.budget) {
    return leafVector(state, playerCount, st.overrides);
  }
  st.nodes++;
  const ctx = evalCtx(state, actor, st.overrides);
  const legal = enumerateActions(state, actor);
  if (legal.length === 0) return leafVector(state, playerCount, st.overrides);
  const cap = capAt(st.caps, st.depth - depthLeft);
  // 静态评分排序后按深度帽剪枝（pruneCandidates 的域帽可能更严，取两者小）。
  const scored = scoredActions(ctx, legal);
  const candidates = pruneCandidates(ctx, scored).slice(0, cap);
  let best: number[] | null = null;
  for (const c of candidates) {
    let s1: GameState;
    try {
      s1 = applyAction(state, c.action, { assumeLegal: true });
    } catch {
      continue; // 仿真失败的候选跳过（静态分异常的行动不值得深搜）
    }
    const vec = searchNode(s1, depthLeft - 1, st);
    if (best === null || vec[actor]! > best[actor]!) {
      best = vec;
    }
    // 预算耗尽后不再展开兄弟分支（确定性：总是按静态排序顺序截断）。
    if (st.nodes >= st.budget) break;
  }
  return best ?? leafVector(state, playerCount, st.overrides);
}

/**
 * 深搜选行动：根候选 = 静态评分 + 域帽剪枝后的集合（首层帽 caps[0]）。
 * 平局裁决：搜索值降序 → 静态分降序 → stableStringify 字典序（确定性）。
 */
export function chooseWithSearch(
  state: GameState,
  seat: PlayerIndex,
  scored: ScoredAction[],
  cfg: Cfg,
  overrides?: DeepPartial<Cfg>,
): SearchResult {
  const ctx = evalCtx(state, seat, overrides);
  const candidates = pruneCandidates(ctx, scored).slice(0, capAt(cfg.search.caps, 0));
  const st: SearchState = {
    nodes: 0,
    budget: cfg.search.nodeBudget,
    caps: cfg.search.caps,
    depth: cfg.search.depth,
    overrides,
  };
  let best: SearchResult | null = null;
  for (const c of candidates) {
    let value: number;
    try {
      const s1 = applyAction(state, c.action, { assumeLegal: true });
      st.nodes++;
      const vec = searchNode(s1, cfg.search.depth - 1, st);
      value = vec[seat]!;
    } catch {
      value = -Infinity;
    }
    if (
      best === null ||
      value > best.value ||
      (value === best.value && c.score > best.staticScore)
    ) {
      best = { action: c.action, value, nodes: st.nodes, staticScore: c.score };
    }
    if (st.nodes >= st.budget) break;
  }
  const fallback = scored[0]!;
  return best ?? { action: fallback.action, value: fallback.score, nodes: st.nodes, staticScore: fallback.score };
}

/** 决策轨迹可读串。 */
export function describeSearch(result: SearchResult, top: ScoredAction | undefined): string {
  return (
    `value=${result.value.toFixed(1)}（静态 ${result.staticScore.toFixed(1)}，` +
    `节点 ${result.nodes}` +
    (top !== undefined ? `，静态 Top-1 ${top.action.type} ${top.score.toFixed(1)}` : '') +
    '）'
  );
}
