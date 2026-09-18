/**
 * build-mine 主行动：目标合法性、射程/qic 补程、terraform 费用、结算
 * （放建筑、殖民记录、计分触发、对手被动充能邀约）。
 *
 * 费用模型（rules-summary §1 + gaia-base-rules "Build a Mine"）：
 * - 矿费 1o+2c（asteroid 免矿费但牺牲 1 可用 gaiaformer，永久报废）；
 * - terraform 步数 × terra 轨每步 ore 费（proto 所有种族 3 步）；
 * - gaia 星球居住费 1q（gleens 付 1o；LF 4 族 2q；有己方 gaiaformer 的免且视为可达）；
 * - 射程不足可花 qic 补（1q = +2 格），枚举时自动算最小补程计入成本，
 *   apply 重算同样的最小成本并校验支付能力（payload 不带 qic）。
 *
 * MineOptions（power2/power6/booster4/booster5/ship-terraform-step/techlf1/fedlf3/fedlf4
 * 等带免费 terraform 步、临时射程、免矿费、无限射程或免 gaiaformer 的建矿
 * 入口共用，枚举与 apply 必须传同一组值）：
 * - freeTerraformSteps：前 N 步 terraform 免费（免费步不触发 score1）；
 * - tempRange：本次行动临时射程加成（booster5 +3、gleens-range +2、ship-range3 +3 等）；
 * - waiveMineCost：免矿费 1o+2c（fedlf3/fedlf4/techlf1）；
 * - unlimitedRange：无限射程（fedlf3；terraform 与 Gaia 居住费照付）；
 * - asteroidNoGaiaformer：小行星免 gaiaformer（ship-asteroid-mine）；
 * - shipCreditBuild：ship-terraform-step（TF Mars credit）专用——参考引擎
 *   spaceship 建矿路径按 availability 预计算费用 verbatim 扣费：不含 Gaia
 *   居住费与 proto +6vp，且排除 asteroid/transdim 目标（见
 *   reference/harness/NOTES.md §5；与 BGS 线上行为对齐）。
 */
import { IllegalActionError } from '../errors.js';
import type { Action, GameState, PlanetType, PlayerIndex, PlayerState } from '../types.js';
import type { HexKey } from '../hex.js';
import { colonizedHexes, minDistanceToAny } from '../map.js';
import { terraformingSteps, HOME_PLANET_TYPES } from '../data/planets.js';
import { BUILDING_POWER_VALUE } from '../data/prices.js';
import { BASE_RANGE, BASE_TERRAFORM_COST_PER_STEP, RESEARCH_TRACKS } from '../data/research.js';
import { FACTIONS } from '../data/factions.js';
import { addVp, gainResources, player, spendResources } from '../state.js';
import { onMineBuilt, onTerraformSteps } from '../triggers.js';
import { addBuildingToNearbyFederation } from './federation.js';
import { makeChargeOffers } from './charge.js';

/** 建矿选项（带免费 terraform 步/临时射程的入口；默认普通建矿）。 */
export interface MineOptions {
  freeTerraformSteps?: number;
  tempRange?: number;
  /** 免矿费 1o+2c（fedlf3/fedlf4/techlf1）。 */
  waiveMineCost?: boolean;
  /** 无限射程（fedlf3；terraform 与 Gaia 居住费照付）。 */
  unlimitedRange?: boolean;
  /** 小行星免 gaiaformer（ship-asteroid-mine）。 */
  asteroidNoGaiaformer?: boolean;
  /** ship-terraform-step：免 Gaia 居住费、不得 proto +6vp、排除 asteroid 目标（参考 spaceship 建矿路径）。 */
  shipCreditBuild?: boolean;
}

/** 一次建矿目标的完整成本（枚举与 apply 共用同一计算，保证一致）。 */
export interface MineTarget {
  kind: 'normal' | 'asteroid' | 'lantids';
  planet: PlanetType;
  terraformSteps: number;
  /** 扣除免费步后的付费步数（触发 score1 的步数）。 */
  paidTerraformSteps: number;
  ore: number;
  credits: number;
  qic: number;
  /** gaia 星球上有己方 gaiaformer（免 q 且视为可达，建矿后收回）。 */
  gaiaformerRecover: boolean;
}

