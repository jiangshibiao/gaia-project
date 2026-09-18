/**
 * 启发式共享价值尺度：一切评分统一折算成 VP 等值。
 *
 * - RESOURCE_VALUE：资源→VP 等值（vp=1、矿/信用=1、知识=2、QIC=3、
 *   power token=1.5、充能 1pw=0.5、gaiaformer=4）。spendPower（III 区花费）
 *   单独取 0.6——III 区 pw 是即战力，比"充能中的 1pw"略贵。
 * - 收入 NPV：收入类收益 × 剩余收入结算次数（roundsLeft = 6 − 当前轮；
 *   setup 轮 round=1 时为 5 次全额）。最后 1 轮收入 NPV 归零，"下轮才兑现"
 *   的投资自然贬值。
 * - 科技板/高级板/联邦标记/助推器/研究升级的估值 helper，heuristic.ts 的
 *   各行动评分与 summarize.ts 的候选描述共用。
 *
 * 规则数值一律走 @gaia/engine 的数据表/helper，本包不重复实现规则。
 */
import {
  ADV_TECH_TILES,
  BOOSTERS,
  FEDERATION_TOKENS,
  RESEARCH_TRACKS,
  TECH_TILES,
  countUnits,
  type AdvTechTileId,
  type BoosterId,
  type FederationTokenId,
  type GameState,
  type PlayerIndex,
  type ResearchTrack,
  type ResourceGain,
  type TechTileId,
} from '@gaia/engine';

/** 资源→VP 等值尺度（可调参）。 */
export const RESOURCE_VALUE = {
  vp: 1,
  ore: 1,
  credits: 1,
  knowledge: 2,
  qic: 3,
  powerToken: 1.5,
  chargePower: 0.5,
  gaiaformer: 4,
} as const;

/** III 区花费 1pw 的等值（即战力，比充能中的 1pw 略贵）。 */
export const SPEND_POWER_VALUE = 0.6;

/** 结构化奖励 → VP 等值。 */
export function gainValue(gain: ResourceGain): number {
  let v = 0;
  if (gain.vp !== undefined) v += gain.vp * RESOURCE_VALUE.vp;
  if (gain.ore !== undefined) v += gain.ore * RESOURCE_VALUE.ore;
  if (gain.credits !== undefined) v += gain.credits * RESOURCE_VALUE.credits;
  if (gain.knowledge !== undefined) v += gain.knowledge * RESOURCE_VALUE.knowledge;
  if (gain.qic !== undefined) v += gain.qic * RESOURCE_VALUE.qic;
  if (gain.powerToken !== undefined) v += gain.powerToken * RESOURCE_VALUE.powerToken;
  if (gain.chargePower !== undefined) v += gain.chargePower * RESOURCE_VALUE.chargePower;
  if (gain.gaiaformer !== undefined) v += gain.gaiaformer * RESOURCE_VALUE.gaiaformer;
  return v;
}

/** 费用（power/qic/ore/credits/knowledge）→ VP 等值；power 按 III 区花费价。 */
export function costValue(cost: {
  power?: number;
  qic?: number;
  ore?: number;
  credits?: number;
  knowledge?: number;
}): number {
  let v = 0;
  if (cost.power !== undefined) v += cost.power * SPEND_POWER_VALUE;
  if (cost.qic !== undefined) v += cost.qic * RESOURCE_VALUE.qic;
  if (cost.ore !== undefined) v += cost.ore * RESOURCE_VALUE.ore;
  if (cost.credits !== undefined) v += cost.credits * RESOURCE_VALUE.credits;
  if (cost.knowledge !== undefined) v += cost.knowledge * RESOURCE_VALUE.knowledge;
  return v;
}

/** 剩余收入结算次数（第 2–6 轮轮首结算；setup（round=0）与第 1 轮 → 5 次全额）。 */
export function roundsLeft(state: GameState): number {
  return Math.max(0, 6 - Math.max(1, state.round));
}

/** 收入类奖励的 NPV（随剩余轮数衰减；最后 1 轮归零）。 */
export function incomeNpv(state: GameState, gain: ResourceGain): number {
  return gainValue(gain) * roundsLeft(state);
}

