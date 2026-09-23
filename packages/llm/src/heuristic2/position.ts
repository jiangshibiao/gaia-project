/**
 * 局面叶估值（lookahead 终端）：估算"从该局面走到终局的期望 VP"。
 *
 * 组成（全部 VP 等值）：已入账 vp + 库存资源×阶段权重 + 总收入 NPV +
 * 研究轨里程碑 + 持有片折算 + 联邦重结算期望 + 终局零和位次期望。
 *
 * 注意：库存/收入/里程碑与行动评分存在口径重叠——刻意保留："富"叶估值
 * 显著优于去重版（候选间比较需要的是位置好坏的完整排序，而非增量归因；
 * leafWeight 1.2 时去重版 −9 分）。重叠不是 bug，是特性。
 */
import {
  BOOSTERS,
  FACTIONS,
  FINAL_RANK_VP,
  FINAL_SCORING,
  RESEARCH_TRACKS,
  TECH_TILES,
  ADV_TECH_TILES,
  finalCount,
  type FinalCondition,
  type GameState,
  type PlayerIndex,
  type PlayerState,
  type ResearchTrack,
  type ResourceGain,
} from '@gaia/engine';
import type { Cfg, DeepPartial } from './cfg.js';
import type { EvalCtx } from './context.js';
import { evalCtx } from './context.js';
import { fedComponentValue, ownComponents } from './score.js';
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
 * 联邦组潜力（叶估值项）：**已组建的联邦按满值组计入**（潜力转化为已入账成果——
 * 不计的话组建联邦会让叶估值掉 ~20（7pv 组的凸形潜力蒸发），深搜会因此系统性
 * 拒绝组建）；未入联邦己方建筑再按**连通分量**取
 * 最好的 need（= targetCount − 已持联邦数）个加权求和（权重 1 / fedGroup2Mult /
 * fedGroup3Mult）——3 联邦的几何前提是 2-3 个并行成长的簇。禁入区（已入联邦格
 * 及其邻格）的建筑再也进不了新联邦，不计入。
 */
function federationPotential(ctx: EvalCtx): number {
  const { state, seat } = ctx;
  const held = ctx.me.federationTokens.length;
  // 已锁定的联邦 = 满值组（7pv 凸形价）。
  let v = held * fedComponentValue(7, ctx.cfg.mine.clusterPv * 0.5);
  const need = Math.max(0, ctx.cfg.federation.targetCount - held);
  if (need === 0) return v;
  const comps = ownComponents(state, seat, { excludeFedAdjacent: true });
  const pvs = [...comps.pvs].sort((a, b) => b - a);
  const weights = [1, ctx.cfg.leaf.fedGroup2Mult, ctx.cfg.leaf.fedGroup3Mult];
  for (let i = 0; i < Math.min(need, weights.length); i++) {
    v += fedComponentValue(pvs[i] ?? 0, ctx.cfg.mine.clusterPv * 0.5) * weights[i]!;
  }
  return v;
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