/** 基础射程（nav 轨：L0–1=1、L2–3=2、L4=3、L5=4；techlf2 未被覆盖时 +1）。 */
export function rangeOf(p: PlayerState): number {
  let range = BASE_RANGE;
  const lvl = p.research.nav;
  for (let i = 0; i < lvl; i++) {
    const r = RESEARCH_TRACKS.nav.levels[i]?.range;
    if (r !== undefined) {
      range = r;
    }
  }
  // techlf2 被动：基本射程 +1（被高级板覆盖时失效）。
  const covered = new Set(p.advTechTiles.map((a) => a.covers));
  if (p.techTiles.includes('techlf2') && !covered.has('techlf2')) {
    range += 1;
  }
  return range;
}

/** terraform 每步 ore 费（terra 轨：L0–1=3、L2=2、L3+=1）。 */
export function terraformCostPerStep(p: PlayerState): number {
  let cost = BASE_TERRAFORM_COST_PER_STEP;
  const lvl = p.research.terra;
  for (let i = 0; i < lvl; i++) {
    const c = RESEARCH_TRACKS.terra.levels[i]?.terraformCostPerStep;
    if (c !== undefined) {
      cost = c;
    }
  }
  return cost;
}

/** 对目标星球的 terraform 步数。 */
export function terraformStepsFor(p: PlayerState, target: PlanetType): number {
  const def = FACTIONS[p.faction];
  if (target === 'proto') {
    return 3; // LF：原行星所有种族 3 步
  }
  if (def.homePlanet !== null) {
    return terraformingSteps(def.homePlanet, target);
  }
  // LF 新族无母星：darkanians 全 1 步、space-giants 全 2 步、
  // tinkeroids/moweyds 抽出的 3 种 3 步、其余 1 步（setup 时 rng 抽取【简化】）。
  if (def.terraformAllSteps !== undefined) {
    return def.terraformAllSteps;
  }
  if (def.terraformThreeStepRoll === true) {
    return p.terraformThreeStep.includes(target as (typeof p.terraformThreeStep)[number]) ? 3 : 1;
  }
  return 1;
}

/** 射程起点：已殖民 hex + 空间站 + Lost Planet（视为已殖民）。 */
export function rangeSources(state: GameState, idx: PlayerIndex): HexKey[] {
  const out = colonizedHexes(state.map, idx);
  for (const [key, hex] of Object.entries(state.map)) {
    if (hex.building?.type === 'sp' && hex.building.player === idx) {
      out.push(key as HexKey);
    }
    if (hex.planet === 'lost' && hex.satelliteOf === idx) {
      out.push(key as HexKey);
    }
  }
  return out;
}

/** gaia 星球居住费：默认 1q；gleens 付 1o；LF 仅 darkanians/space-giants 付 2q
 * （tinkeroids/moweyds 照常 1q，参考 player.ts gaiaFormingCost）。 */
function gaiaFee(p: PlayerState): { ore: number; qic: number } {
  if (p.faction === 'gleens') {
    return { ore: 1, qic: 0 };
  }
  if (p.faction === 'darkanians' || p.faction === 'space-giants') {
    return { ore: 0, qic: 2 };
  }
  return { ore: 0, qic: 1 };
}

/**
 * 计算建矿目标与最小成本；非法目标返回 null。
 * 枚举与 apply 共用（apply 重算同样成本并校验支付能力）。
 */
