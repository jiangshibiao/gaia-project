/**
 * cfg 驱动的价值尺度：资源/收入/研究/科技片/联邦标记/助推器 → VP 等值。
 * 逻辑移植自 v1 heuristic/values.ts，权重全部改从 ctx.cfg 读取（可调参），
 * 并叠加阶段权重（收入贴现、库存贬值）与回合计分板对齐。
 */
import {
  ADV_TECH_TILES,
  BOOSTERS,
  FEDERATION_TOKENS,
  RESEARCH_TRACKS,
  ROUND_SCORING,
  TECH_TILES,
  countUnits,
  type AdvTechTileId,
  type BoosterId,
  type FederationTokenId,
  type GameState,
  type ResearchTrack,
  type ResourceGain,
  type ScoringTileId,
  type TechTileId,
} from '@gaia/engine';
import type { EvalCtx } from './context.js';

/** 结构化奖励 → VP 等值。 */
export function gainValue(ctx: EvalCtx, gain: ResourceGain): number {
  const R = ctx.cfg.resources;
  let v = 0;
  if (gain.vp !== undefined) v += gain.vp * R.vp;
  if (gain.ore !== undefined) v += gain.ore * R.ore;
  if (gain.credits !== undefined) v += gain.credits * R.credits;
  if (gain.knowledge !== undefined) v += gain.knowledge * R.knowledge;
  if (gain.qic !== undefined) v += gain.qic * R.qic;
  if (gain.powerToken !== undefined) v += gain.powerToken * R.powerToken;
  if (gain.chargePower !== undefined) v += gain.chargePower * R.chargePower;
  if (gain.gaiaformer !== undefined) v += gain.gaiaformer * R.gaiaformer;
  return v;
}

/** 费用（power/qic/ore/credits/knowledge）→ VP 等值；power 按 III 区花费价。 */
export function costValue(
  ctx: EvalCtx,
  cost: { power?: number; qic?: number; ore?: number; credits?: number; knowledge?: number },
): number {
  const R = ctx.cfg.resources;
  let v = 0;
  if (cost.power !== undefined) v += cost.power * R.spendPower;
  if (cost.qic !== undefined) v += cost.qic * R.qic;
  if (cost.ore !== undefined) v += cost.ore * R.ore;
  if (cost.credits !== undefined) v += cost.credits * R.credits;
  if (cost.knowledge !== undefined) v += cost.knowledge * R.knowledge;
  return v;
}

/** 收入类奖励的 NPV（剩余轮数衰减 × 阶段收入权重；最后 1 轮归零）。 */
export function incomeNpv(ctx: EvalCtx, gain: ResourceGain): number {
  return gainValue(ctx, gain) * ctx.roundsLeft * ctx.cfg.phase[ctx.phase].incomeMult;
}

// ---------------------------------------------------------------------------
// 回合计分板
// ---------------------------------------------------------------------------

/** 本轮计分板（无则 null）。 */
export function roundTile(state: GameState) {
  const id = state.board.roundScoring[state.round - 1];
  return id !== undefined ? ROUND_SCORING[id] : null;
}

/**
 * 计分板触发的 VP：本轮全额 + 下一轮按 nextRoundMult 折算预期
 * （下轮局面未到，兑现不确定——但行动若可延续到下轮仍有价值）。
 */
export function scoringVp(ctx: EvalCtx, on: string, times = 1): number {
  let v = 0;
  const cur = roundTile(ctx.state);
  if (cur !== null && cur.trigger.on === on) v += cur.trigger.vp * times;
  if (ctx.state.round < 6) {
    const nextId: ScoringTileId | undefined = ctx.state.board.roundScoring[ctx.state.round];
    const next = nextId !== undefined ? ROUND_SCORING[nextId] : null;
    if (next !== null && next.trigger.on === on) {
      v += next.trigger.vp * times * ctx.cfg.scoring.nextRoundMult;
    }
  }
  return v;
}

// ---------------------------------------------------------------------------
// 研究升级估值
// ---------------------------------------------------------------------------

