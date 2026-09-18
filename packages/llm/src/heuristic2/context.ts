/**
 * 估价上下文：一次决策所需的派生信息（变体/阶段/合并后 cfg/族 hook），
 * 按 (GameState, seat) 缓存（WeakMap）——同一局面重复评分零成本。
 *
 * cfg 合并链：BASE_CFG →（lostFleet 时）LF_DELTA → 插件 overrides → 族 cfg 增量。
 */
import type { GameState, PlayerIndex, PlayerState } from '@gaia/engine';
import {
  cfgForVariant,
  mergeCfg,
  phaseOf,
  type Cfg,
  type DeepPartial,
  type Phase,
  type Variant,
} from './cfg.js';
import { factionHooks, type FactionHooks } from './factions.js';

export interface EvalCtx {
  state: GameState;
  seat: PlayerIndex;
  me: PlayerState;
  /** 合并后的有效 cfg（变体 + 插件 overrides + 族增量）。 */
  cfg: Cfg;
  variant: Variant;
  phase: Phase;
  /** 剩余收入结算次数（第 2-6 轮轮首结算；setup/第 1 轮 → 5 次全额）。 */
  roundsLeft: number;
  hooks: FactionHooks;
}

const CACHE = new WeakMap<GameState, Map<PlayerIndex, EvalCtx>>();

/** 剩余收入结算次数（与 v1 口径一致：round=1 → 5，round=6 → 0）。 */
export function roundsLeftOf(state: GameState): number {
  return Math.max(0, 6 - Math.max(1, state.round));
}

/** 构造（或取缓存的）估价上下文。 */
export function evalCtx(
  state: GameState,
  seat: PlayerIndex,
  overrides?: DeepPartial<Cfg>,
): EvalCtx {
  let bySeat = CACHE.get(state);
  if (bySeat === undefined) {
    bySeat = new Map();
    CACHE.set(state, bySeat);
  }
  // 带 overrides 的 ctx 不缓存（调参路径，量小）。
  if (overrides === undefined) {
    const hit = bySeat.get(seat);
    if (hit !== undefined) return hit;
  }
  const me = state.players[seat];
  if (me === undefined) throw new Error(`evalCtx: 非法座位 ${seat}`);
  const variant = state.config.lostFleet ? 'lostFleet' : 'base';
  const hooks = factionHooks(me.faction);
  let cfg = cfgForVariant(variant, overrides);
  const factionDelta = hooks.cfg?.(variant);
  if (factionDelta !== undefined) cfg = mergeCfg(cfg, factionDelta);
  const ctx: EvalCtx = {
    state,
    seat,
    me,
    cfg,
    variant,
    phase: phaseOf(state.round),
    roundsLeft: roundsLeftOf(state),
    hooks,
  };
  if (overrides === undefined) bySeat.set(seat, ctx);
  return ctx;
}