export function computeMineTarget(
  state: GameState,
  idx: PlayerIndex,
  hexKey: HexKey,
  opts?: MineOptions,
): MineTarget | null {
  const p = state.players[idx];
  const hex = state.map[hexKey];
  if (p === undefined || hex === undefined || p.buildings.mine <= 0) {
    return null;
  }
  const freeSteps = opts?.freeTerraformSteps ?? 0;
  const range = rangeOf(p) + (opts?.tempRange ?? 0);
  const sources = rangeSources(state, idx);
  const qicBoost = (free: boolean): number => {
    if (free || opts?.unlimitedRange === true) {
      return 0;
    }
    const need = minDistanceToAny(state.map, sources, hexKey) - range;
    return need > 0 ? Math.ceil(need / 2) : 0;
  };

  // Lantids：在对手已殖民星球上建附加矿（免 terraform 免居住费，矿费照付，射程照常）。
  if (p.faction === 'lantids' && hex.additionalMine === undefined) {
    const opponentColonized =
      (hex.building !== undefined &&
        hex.building.player !== idx &&
        BUILDING_POWER_VALUE[hex.building.type] > 0) ||
      (hex.planet === 'lost' && hex.satelliteOf !== undefined && hex.satelliteOf !== idx);
    if (opponentColonized) {
      return {
        kind: 'lantids',
        planet: hex.planet,
        terraformSteps: 0,
        paidTerraformSteps: 0,
        ore: 1,
        credits: 2,
        qic: qicBoost(false),
        gaiaformerRecover: false,
      };
    }
  }

  // 普通目标：无建筑、无飞船的星球格。
  if (hex.building !== undefined || hex.ship !== undefined) {
    return null;
  }
  const planet = hex.planet;
  const isHome = (HOME_PLANET_TYPES as readonly string[]).includes(planet);
  if (!isHome && planet !== 'gaia' && planet !== 'proto' && planet !== 'asteroid') {
    // transdim（只能盖亚计划转化）/ lost（不可直接建）/ empty 不可建。
    return null;
  }

  const gaiaformerRecover = planet === 'gaia' && hex.gaiaformerOf === idx;
  let steps = 0;
  let ore = 0;
  let credits = 0;
  let qic = 0;
  if (planet === 'asteroid') {
    // ship-terraform-step 不能以小行星为目标（参考 spaceship 建矿路径排除）。
    if (opts?.shipCreditBuild === true) {
      return null;
    }
    // 牺牲 1 可用 gaiaformer（lost+1），免矿费；ship-asteroid-mine 可免 gaiaformer。
    if (opts?.asteroidNoGaiaformer !== true && p.gaiaformers.available < 1) {
      return null;
    }
  } else if (planet === 'gaia') {
    if (!gaiaformerRecover && opts?.shipCreditBuild !== true) {
      const fee = gaiaFee(p);
      ore += fee.ore;
      qic += fee.qic;
    }
  } else {
    steps = terraformStepsFor(p, planet);
  }
  const paidSteps = Math.max(0, steps - freeSteps);
  ore += paidSteps * terraformCostPerStep(p);
  if (planet !== 'asteroid' && opts?.waiveMineCost !== true) {
    ore += 1;
    credits += 2;
  }
  qic += qicBoost(gaiaformerRecover);
  return {
    kind: planet === 'asteroid' ? 'asteroid' : 'normal',
    planet,
    terraformSteps: steps,
    paidTerraformSteps: paidSteps,
    ore,
    credits,
    qic,
    gaiaformerRecover,
  };
}

/** 是否负担得起某建矿目标。 */
function canAfford(p: PlayerState, t: MineTarget): boolean {
  const r = p.resources;
  return r.ore >= t.ore && r.credits >= t.credits && r.qic >= t.qic;
}

/** 枚举当前玩家的 build-mine 行动（只含负担得起的目标）。 */
export function enumerateBuildMine(state: GameState, idx: PlayerIndex): Action[] {
  const p = state.players[idx]!;
  const out: Action[] = [];
  for (const key of Object.keys(state.map) as HexKey[]) {
    const t = computeMineTarget(state, idx, key);
    if (t !== null && canAfford(p, t)) {
      out.push({ type: 'build-mine', hex: key });
    }
  }
  return out;
}