/** 轨 eff 的 terraform 每步 ore 费（缺省沿低级/基础值）。 */
function terraformCostAtLevel(track: ResearchTrack, level: number): number {
  let cost = 3;
  if (track !== 'terra') return cost;
  for (let i = 0; i < level; i++) {
    const c = RESEARCH_TRACKS.terra.levels[i]?.terraformCostPerStep;
    if (c !== undefined) cost = c;
  }
  return cost;
}

/** nav 轨 level 的基础射程。 */
function rangeAtLevel(level: number): number {
  let range = 1;
  for (let i = 0; i < level; i++) {
    const r = RESEARCH_TRACKS.nav.levels[i]?.range;
    if (r !== undefined) range = r;
  }
  return range;
}

/** 联邦标记估值：vp + 即时资源 + LF 即时效果 + 绿面门票溢价。 */
export function federationTokenValue(ctx: EvalCtx, id: FederationTokenId): number {
  const def = FEDERATION_TOKENS[id];
  let v = def.vp + (def.other !== undefined ? gainValue(ctx, def.other) : 0);
  switch (def.immediate) {
    case 'tech-tile':
      v += 6;
      break;
    case 'free-mine-unlimited-range':
    case 'free-mine-3-steps':
      v += 5.5;
      break;
    case 'power-tokens-bowl3':
      v += 2 * ctx.cfg.resources.powerToken;
      break;
    case undefined:
      break;
  }
  // 绿面标记是 L5/高级板的翻面门票：高级片价值 12-16 VP（社区共识），
  // 门票溢价必须接近这个量级——早期/中期 +6，末期 +2（来不及兑现高级片）。
  if (def.flippable) {
    const held = ctx.me.federationTokens.some((t) => t.id === id && !t.flipped);
    if (held !== true) v += ctx.phase === 'late' ? 2 : 6;
  }
  return v;
}

/**
 * 到达 track 第 newLevel 级的边际价值：一次性奖励 + 收入差 NPV + terraform
 * 折扣/射程 + L5 特殊 + L3+ 终局里程碑。
 */
export function researchLevelValue(
  ctx: EvalCtx,
  track: ResearchTrack,
  newLevel: number,
): number {
  const def = RESEARCH_TRACKS[track];
  const eff = def.levels[newLevel - 1];
  if (eff === undefined) return 0;
  const cfg = ctx.cfg.research;
  let v = eff.once !== undefined ? gainValue(ctx, eff.once) : 0;
  if (eff.income !== undefined) {
    const prev = newLevel >= 2 ? def.levels[newLevel - 2]?.income : undefined;
    v += incomeNpv(ctx, eff.income) - (prev !== undefined ? incomeNpv(ctx, prev) : 0);
  }
  if (eff.terraformCostPerStep !== undefined) {
    const prevCost = terraformCostAtLevel(track, newLevel - 1);
    v += (prevCost - eff.terraformCostPerStep) * cfg.terraFutureSteps * ctx.cfg.resources.ore;
  }
  if (track === 'nav' && eff.range !== undefined) {
    v += (eff.range - rangeAtLevel(newLevel - 1)) * cfg.rangePerStep;
  }
  if (eff.grantsPresetFederationToken === true) {
    v += federationTokenValue(ctx, ctx.state.board.terraformingL5Token ?? 'fed1');
  }
  if (eff.placesLostPlanet === true) {
    v += cfg.lostPlanet;
  }
  if (eff.vpPerGaiaPlanet !== undefined) {
    v += eff.vpPerGaiaPlanet * countUnits(ctx.state, ctx.seat, 'gaia-planet');
  }
  if (newLevel >= 3) v += cfg.milestoneVp;
  return v;
}

// ---------------------------------------------------------------------------
// 科技板 / 高级科技板估值
// ---------------------------------------------------------------------------

