/**
 * 局面叶估值（lookahead 终端）：估算"从该局面走到终局的期望 VP"。
 *
 * 组成（全部 VP 等值）：已入账 vp + 库存资源×阶段权重 + 总收入 NPV +
 * 研究轨里程碑 + 持有片折算 + 联邦重结算期望 + 终局零和位次期望。
 *
 * 注意：库存/收入/里程碑与行动评分存在口径重叠——bench 消融证明保留重叠
 * 的"富"叶估值显著优于去重版（候选间比较需要的是位置好坏的完整排序，
 * 而非增量归因；leafWeight 1.2 时去重版 −9 分）。重叠不是 bug，是特性。
 */
import {
  BOOSTERS,
  FACTIONS,
  FINAL_RANK_VP,
  FINAL_SCORING,
  RESEARCH_TRACKS,
  TECH_TILES,
  ADV_TECH_TILES,
  buildingPowerValue,
  finalCount,
  hexesWithin,
  mapNeighbors,
  type FinalCondition,
  type GameState,
  type HexKey,
  type PlayerIndex,
  type PlayerState,
  type ResearchTrack,
  type ResourceGain,
} from '@gaia/engine';
import type { Cfg, DeepPartial } from './cfg.js';
import type { EvalCtx } from './context.js';
import { evalCtx } from './context.js';
import { advTechTileValue, gainValue, techTileValue } from './values.js';

/** 加总 ResourceGain 数组。 */
function sumGains(gains: (ResourceGain | undefined | null)[]): ResourceGain {
  const out: Required<Omit<ResourceGain, 'vp'>> & { vp: number } = {
    vp: 0, ore: 0, credits: 0, knowledge: 0, qic: 0, powerToken: 0, chargePower: 0, gaiaformer: 0,
  };
  for (const g of gains) {
    if (g == null) continue;
    if (g.vp !== undefined) out.vp += g.vp;
    if (g.ore !== undefined) out.ore += g.ore;
    if (g.credits !== undefined) out.credits += g.credits;
    if (g.knowledge !== undefined) out.knowledge += g.knowledge;
    if (g.qic !== undefined) out.qic += g.qic;
    if (g.powerToken !== undefined) out.powerToken += g.powerToken;
    if (g.chargePower !== undefined) out.chargePower += g.chargePower;
    if (g.gaiaformer !== undefined) out.gaiaformer += g.gaiaformer;
  }
  return out;
}

/** 每轮总收入（面板揭开轨 + 研究轨 + 科技片/高级片 + 助推器）。 */
function totalIncome(p: PlayerState): ResourceGain {
  const track = FACTIONS[p.faction].incomeTrack;
  const gains: (ResourceGain | undefined | null)[] = [];
  const minesPlaced = 8 - p.buildings.mine;
  for (let i = 0; i < minesPlaced; i++) gains.push(track.mine[i]);
  const tsPlaced = 4 - p.buildings.ts;
  for (let i = 0; i < tsPlaced; i++) gains.push(track.ts[i]);
  const labsPlaced = 3 - p.buildings.lab;
  for (let i = 0; i < labsPlaced; i++) gains.push(track.lab[i]);
  if (p.buildings.pi === 0) gains.push(track.pi);
  if (p.buildings.ac1 === 0) gains.push(track.ac1);
  for (const t of Object.keys(p.research) as ResearchTrack[]) {
    const lvl = p.research[t];
    if (lvl >= 1) gains.push(RESEARCH_TRACKS[t].levels[lvl - 1]?.income);
  }
  for (const id of p.techTiles) {
    const e = TECH_TILES[id].effect;
    if (e.kind === 'income') gains.push(e.gain);
  }
  for (const t of p.advTechTiles) {
    const e = ADV_TECH_TILES[t.id].effect;
    if (e.kind === 'income') gains.push(e.gain);
  }
  if (p.booster !== null) gains.push(BOOSTERS[p.booster].income);
  return sumGains(gains);
}

/** 位次期望 VP（并列按引擎同口径：并列名次 VP 切片均分）。 */
function rankExpectation(counts: number[], seat: PlayerIndex): number {
  const mine = counts[seat]!;
  if (mine === 0) return 0;
  const better = counts.filter((c) => c > mine).length;
  const ties = counts.filter((c) => c === mine).length;
  const slice = FINAL_RANK_VP.slice(better, better + ties);
  return slice.reduce((s, v) => s + v, 0) / Math.max(1, slice.length);
}