/** 应用 build-mine（原地修改）；opts 须与枚举时一致（免费步/临时射程入口）。 */
export function applyBuildMine(state: GameState, idx: PlayerIndex, hexKey: HexKey, opts?: MineOptions): void {
  const t = computeMineTarget(state, idx, hexKey, opts);
  if (t === null) {
    throw new IllegalActionError('illegal-mine-target', `非法建矿目标: ${hexKey}`);
  }
  const p = player(state, idx);
  spendResources(p, { ore: t.ore, credits: t.credits, qic: t.qic });
  const hex = state.map[hexKey]!;

  if (t.kind === 'asteroid' && opts?.asteroidNoGaiaformer !== true) {
    // gaiaformer 永久报废。
    p.gaiaformers.available -= 1;
    p.gaiaformers.lost += 1;
  }
  if (t.kind === 'lantids') {
    hex.additionalMine = idx;
  } else {
    hex.building = { type: 'mine', player: idx };
  }
  // 新建筑并入邻近联邦（参考 addBuildingToNearbyFederation）。
  addBuildingToNearbyFederation(state, idx, hexKey);
  p.buildings.mine -= 1;
  if (t.gaiaformerRecover) {
    // 收回留置的 gaiaformer。
    p.gaiaformers.available += 1;
    delete hex.gaiaformerOf;
  }

  // 殖民记录（Lantids 附加矿不计星球类型，但计扇区；Interspace 不算扇区——
  // 规则书 "Interspace tiles do not count as sectors"）。
  let newPlanetType = false;
  if (t.kind !== 'lantids' && !p.colonizedPlanetTypes.includes(t.planet)) {
    p.colonizedPlanetTypes.push(t.planet);
    newPlanetType = true;
  }
  let newSector = false;
  if (hex.sector !== 'interspace' && !p.colonizedSectors.includes(hex.sector)) {
    p.colonizedSectors.push(hex.sector);
    newSector = true;
  }

  // 计分触发：terraform 步（score1/advtechlf6 均含免费步）+ 建矿。
  if (t.terraformSteps > 0) {
    onTerraformSteps(state, idx, t.terraformSteps);
  }
  onMineBuilt(state, idx, {
    onGaiaPlanet: t.planet === 'gaia' && t.kind === 'normal',
    newSector,
    newPlanetType,
  });
  // LF：原行星建矿 +6vp（起始放置的原行星矿不得分——setup 放置不经此路径；
  // ship-terraform-step 参考 spaceship 建矿路径同样不得分）。
  if (t.planet === 'proto' && t.kind === 'normal' && opts?.shipCreditBuild !== true) {
    addVp(p, 6);
  }
  // Lantids PI：在对手星球建矿 +2k。（LF <4 人修订 PI：在母星类型星球建矿也 +2k。）
  if (p.faction === 'lantids' && p.buildings.pi === 0) {
    const lfRevised = state.config.lostFleet && state.config.playerCount < 4;
    if (t.kind === 'lantids' || (lfRevised && t.kind === 'normal' && t.planet === 'terra')) {
      gainResources(p, { knowledge: 2 });
    }
  }
  // Geodens PI：建 PI 后首次在每种星球类型建矿 +3k（建 PI 前已殖民的类型不计）。
  if (p.faction === 'geodens' && p.buildings.pi === 0 && newPlanetType && !p.geodensTriggered.includes(t.planet)) {
    p.geodensTriggered.push(t.planet);
    gainResources(p, { knowledge: 3 });
  }
  // Darkanians PI：首次在每个 Space/Deep Space 扇区殖民 +2c+1k（Interspace 不算）。
  if (
    p.faction === 'darkanians' &&
    p.buildings.pi === 0 &&
    newSector &&
    !p.darkaniansTriggered.includes(hex.sector)
  ) {
    p.darkaniansTriggered.push(hex.sector);
    gainResources(p, { credits: 2, knowledge: 1 });
  }

  // 对手被动充能邀约（从行动者顺时针）。
  const offers = makeChargeOffers(state, idx, hexKey);
  state.pending = offers.length > 0 ? { kind: 'charge', queue: offers } : null;
}