/** trigger 类效果的剩余触发次数估算（按剩余轮数缩放）。 */
function triggerNpv(ctx: EvalCtx, on: string, gain: ResourceGain): number {
  const base: Record<string, number> = {
    'build-mine': 3,
    'build-mine-gaia': 1.5,
    'upgrade-ts': 2,
    research: 4,
    'terraform-step': 3,
    'qic-action': 1,
  };
  const times = (base[on] ?? 1) * (ctx.roundsLeft / 5);
  return gainValue(ctx, gain) * times;
}

/** 特殊行动每轮一次的估值（要占主行动位，打 6 折）。 */
function specialActionNpv(ctx: EvalCtx, gain: ResourceGain | undefined): number {
  const perRound = gain !== undefined ? gainValue(ctx, gain) : 2;
  return perRound * ctx.roundsLeft * 0.6;
}

/** 标准科技板估值。 */
export function techTileValue(ctx: EvalCtx, id: TechTileId): number {
  const e = TECH_TILES[id].effect;
  switch (e.kind) {
    case 'once': {
      let v = e.gain !== undefined ? gainValue(ctx, e.gain) : 0;
      if (e.per !== undefined && e.perGain !== undefined) {
        v += countUnits(ctx.state, ctx.seat, e.per) * gainValue(ctx, e.perGain);
      }
      if (e.freeMine !== undefined) v += 5;
      return v;
    }
    case 'income':
      return e.gain !== undefined ? incomeNpv(ctx, e.gain) : 0;
    case 'trigger':
      return e.on !== undefined && e.gain !== undefined ? triggerNpv(ctx, e.on, e.gain) : 0;
    case 'pass':
      return e.per !== undefined && e.perGain !== undefined
        ? countUnits(ctx.state, ctx.seat, e.per) * gainValue(ctx, e.perGain) * 0.8
        : 0;
    case 'special':
      return specialActionNpv(ctx, e.gain);
    case 'passive':
      return e.passive === 'range-plus-1' ? 2.5 : 2;
  }
}

/** 高级科技板估值（不含翻标记门票成本，调用方另扣）。 */
export function advTechTileValue(ctx: EvalCtx, id: AdvTechTileId): number {
  const e = ADV_TECH_TILES[id].effect;
  switch (e.kind) {
    case 'once': {
      let v = e.gain !== undefined ? gainValue(ctx, e.gain) : 0;
      if (e.per !== undefined && e.perGain !== undefined) {
        v += countUnits(ctx.state, ctx.seat, e.per) * gainValue(ctx, e.perGain);
      }
      return v;
    }
    case 'income':
      return e.gain !== undefined ? incomeNpv(ctx, e.gain) : 0;
    case 'trigger':
      return e.on !== undefined && e.gain !== undefined ? triggerNpv(ctx, e.on, e.gain) : 0;
    case 'pass':
      return e.per !== undefined && e.perGain !== undefined
        ? countUnits(ctx.state, ctx.seat, e.per) * gainValue(ctx, e.perGain) * 0.8
        : 0;
    case 'special':
      return specialActionNpv(ctx, e.gain);
    case 'passive':
      return 2;
  }
}

// ---------------------------------------------------------------------------
// 助推器估值
// ---------------------------------------------------------------------------

/**
 * 助推器估值：收入 NPV（forSetup 按 5 次全额）+ 特殊行动格 + pass VP 潜力。
 */
export function boosterValue(
  ctx: EvalCtx,
  id: BoosterId,
  opts?: { forSetup?: boolean },
): number {
  const def = BOOSTERS[id];
  const payouts = opts?.forSetup === true ? 5 : ctx.roundsLeft;
  let v = gainValue(ctx, def.income) * payouts * ctx.cfg.phase[ctx.phase].incomeMult;
  if (def.special !== undefined) {
    const perUse = def.special === 'booster4' || def.special === 'booster5' ? 4 : 2;
    v += perUse * payouts * 0.6;
  }
  if (def.passVp !== undefined) {
    v += (countUnits(ctx.state, ctx.seat, def.passVp.per) + 1) * def.passVp.vp * 0.8;
  }
  return v;
}