/** 终局计分零和位次期望（两块终局板合计；族 hook 可修正单项）。 */
function finalExpectation(ctx: EvalCtx): number {
  const { state, seat } = ctx;
  let total = 0;
  for (const tileId of state.board.finalScoring) {
    const def = FINAL_SCORING[tileId];
    if (def === undefined) continue;
    const cond: FinalCondition = def.condition;
    const counts = state.players.map((_, i) => finalCount(state, i, cond));
    let v = rankExpectation(counts, seat);
    v = ctx.hooks.adjustFinal?.(v, cond, ctx) ?? v;
    total += v;
  }
  return total * ctx.cfg.final.weight;
}

/**
 * 联邦组潜力（叶估值项）：未入联邦己方建筑中，2 格组 pv 最大者的凸形价值
 * （(pv/7)²×weight）——"差一两步就成组"的局面应显著好于散沙局面。
 * 禁入区（已入联邦格及其邻格）的建筑不计。
 */
function federationPotential(ctx: EvalCtx): number {
  const { state, seat } = ctx;
  // 预计算禁入区。
  const forbidden = new Set<HexKey>();
  for (const [key, hex] of Object.entries(state.map)) {
    if (hex.federations.includes(seat)) {
      forbidden.add(key as HexKey);
      for (const nb of mapNeighbors(state.map, key as HexKey)) forbidden.add(nb);
    }
  }
  let best = 0;
  for (const [key, hex] of Object.entries(state.map)) {
    if (hex.building?.player !== seat || forbidden.has(key as HexKey)) continue;
    let pv = 0;
    for (const h of hexesWithin(state.map, key as HexKey, 2)) {
      if (forbidden.has(h)) continue;
      pv += buildingPowerValue(state, seat, state.map[h]!);
    }
    if (pv > best) best = pv;
  }
  const t = Math.min(best, 7) / 7;
  return t * t * ctx.cfg.mine.clusterPv * 0.5;
}

/** 局面叶估值：state 对 seat 的期望 VP。 */
export function evaluatePosition(ctx: EvalCtx): number {
  const { state, seat } = ctx;
  const p = ctx.me;
  const R = ctx.cfg.resources;
  const phaseCfg = ctx.cfg.phase[ctx.phase];
  let v = p.vp;
  // 库存资源（后期贬值）。
  const stock =
    p.resources.ore * R.ore +
    p.resources.credits * R.credits +
    p.resources.knowledge * R.knowledge +
    p.resources.qic * R.qic +
    (p.power.bowl1 + p.power.bowl2) * R.powerToken +
    p.power.bowl3 * R.spendPower +
    (p.gaiaformers.total - p.gaiaformers.lost) * R.gaiaformer;
  v += stock * phaseCfg.stockMult;
  // 收入 NPV（×0.5 折减——与行动分的收入增量口径重叠，见文件头说明）。
  v += gainValue(ctx, totalIncome(p)) * ctx.roundsLeft * phaseCfg.incomeMult * 0.5;
  // 研究轨终局里程碑（终局才结算，未入账）。
  for (const t of Object.keys(p.research) as ResearchTrack[]) {
    if (p.research[t] >= 3) v += ctx.cfg.research.milestoneVp;
  }
  // 持有科技片/高级片折算（leaf mult）。
  for (const id of p.techTiles) v += techTileValue(ctx, id) * ctx.cfg.leaf.techTileMult;
  for (const t of p.advTechTiles) v += advTechTileValue(ctx, t.id) * ctx.cfg.leaf.advTileMult;
  // 联邦标记未来重结算期望（vp 已入账）。
  v += p.federationTokens.length * ctx.cfg.leaf.federationValue;
  // 联邦组潜力（差一两步成组的局面溢价）。
  v += federationPotential(ctx);
  // gaia 计划进行中：盖亚碗 token 部分回收期望。
  v += p.power.gaia * R.powerToken * 0.5 * phaseCfg.stockMult;
  // 终局计分零和期望。
  v += finalExpectation(ctx);
  return v;
}

/** 便捷入口：对任意 state/seat 直接估值（lookahead 内对新局面用）。 */
export function evaluateState(
  state: GameState,
  seat: PlayerIndex,
  overrides?: DeepPartial<Cfg>,
): number {
  return evaluatePosition(evalCtx(state, seat, overrides));
}