// ---------------------------------------------------------------------------
// 研究升级估值
// ---------------------------------------------------------------------------

/** 轨 eff 的 terraform 每步 ore 费（缺省沿低级/基础值）。 */
export function terraformCostAtLevel(track: ResearchTrack, level: number): number {
  let cost = 3; // BASE_TERRAFORM_COST_PER_STEP
  if (track !== 'terra') return cost;
  for (let i = 0; i < level; i++) {
    const c = RESEARCH_TRACKS.terra.levels[i]?.terraformCostPerStep;
    if (c !== undefined) cost = c;
  }
  return cost;
}

/** nav 轨 level 的基础射程。 */
function rangeAtLevel(level: number): number {
  let range = 1; // BASE_RANGE
  for (let i = 0; i < level; i++) {
    const r = RESEARCH_TRACKS.nav.levels[i]?.range;
    if (r !== undefined) range = r;
  }
  return range;
}

/**
 * 到达 track 第 newLevel 级的边际价值（相对 newLevel−1）：
 * 一次性奖励 + 收入差 NPV + terraform 折扣/射程的扩张估值 + L3+ 终局里程碑
 * （每级 4vp）+ L5 特殊（terraforming 预设标记 / Lost Planet）。
 */
export function researchLevelValue(
  state: GameState,
  seat: PlayerIndex,
  track: ResearchTrack,
  newLevel: number,
): number {
  const def = RESEARCH_TRACKS[track];
  const eff = def.levels[newLevel - 1];
  if (eff === undefined) return 0;
  let v = eff.once !== undefined ? gainValue(eff.once) : 0;
  if (eff.income !== undefined) {
    const prev = newLevel >= 2 ? def.levels[newLevel - 2]?.income : undefined;
    v += incomeNpv(state, eff.income) - (prev !== undefined ? incomeNpv(state, prev) : 0);
  }
  if (eff.terraformCostPerStep !== undefined) {
    const prevCost = terraformCostAtLevel(track, newLevel - 1);
    // 未来付费 terraform 步估算 3 步：折扣全局回本。
    v += (prevCost - eff.terraformCostPerStep) * 3;
  }
  if (track === 'nav' && eff.range !== undefined) {
    v += (eff.range - rangeAtLevel(newLevel - 1)) * 3;
  }
  if (eff.grantsPresetFederationToken === true) {
    v += federationTokenValue(state, seat, state.board.terraformingL5Token ?? 'fed1');
  }
  if (eff.placesLostPlanet === true) {
    v += 10; // Lost Planet ≈ 免费矿 + 独立星球类型 + 卫星 + 殖民计数
  }
  if (eff.vpPerGaiaPlanet !== undefined) {
    v += eff.vpPerGaiaPlanet * countUnits(state, seat, 'gaia-planet');
  }
  if (newLevel >= 3) v += 4; // 终局每轨 L3/L4/L5 各 +4vp
  return v;
}

// ---------------------------------------------------------------------------
// 科技板 / 高级科技板估值
// ---------------------------------------------------------------------------

/** trigger 类效果的剩余触发次数估算（按剩余轮数缩放）。 */
function triggerNpv(state: GameState, on: string, gain: ResourceGain): number {
  const base: Record<string, number> = {
    'build-mine': 3,
    'build-mine-gaia': 1.5,
    'upgrade-ts': 2,
    research: 4,
    'terraform-step': 3,
    'qic-action': 1,
  };
  const times = (base[on] ?? 1) * (roundsLeft(state) / 5);
  return gainValue(gain) * times;
}

/** 特殊行动每轮一次的估值（要占主行动位，打 6 折）。 */
function specialActionNpv(state: GameState, gain: ResourceGain | undefined): number {
  const perRound = gain !== undefined ? gainValue(gain) : 2;
  return perRound * roundsLeft(state) * 0.6;
}

/** 标准科技板估值。 */
export function techTileValue(state: GameState, seat: PlayerIndex, id: TechTileId): number {
  const e = TECH_TILES[id].effect;
  switch (e.kind) {
    case 'once': {
      let v = e.gain !== undefined ? gainValue(e.gain) : 0;
      if (e.per !== undefined && e.perGain !== undefined) {
        v += countUnits(state, seat, e.per) * gainValue(e.perGain);
      }
      if (e.freeMine !== undefined) v += 5;
      return v;
    }
    case 'income':
      return e.gain !== undefined ? incomeNpv(state, e.gain) : 0;
    case 'trigger':
      return e.on !== undefined && e.gain !== undefined ? triggerNpv(state, e.on, e.gain) : 0;
    case 'pass':
      // pass 触发按"未来每次 pass 都兑现"估 1 次（计数还会涨，打 8 折）。
      return e.per !== undefined && e.perGain !== undefined
        ? countUnits(state, seat, e.per) * gainValue(e.perGain) * 0.8
        : 0;
    case 'special':
      return specialActionNpv(state, e.gain);
    case 'passive':
      return e.passive === 'range-plus-1' ? 2.5 : 2;
  }
}

/** 高级科技板估值（不含翻标记的门票成本，调用方另扣）。 */
export function advTechTileValue(
  state: GameState,
  seat: PlayerIndex,
  id: AdvTechTileId,
): number {
  const e = ADV_TECH_TILES[id].effect;
  switch (e.kind) {
    case 'once': {
      let v = e.gain !== undefined ? gainValue(e.gain) : 0;
      if (e.per !== undefined && e.perGain !== undefined) {
        v += countUnits(state, seat, e.per) * gainValue(e.perGain);
      }
      return v;
    }
    case 'income':
      return e.gain !== undefined ? incomeNpv(state, e.gain) : 0;
    case 'trigger':
      return e.on !== undefined && e.gain !== undefined ? triggerNpv(state, e.on, e.gain) : 0;
    case 'pass':
      return e.per !== undefined && e.perGain !== undefined
        ? countUnits(state, seat, e.per) * gainValue(e.perGain) * 0.8
        : 0;
    case 'special':
      return specialActionNpv(state, e.gain);
    case 'passive':
      return 2;
  }
}

// ---------------------------------------------------------------------------
// 联邦标记 / 助推器估值
// ---------------------------------------------------------------------------

/** 联邦标记估值：vp + 即时资源 + LF 即时效果（拿板/免费矿/III 区 token）。 */
export function federationTokenValue(
  state: GameState,
  seat: PlayerIndex,
  id: FederationTokenId,
): number {
  const def = FEDERATION_TOKENS[id];
  let v = def.vp + (def.other !== undefined ? gainValue(def.other) : 0);
  switch (def.immediate) {
    case 'tech-tile':
      v += 6;
      break;
    case 'free-mine-unlimited-range':
    case 'free-mine-3-steps':
      v += 5.5;
      break;
    case 'power-tokens-bowl3':
      v += 2 * RESOURCE_VALUE.powerToken;
      break;
    case undefined:
      break;
  }
  // 绿面标记是 L5/高级板的翻面门票：未翻面的可翻标记小幅加价。
  if (def.flippable) {
    const held = state.players[seat]?.federationTokens.some((t) => t.id === id && !t.flipped);
    if (held !== true) v += 0.5;
  }
  return v;
}

/**
 * 助推器估值：收入 NPV（按给定剩余结算次数）+ 特殊行动格 + pass VP 潜力。
 * forSetup=true 时按 5 次全额收入（setup 选起始助推器）。
 */
export function boosterValue(
  state: GameState,
  seat: PlayerIndex,
  id: BoosterId,
  opts?: { forSetup?: boolean },
): number {
  const def = BOOSTERS[id];
  const payouts = opts?.forSetup === true ? 5 : roundsLeft(state);
  let v = gainValue(def.income) * payouts;
  if (def.special !== undefined) {
    // 特殊行动格（占主行动位）：建矿/盖亚类约值 4，充能类约值 2，打 6 折。
    const perUse = def.special === 'booster4' || def.special === 'booster5' ? 4 : 2;
    v += perUse * payouts * 0.6;
  }
  if (def.passVp !== undefined) {
    // pass VP 潜力：当前计数 + 1 预期增长，兑现概率 8 折。
    v += (countUnits(state, seat, def.passVp.per) + 1) * def.passVp.vp * 0.8;
  }
  return v;
}
