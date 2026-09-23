/**
 * 行动评分：scoreAction(ctx, action) 纯函数快评（不仿真），折算 VP 等值。
 * 框架与 v1 一致，差异：
 * - 权重全部走 ctx.cfg（可调参、变体/族增量已合并）；
 * - 回合计分板看本轮 + 下轮（scoringVp，下轮按 nextRoundMult 折预期）；
 * - 充能/leech 叠阶段倍率（R1-4 雪球期 >1，R6 <1）；
 * - 联邦第 3 个额外奖励（社区共识：3 联邦是获胜底线）；
 * - 族 hook 在通用评分后统一修正（scoreAction 出口）。
 */
import {
  BOARD_ACTIONS,
  BOOSTERS,
  BUILDING_COST,
  BUILDING_POWER_VALUE,
  EXPLORE_SHIP_COST_VP,
  EXPLORE_SHIP_COST_VP_BALTAKS,
  FACTIONS,
  FEDERATION_TOKENS,
  FREE_CONVERSIONS,
  HOME_PLANET_TYPES,
  INSPECT_ARTIFACT_COST_POWER,
  SHIP_ACTIONS,
  buildingPowerValue,
  colonizedHexes,
  countUnits,
  hexesWithin,
  mapNeighbors,
  minDistanceToAny,
  rangeOf,
  terraformStepsFor,
  type Action,
  type BoardActionId,
  type FederationTokenId,
  type GameState,
  type HexKey,
  type PlanetType,
  type PlayerIndex,
  type PlayerState,
  type ResearchTrack,
  type ResourceGain,
  type SpecialActionId,
  type TinkeringTileId,
} from '@gaia/engine';
import type { EvalCtx } from './context.js';
import {
  advTechTileValue,
  boosterValue,
  costValue,
  federationTokenValue,
  gainValue,
  incomeNpv,
  researchLevelValue,
  roundTile,
  scoringVp,
  techTileValue,
} from './values.js';

// ---------------------------------------------------------------------------
// 局面小工具
// ---------------------------------------------------------------------------

/** 射程起点（引擎 rangeSources 的近似：已殖民 hex + 空间站 + Lost Planet 卫星）。 */
function rangeSources(state: GameState, seat: PlayerIndex): HexKey[] {
  const out = colonizedHexes(state.map, seat);
  for (const [key, hex] of Object.entries(state.map)) {
    if (hex.building?.type === 'sp' && hex.building.player === seat) {
      out.push(key as HexKey);
    }
    if (hex.planet === 'lost' && hex.satelliteOf === seat) {
      out.push(key as HexKey);
    }
  }
  return out;
}

/** terraform 每步 ore 费（terra 轨 L0-1=3、L2=2、L3+=1）。 */
function terraformCostPerStep(p: PlayerState): number {
  const lvl = p.research.terra;
  return lvl >= 3 ? 1 : lvl === 2 ? 2 : 3;
}

/** gaia 星球居住费：gleens 1o；LF 无母星族 2q；其余 1q。 */
function gaiaFee(p: PlayerState): { ore: number; qic: number } {
  if (p.faction === 'gleens') return { ore: 1, qic: 0 };
  if (FACTIONS[p.faction].homePlanet === null) return { ore: 0, qic: 2 };
  return { ore: 0, qic: 1 };
}

interface MineEstimate {
  planet: PlanetType;
  steps: number;
  ore: number;
  credits: number;
  qic: number;
  gaiaformerRecover: boolean;
  asteroid: boolean;
  newPlanetType: boolean;
  newSector: boolean;
}

/** build-mine 目标成本估算（computeMineTarget 的近似，普通建矿无免费步）。 */
function estimateMine(ctx: EvalCtx, hexKey: HexKey): MineEstimate | null {
  const { state, seat } = ctx;
  const p = ctx.me;
  const hex = state.map[hexKey];
  if (hex === undefined) return null;
  const planet = hex.planet;
  const isHome = (HOME_PLANET_TYPES as readonly string[]).includes(planet);
  if (!isHome && planet !== 'gaia' && planet !== 'proto' && planet !== 'asteroid') {
    return null;
  }
  const gaiaformerRecover = planet === 'gaia' && hex.gaiaformerOf === seat;
  let steps = 0;
  let ore = 0;
  let credits = 0;
  let qic = 0;
  if (planet === 'asteroid') {
    // 免矿费，牺牲 1 gaiaformer。
  } else if (planet === 'gaia') {
    if (!gaiaformerRecover) {
      const fee = gaiaFee(p);
      ore += fee.ore;
      qic += fee.qic;
    }
  } else {
    steps = terraformStepsFor(p, planet);
  }
  ore += steps * terraformCostPerStep(p);
  if (planet !== 'asteroid') {
    ore += 1;
    credits += 2;
  }
  if (!gaiaformerRecover) {
    const need = minDistanceToAny(state.map, rangeSources(state, seat), hexKey) - rangeOf(p);
    if (need > 0) qic += Math.ceil(need / 2);
  }
  const newPlanetType = !p.colonizedPlanetTypes.includes(planet);
  const newSector = hex.sector !== 'interspace' && !p.colonizedSectors.includes(hex.sector);
  return { planet, steps, ore, credits, qic, gaiaformerRecover, asteroid: planet === 'asteroid', newPlanetType, newSector };
}

/** 对手充能邀约惩罚：在 hex 建造送给对手的净充能收益（仅正部分）。 */
function chargePenalty(ctx: EvalCtx, hexKey: HexKey): number {
  const { state, seat } = ctx;
  const mult = ctx.cfg.phase[ctx.phase].chargeMult;
  let penalty = 0;
  const near = hexesWithin(state.map, hexKey, 2);
  for (const j of state.players.map((_, i) => i)) {
    if (j === seat) continue;
    let maxPv = 0;
    for (const h of near) {
      const hex = state.map[h]!;
      maxPv = Math.max(maxPv, buildingPowerValue(state, j, hex));
      if (hex.additionalMine === j) maxPv = Math.max(maxPv, 1);
      if (hex.planet === 'lost' && hex.satelliteOf === j) maxPv = Math.max(maxPv, 1);
    }
    if (maxPv > 0) {
      penalty += Math.max(
        0,
        maxPv * ctx.cfg.resources.chargePower * mult - (maxPv - 1) * ctx.cfg.charge.vpCostRate,
      );
    }
  }
  return penalty;
}

/** hex 2 格内己方建筑 pv 合计 + extraPv（联邦组潜力：新建筑加入的组）。
 *  已入联邦的格子及其邻格（禁入区——不能再参与新联邦）不计入。 */
function nearbyGroupPv(ctx: EvalCtx, hexKey: HexKey, extraPv: number): number {
  let pv = extraPv;
  for (const h of hexesWithin(ctx.state.map, hexKey, 2)) {
    const hex = ctx.state.map[h]!;
    if (hex.federations.includes(ctx.seat)) continue;
    let nearFed = false;
    for (const nb of mapNeighbors(ctx.state.map, h)) {
      if (ctx.state.map[nb]?.federations.includes(ctx.seat) === true) {
        nearFed = true;
        break;
      }
    }
    if (nearFed) continue;
    pv += buildingPowerValue(ctx.state, ctx.seat, hex);
  }
  return pv;
}

/** 联邦组价值（凸形）：(min(pv,7)/7)²×weight——组越接近 7 电拉力越强。 */
export function fedGroupValue(pv: number, weight: number): number {
  const t = Math.min(pv, 7) / 7;
  return t * t * weight;
}

/**
 * 连通分量贴建价值：pv≤7 按凸形增长（养到 7 = 零卫星联邦），**超过 7 贬值**
 * ——理想形状：一个分量养到 7（联邦 #1），其余分量 3-4（两两合并成联邦
 * #2/#3）；分量超过 7 还贴建 = 浪费电力密度，且大分量合并时一个联邦吃掉
 * 所有建筑，毁掉其他潜在外援联邦。
 */
export function fedComponentValue(pv: number, weight: number): number {
  if (pv <= 7) return fedGroupValue(pv, weight);
  return fedGroupValue(7, weight) - (pv - 7) * 2;
}

interface OwnComponents {
  compOf: Map<HexKey, number>;
  pvs: number[];
}

/**
 * 己方建筑（未入联邦）的邻接连通分量（联邦形状的原子单位——引擎枚举按整个
 * 分量合并，所以"贴大"和"合并"都会毁掉潜在外援联邦）。additionalMine 计 pv1。
 * excludeFedAdjacent：把已入联邦格的**邻格**也排除（禁入区——这些建筑再也
 * 进不了新联邦；叶估值的联邦潜力用，行动级凑组在 nearbyGroupPv 单独排除）。
 */
export function ownComponents(
  state: GameState,
  seat: PlayerIndex,
  opts?: { excludeFedAdjacent?: boolean },
): OwnComponents {
  const ownSet = new Set<HexKey>();
  for (const [key, hex] of Object.entries(state.map)) {
    if (hex.federations.includes(seat)) continue;
    if (hex.building?.player === seat || hex.additionalMine === seat) {
      ownSet.add(key as HexKey);
    }
  }
  if (opts?.excludeFedAdjacent === true) {
    for (const key of [...ownSet]) {
      for (const nb of mapNeighbors(state.map, key)) {
        if (state.map[nb]?.federations.includes(seat) === true) {
          ownSet.delete(key);
          break;
        }
      }
    }
  }
  const compOf = new Map<HexKey, number>();
  const pvs: number[] = [];
  for (const start of ownSet) {
    if (compOf.has(start)) continue;
    const id = pvs.length;
    let pv = 0;
    const queue: HexKey[] = [start];
    compOf.set(start, id);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const hex = state.map[cur]!;
      pv +=
        hex.additionalMine === seat && hex.building?.player !== seat
          ? 1
          : buildingPowerValue(state, seat, hex);
      for (const nb of mapNeighbors(state.map, cur)) {
        if (ownSet.has(nb) && !compOf.has(nb)) {
          compOf.set(nb, id);
          queue.push(nb);
        }
      }
    }
    pvs.push(pv);
  }
  return { compOf, pvs };
}

/** 与 hex 相邻的己有分量 id 集合（贴建/合并判定）。 */
function touchingComponents(comps: OwnComponents, state: GameState, hexKey: HexKey): Set<number> {
  const out = new Set<number>();
  for (const nb of mapNeighbors(state.map, hexKey)) {
    const c = comps.compOf.get(nb);
    if (c !== undefined) out.add(c);
  }
  return out;
}

/** 与己方建筑群的最近距离（联邦潜力；无己方建筑时返回 null）。 */
function ownClusterDistance(state: GameState, seat: PlayerIndex, hexKey: HexKey): number | null {
  const own = colonizedHexes(state.map, seat).filter((h) => h !== hexKey);
  if (own.length === 0) return null;
  return minDistanceToAny(state.map, own, hexKey);
}

/** 面板收入轨揭开格的 NPV：该建筑放上地图后新揭开的收入。 */
function uncoverIncomeNpv(
  ctx: EvalCtx,
  building: 'mine' | 'ts' | 'lab' | 'pi' | 'ac1' | 'ac2',
): number {
  const p = ctx.me;
  const track = FACTIONS[p.faction].incomeTrack;
  let gain: ResourceGain | null = null;
  switch (building) {
    case 'mine':
      gain = track.mine[8 - p.buildings.mine] ?? null;
      break;
    case 'ts':
      gain = track.ts[4 - p.buildings.ts] ?? null;
      break;
    case 'lab':
      gain = track.lab[3 - p.buildings.lab] ?? null;
      break;
    case 'pi':
      gain = track.pi;
      break;
    case 'ac1':
      gain = track.ac1;
      break;
    case 'ac2':
      gain = null;
      break;
  }
  return gain !== null ? incomeNpv(ctx, gain) : 0;
}

/**
 * 翻绿面联邦标记的机会成本（L5 研究/高级板门票）：标记 vp 组建时已入账，
 * 翻面只损失"未来重结算的即时资源 + 绿面门票资格"——按资源面折价
 * （多枚可翻时优先翻低价值标记）。
 */
function flipTokenCost(ctx: EvalCtx, tokenId: FederationTokenId): number {
  const def = FEDERATION_TOKENS[tokenId];
  const rescore = def.other !== undefined ? gainValue(ctx, def.other) : 0;
  // 门票的真实价格 ≈ 高级片机会（12-16 VP 级）：L5 爬轨和高级片抢同一张票，
  // 定价过低会让 L5 总是先把票烧掉，高级片永远拿不到。
  return 3 + 0.25 * rescore;
}

// ---------------------------------------------------------------------------
// 各行动评分
// ---------------------------------------------------------------------------

function scoreBuildMine(ctx: EvalCtx, hexKey: HexKey): number {
  const t = estimateMine(ctx, hexKey);
  if (t === null) return -100;
  const cfg = ctx.cfg.mine;
  const expansion = ctx.cfg.phase[ctx.phase].expansionMult;
  let s = cfg.base;
  s += uncoverIncomeNpv(ctx, 'mine');
  s += scoringVp(ctx, 'build-mine');
  if (t.steps > 0) s += scoringVp(ctx, 'terraform-step', t.steps);
  if (t.planet === 'gaia') s += scoringVp(ctx, 'build-mine-gaia');
  if (t.newSector) s += scoringVp(ctx, 'build-mine-new-sector');
  if (t.newPlanetType) s += scoringVp(ctx, 'build-mine-new-planet-type');
  if (t.planet === 'proto') s += cfg.protoVp;
  if (t.newPlanetType) s += cfg.newPlanetType * expansion;
  if (t.newSector) s += cfg.newSector * expansion;
  if (t.gaiaformerRecover) s += cfg.gaiaformerRecover;
  if (t.asteroid) s -= cfg.asteroidPenalty;
  // 联邦凑组（连通分量感知）：贴单分量给凸形（超 8 惩罚贴大），合并多分量
  // 重罚（毁掉多个潜在外援联邦），全新种子按 2 格桥接潜力半价。乘阶段倍率。
  // 联邦缺口期（held < target−1）簇拉力加成——联邦数朝 targetCount 推进。
  const fedDeficit = Math.max(0, ctx.cfg.federation.targetCount - 1 - ctx.me.federationTokens.length);
  const clusterMult =
    ctx.cfg.phase[ctx.phase].clusterMult *
    (1 + fedDeficit * ctx.cfg.federation.deficitClusterBoost);
  const comps = ownComponents(ctx.state, ctx.seat);
  const touching = touchingComponents(comps, ctx.state, hexKey);
  if (touching.size === 0) {
    // 新种子：2 格内可桥接的己方 pv 给全额凸形——种子要落在能与既有小分量
    // 卫星合并成联邦的位置，否则只会再多一个孤岛分量。
    s += fedGroupValue(nearbyGroupPv(ctx, hexKey, 1), cfg.clusterPv) * clusterMult;
  } else if (touching.size === 1) {
    const after = comps.pvs[[...touching][0]!]! + 1;
    s += fedComponentValue(after, cfg.clusterPv) * clusterMult;
  } else {
    let mergedPv = 1;
    for (const c of touching) mergedPv += comps.pvs[c]!;
    s -= mergedPv * 0.5 * clusterMult; // 合并分量罚（轻——有时不可避免）
  }
  // 成长空间：2 格内可殖民空星球数——簇还能扩多大（避免死胡同簇）。
  let room = 0;
  for (const h of hexesWithin(ctx.state.map, hexKey, 2)) {
    const hex = ctx.state.map[h]!;
    if (COLONIZABLE.has(hex.planet) && hex.building === undefined && hex.additionalMine === undefined) {
      room++;
    }
  }
  s += room * cfg.growthRoom;
  // leech 吸附：2 格内对手建筑是未来充能来源（人类对局 leech 贡献 10-40 VP）。
  let leechSources = 0;
  for (const h of hexesWithin(ctx.state.map, hexKey, 2)) {
    const hex = ctx.state.map[h]!;
    if (hex.building !== undefined && hex.building.player !== ctx.seat) leechSources++;
    else if (hex.additionalMine !== undefined && hex.additionalMine !== ctx.seat) leechSources++;
  }
  s += leechSources * cfg.leechPull * ctx.cfg.phase[ctx.phase].chargeMult;
  s -= chargePenalty(ctx, hexKey);
  const R = ctx.cfg.resources;
  s -= t.ore * R.ore + t.credits * R.credits + t.qic * R.qic;
  return s;
}

function scoreGaiaProject(ctx: EvalCtx): number {
  const cfg = ctx.cfg.gaiaProject;
  if (ctx.state.round >= 6) return -cfg.lastRoundPenalty;
  let s = cfg.base;
  s += scoringVp(ctx, 'build-mine-gaia') * 0.3; // 下轮才转化，仅给微弱信号
  s += countUnits(ctx.state, ctx.seat, 'gaia-planet') === 0 ? cfg.firstGaia : 0;
  const lvl = ctx.me.research.gaia;
  const cost = lvl >= 4 ? 3 : lvl >= 3 ? 4 : 6;
  s -= cost * cfg.powerCostRate;
  return s;
}

function scoreUpgrade(ctx: EvalCtx, action: Extract<Action, { type: 'upgrade' }>): number {
  const { state, seat } = ctx;
  const p = ctx.me;
  const hexKey = action.hex;
  const to = action.to;
  let s = 0;
  let cost: { ore: number; credits: number };
  if (to === 'ts') {
    const near = hexesWithin(state.map, hexKey, 2);
    const adjacent = near.some((h) => {
      const b = state.map[h]?.building;
      return b !== undefined && b.player !== seat && BUILDING_POWER_VALUE[b.type] > 0;
    });
    cost = adjacent ? BUILDING_COST.tsAdjacent : BUILDING_COST.ts;
  } else if (to === 'lab') {
    cost = BUILDING_COST.lab;
  } else if (to === 'pi') {
    cost = BUILDING_COST.pi;
  } else {
    cost = BUILDING_COST.academy;
  }
  const R = ctx.cfg.resources;
  s -= cost.ore * R.ore + cost.credits * R.credits;
  s += uncoverIncomeNpv(ctx, to);
  if (action.techTile !== undefined) {
    s += techTileValue(ctx, action.techTile);
  }
  if (action.advTechTile !== undefined) {
    s += advTechTileValue(ctx, action.advTechTile) + ctx.cfg.tech.advPremium - 1;
  }
  if (action.research !== undefined && action.research !== null) {
    const lvl = p.research[action.research];
    s += researchLevelValue(ctx, action.research, lvl + 1);
  }
  if (action.flipToken !== undefined) {
    s -= flipTokenCost(ctx, action.flipToken) - (action.advTechTile !== undefined ? 1 : 0);
  }
  const pvGain = to === 'ts' ? 1 : to === 'lab' ? 1 : to === 'pi' ? 2 : 1;
  // 升级后的组 pv 密度（含增量）的凸形价值——TS/PI/AC 是凑联邦的功率来源。
  s += fedGroupValue(nearbyGroupPv(ctx, hexKey, pvGain), ctx.cfg.upgrade.pvGain);
  // 贴大惩罚：所在分量超 7 pv 后，继续堆 pv 是在浪费潜在外援联邦。
  {
    const comps = ownComponents(ctx.state, ctx.seat);
    const compId = comps.compOf.get(hexKey);
    if (compId !== undefined) {
      const after = comps.pvs[compId]! + pvGain;
      if (after > 7) s -= (after - 7) * 2 * ctx.cfg.phase[ctx.phase].clusterMult;
    }
  }
  if (to === 'ts') s += ctx.cfg.upgrade.tsBonus; // TS 是经济骨干
  if (to === 'pi') s += ctx.cfg.upgrade.piUnlock;
  if (to === 'ac1' || to === 'ac2') {
    // 第二座学院：6o+6c 极贵且 AC2 无收入轨——通常不如升 TS/PI。
    const acOnMap = (p.buildings.ac1 === 0 ? 1 : 0) + (p.buildings.ac2 === 0 ? 1 : 0);
    if (acOnMap >= 1) s -= ctx.cfg.upgrade.secondAcademyPenalty;
  }
  if (to === 'ts') s += scoringVp(ctx, 'upgrade-ts');
  if (to === 'pi' || to === 'ac1' || to === 'ac2') s += scoringVp(ctx, 'upgrade-pi-academy');
  if (to === 'lab') s += scoringVp(ctx, 'build-lab');
  return s;
}

function scoreFormFederation(
  ctx: EvalCtx,
  action: Extract<Action, { type: 'form-federation' }>,
): number {
  const cfg = ctx.cfg.federation;
  let s = cfg.base;
  s += federationTokenValue(ctx, action.token);
  s += scoringVp(ctx, 'form-federation');
  s += cfg.perHex * action.hexes.length;
  s -= cfg.satelliteCost * action.satellites.length;
  s += cfg.satelliteProgress * action.satellites.length;
  // 第 targetCount 联邦是获胜底线（社区共识）；LF 环境整体分数更高，超出
  // 目标后再多一个也给一半奖励。
  const held = ctx.me.federationTokens.length;
  const target = ctx.cfg.federation.targetCount;
  if (held === target - 1) s += cfg.thirdBonus;
  else if (held >= target && ctx.variant === 'lostFleet') s += cfg.thirdBonus / 2;
  return s;
}

/** 可殖民行星类型（empty=太空格；transdim 需盖亚计划；lost 由 nav L5 放置）。 */
const COLONIZABLE: ReadonlySet<string> = new Set([
  'terra', 'desert', 'swamp', 'oxide', 'volcanic', 'titanium', 'ice', 'gaia', 'proto', 'asteroid',
]);

/** 射程 range 下可及的可殖民行星数（未被自己殖民的）。 */
function reachablePlanets(state: GameState, seat: PlayerIndex, range: number): number {
  const sources = rangeSources(state, seat);
  let n = 0;
  for (const [key, hex] of Object.entries(state.map)) {
    if (!COLONIZABLE.has(hex.planet)) continue;
    if (hex.building?.player === seat) continue;
    if (minDistanceToAny(state.map, sources, key as HexKey) <= range) n++;
  }
  return n;
}

function scoreResearch(ctx: EvalCtx, action: Extract<Action, { type: 'research' }>): number {
  const p = ctx.me;
  const lvl = p.research[action.track];
  let s = researchLevelValue(ctx, action.track, lvl + 1);
  // 集中爬轨拉力：L2 起每步 +1.5——人类 2-3 轨爬高吃里程碑（L3/4/5 各 4vp）
  // 与高级片槽位，六轨撒胡椒是负 EV（里程碑够不着、高级片槽不开）。
  if (lvl >= 2) s += 1.5;
  // nav 的真实价值是解锁可及星球（静态射程价值会系统性低估）：每颗新可及
  // 星球 ≈ 3 VP 当量（未来建矿净值的一部分）。
  if (action.track === 'nav') {
    const before = reachablePlanets(ctx.state, ctx.seat, rangeOf(p));
    const after = reachablePlanets(ctx.state, ctx.seat, rangeOf(p) + 1);
    s += (after - before) * 3;
  }
  s += scoringVp(ctx, 'research');
  s -= 4 * ctx.cfg.resources.knowledge;
  if (action.flipToken !== undefined) {
    s -= flipTokenCost(ctx, action.flipToken);
    // L5 与高级片抢同一张票：已有 L4 轨+可覆盖片时，烧票爬 L5 还要亏掉
    // 高级片机会（12-16 VP 级）——门票留给高级片。
    const hasL4 = Object.values(ctx.me.research).some((l) => l >= 4);
    const covered = new Set(ctx.me.advTechTiles.map((t) => t.covers));
    if (hasL4 && ctx.me.techTiles.some((t) => !covered.has(t))) s -= 6;
  }
  return s;
}

/** 高级片三条件是否齐备（L4+ 轨 + 未翻绿面标记 + 可覆盖标准片）。 */
function advTicketReady(ctx: EvalCtx): boolean {
  const p = ctx.me;
  const hasL4 = Object.values(p.research).some((l) => l >= 4);
  const hasFlip = p.federationTokens.some(
    (t) => !t.flipped && FEDERATION_TOKENS[t.id].flippable === true,
  );
  const covered = new Set(p.advTechTiles.map((t) => t.covers));
  const hasCover = p.techTiles.some((t) => !covered.has(t));
  return hasL4 && hasFlip && hasCover;
}

/** board action（power/qic 格）效果估值。 */
function boardActionEffectValue(ctx: EvalCtx, id: BoardActionId): number {
  const def = BOARD_ACTIONS[id];
  switch (def.effect.kind) {
    case 'gain':
      return gainValue(ctx, def.effect.gain);
    case 'build-mine':
      return ctx.cfg.boardAction.buildMine;
    case 'gain-tech-tile':
      // 条件齐备时这个行动格的真实价值是高级片（12-16 VP 级），不是标准片。
      return advTicketReady(ctx) ? 12 : ctx.cfg.boardAction.gainTechTile;
    case 'rescore-federation': {
      let best = 0;
      for (const t of ctx.me.federationTokens) {
        const def2 = FEDERATION_TOKENS[t.id];
        best = Math.max(best, def2.other !== undefined ? gainValue(ctx, def2.other) : 0);
      }
      return best;
    }
    case 'vp-per-planet-type':
      return def.effect.base + def.effect.perType * countUnits(ctx.state, ctx.seat, 'planet-type');
  }
}

function scoreBoardAction(
  ctx: EvalCtx,
  id: BoardActionId,
  payload: { hex?: HexKey } | undefined,
): number {
  const def = BOARD_ACTIONS[id];
  let s = boardActionEffectValue(ctx, id);
  s -= costValue(ctx, def.cost);
  s -= ctx.cfg.boardAction.slotCostPerRound * ctx.state.round;
  if (def.effect.kind === 'build-mine') {
    s += scoringVp(ctx, 'build-mine') + scoringVp(ctx, 'terraform-step', def.effect.freeTerraformSteps);
    if (payload?.hex !== undefined) s -= chargePenalty(ctx, payload.hex);
  }
  return s;
}

/** Tinkering tile 效果估值（choose-tinkering 与 tinkeroids-tile 共用）。 */
function tinkeringTileValue(ctx: EvalCtx, tile: TinkeringTileId): number {
  const R = ctx.cfg.resources;
  switch (tile) {
    case 'tink1':
      return 5;
    case 'tink4':
      return 8;
    case 'tink2':
      return 4 * R.chargePower;
    case 'tink3':
      return R.qic;
    case 'tink5':
      return 3 * R.knowledge;
    case 'tink6':
      return 2 * R.qic;
  }
}

/** 特殊行动估值（科技板/助推器/种族来源）。 */
function scoreSpecialAction(
  ctx: EvalCtx,
  id: SpecialActionId,
  payload: { hex?: HexKey; track?: ResearchTrack } | undefined,
): number {
  const R = ctx.cfg.resources;
  switch (id) {
    case 'tech9':
      return 4 * R.chargePower;
    case 'advtech3':
      return gainValue(ctx, { qic: 1, credits: 5 });
    case 'advtech11':
      return gainValue(ctx, { ore: 3 });
    case 'advtech13':
      return gainValue(ctx, { knowledge: 3 });
    case 'booster4':
    case 'space-giants-mine': {
      let s = ctx.cfg.boardAction.buildMine + scoringVp(ctx, 'build-mine') + scoringVp(ctx, 'terraform-step', 1);
      if (payload?.hex !== undefined) s -= chargePenalty(ctx, payload.hex);
      return s;
    }
    case 'booster5':
      return 4;
    case 'boosterlf4':
      return 4;
    case 'ac2':
      return ctx.me.faction === 'baltaks' ? gainValue(ctx, { credits: 4 }) : gainValue(ctx, { qic: 1 });
    case 'ivits-sp':
      return 3;
    case 'ambas-swap':
      return 2;
    case 'firaks-down': {
      if (payload?.track !== undefined) {
        const lvl = ctx.me.research[payload.track];
        return researchLevelValue(ctx, payload.track, lvl + 1) - 1;
      }
      return 2;
    }
    case 'bescods-up': {
      const p = ctx.me;
      const track = (Object.entries(p.research) as [ResearchTrack, number][]).sort(
        (a, b) => a[1] - b[1],
      )[0]?.[0];
      return track !== undefined ? researchLevelValue(ctx, track, p.research[track] + 1) : 2;
    }
    case 'gleens-range':
      return 2;
    case 'moweyds-ring':
      return 2;
    case 'tinkeroids-tile': {
      const tile = ctx.me.tinkering.current ?? null;
      let s = tile !== null ? tinkeringTileValue(ctx, tile) : 1;
      if ((tile === 'tink1' || tile === 'tink4') && payload?.hex !== undefined) {
        s -= chargePenalty(ctx, payload.hex);
      }
      return s;
    }
  }
}

function scoreShipAction(ctx: EvalCtx, action: Extract<Action, { type: 'ship-action' }>): number {
  const def = SHIP_ACTIONS[action.action];
  const cfg = ctx.cfg.ship;
  let s = 0;
  switch (def.effect.kind) {
    case 'rescore-federation-full': {
      let best = 0;
      for (const t of ctx.me.federationTokens) {
        const d = FEDERATION_TOKENS[t.id];
        best = Math.max(best, d.other !== undefined ? gainValue(ctx, d.other) : 0);
      }
      s = best + 1;
      break;
    }
    case 'vp-per-planet-type':
      s = def.effect.base + def.effect.perType * countUnits(ctx.state, ctx.seat, 'planet-type');
      break;
    case 'gain-tech-tile':
      s = advTicketReady(ctx) ? 12 : cfg.gainTechTile;
      break;
    case 'vp-per-standard-tech-tile':
      s = def.effect.base + def.effect.perTile * countUnits(ctx.state, ctx.seat, 'standard-tech-tile');
      break;
    case 'free-upgrade':
      s = def.effect.to === 'lab' ? cfg.freeUpgradeLab : cfg.freeUpgradeTs;
      break;
    case 'research': {
      const p = ctx.me;
      const best = Math.max(
        ...(Object.keys(p.research) as ResearchTrack[]).map((t) =>
          researchLevelValue(ctx, t, p.research[t] + 1),
        ),
      );
      s = best;
      break;
    }
    case 'gaia-project-immediate':
      s = cfg.gaiaImmediate;
      break;
    case 'range':
      s = cfg.range;
      break;
    case 'gain':
      s = gainValue(ctx, def.effect.gain);
      break;
    case 'build-mine':
      s = cfg.buildMine + scoringVp(ctx, 'build-mine') + scoringVp(ctx, 'terraform-step', 1);
      break;
    case 'build-mine-asteroid':
      s = cfg.buildMineAsteroid + scoringVp(ctx, 'build-mine');
      break;
  }
  s -= costValue(ctx, def.cost);
  s -= ctx.cfg.boardAction.slotCostPerRound * ctx.state.round;
  return s;
}

function scoreExploreShip(ctx: EvalCtx): number {
  const p = ctx.me;
  const vpCost = p.faction === 'baltaks' ? EXPLORE_SHIP_COST_VP_BALTAKS : EXPLORE_SHIP_COST_VP;
  let s = ctx.cfg.explore.valuePerRoundLeft * ctx.roundsLeft - vpCost;
  // 前期上飞船优先：首船全额 earlyBonus×roundsLeft/5，
  // 第 2 艘减半、第 3 艘 1/4——早上船早解锁行动格/舰载板/第 7 高级槽。
  const shipOrderMult = p.shuttles.length === 0 ? 1 : p.shuttles.length === 1 ? 0.5 : 0.25;
  s += ctx.cfg.explore.earlyShipBonus * Math.min(1, ctx.roundsLeft / 5) * shipOrderMult;
  if (p.faction === 'nevlas' || p.faction === 'itars' || p.faction === 'taklons') {
    s -= ctx.cfg.explore.factionPenalty;
  }
  return s;
}

function scoreInspectArtifact(
  ctx: EvalCtx,
  action: Extract<Action, { type: 'inspect-artifact' }>,
): number {
  const p = ctx.me;
  let v = 5;
  switch (action.artifact) {
    case 'art-asteroid':
    case 'art-proto':
      v = 7;
      break;
    case 'art-sci':
      v = 3 * p.research.sci;
      break;
    case 'art-gaia':
      v = 3 * p.research.gaia;
      break;
    case 'art-track':
      v = 3 * Object.values(p.research).filter((l) => l >= 3).length;
      break;
    case 'art-planet':
      v = 3 + countUnits(ctx.state, ctx.seat, 'planet-type');
      break;
    case 'art-deep':
      v = 3 * countUnits(ctx.state, ctx.seat, 'deep-space-sector');
      break;
    case 'art-fed':
      v = 3;
      break;
    case 'art-1k1o':
      v = incomeNpv(ctx, { knowledge: 1, ore: 1 });
      break;
    case 'art-pwt':
      v = incomeNpv(ctx, { powerToken: 2 });
      break;
    case 'art-3c3o':
      v = gainValue(ctx, { credits: 3, ore: 3 });
      break;
    case 'art-3k1q':
      v = gainValue(ctx, { knowledge: 3, qic: 1 });
      break;
    case 'art-5c2o':
      v = gainValue(ctx, { credits: 5, ore: 2 });
      break;
  }
  return v - INSPECT_ARTIFACT_COST_POWER * ctx.cfg.resources.chargePower;
}

function scorePass(ctx: EvalCtx, action: Extract<Action, { type: 'pass' }>): number {
  const { state, seat } = ctx;
  const p = ctx.me;
  let s = 0;
  if (p.booster !== null) {
    const def = BOOSTERS[p.booster];
    if (def.passVp !== undefined) {
      s += countUnits(state, seat, def.passVp.per) * def.passVp.vp;
    }
  }
  // 新助推器只计「新−旧」差值（全额 NPV 会压过一切主行动导致每轮直接 Pass）。
  if (action.booster !== null) {
    const newValue = boosterValue(ctx, action.booster);
    const oldValue = p.booster !== null ? boosterValue(ctx, p.booster) : 0;
    s += newValue - oldValue;
  } else {
    s -= ctx.cfg.pass.lastRoundNaked;
  }
  if (state.passedPlayers.length === 0 && state.round < 6) s += ctx.cfg.pass.firstPassBonus;
  const canAct =
    (p.resources.ore >= 1 && p.resources.credits >= 2 && p.buildings.mine > 0) ||
    p.resources.knowledge >= 4;
  if (canAct) s -= ctx.cfg.pass.tempoPenaltyPerRound * (7 - Math.max(1, state.round));
  return s;
}

function scoreFreeConversion(
  ctx: EvalCtx,
  action: Extract<Action, { type: 'free-conversion' }>,
): number {
  const def = FREE_CONVERSIONS[action.conversion];
  let s = gainValue(ctx, def.gain) - costValue(ctx, def.cost);
  if (def.cost.gaiaformer !== undefined) s -= def.cost.gaiaformer * 2;
  if (s < 0) {
    const r = ctx.me.resources;
    const canAffordSomething = r.ore >= 1 && r.credits >= 2;
    if (canAffordSomething) s = Math.max(s, -0.1);
  }
  return s;
}

function scorePlaceInitialMine(ctx: EvalCtx, hexKey: HexKey): number {
  const { state, seat } = ctx;
  const cfg = ctx.cfg.setup;
  const hex = state.map[hexKey];
  if (hex === undefined) return -100;
  const steps = terraformStepsFor(ctx.me, hex.planet);
  let s = cfg.base - cfg.perTerraformStep * steps;
  const near = hexesWithin(state.map, hexKey, 2);
  for (const h of near) {
    const b = state.map[h]?.building;
    if (b !== undefined && b.player !== seat) s += cfg.nearOpponent;
  }
  const dist = ownClusterDistance(state, seat, hexKey);
  // 初始矿聚拢是联邦的种子：dist≤2 全额、dist≤3 减半（人类开局同区放矿）。
  if (dist !== null && dist <= 2) s += cfg.cluster;
  else if (dist !== null && dist <= 3) s += cfg.cluster / 2;
  if (hex.deepSpace) s += cfg.deepSpace;
  return s;
}

function scoreGainTechTile(
  ctx: EvalCtx,
  action: Extract<Action, { type: 'gain-tech-tile' }>,
): number {
  let s = 0;
  if (action.techTile !== null) s += techTileValue(ctx, action.techTile);
  if (action.advTechTile !== undefined) s += advTechTileValue(ctx, action.advTechTile) + ctx.cfg.tech.advPremium - 1;
  if (action.research !== undefined && action.research !== null) {
    const lvl = ctx.me.research[action.research];
    s += researchLevelValue(ctx, action.research, lvl + 1);
  }
  if (action.flipToken !== undefined) s -= flipTokenCost(ctx, action.flipToken) - 1;
  return s;
}

// ---------------------------------------------------------------------------
// scoreAction 出口
// ---------------------------------------------------------------------------

/** 通用评分（不含族 hook 修正）。 */
function scoreGeneric(ctx: EvalCtx, action: Action): number {
  switch (action.type) {
    case 'build-mine':
      return scoreBuildMine(ctx, action.hex);
    case 'start-gaia-project':
      return scoreGaiaProject(ctx);
    case 'upgrade':
      return scoreUpgrade(ctx, action);
    case 'form-federation':
      return scoreFormFederation(ctx, action);
    case 'research':
      return scoreResearch(ctx, action);
    case 'power-action':
    case 'qic-action':
      return scoreBoardAction(ctx, action.action, action.payload);
    case 'special-action':
      return scoreSpecialAction(ctx, action.action, action.payload);
    case 'ship-action':
      return scoreShipAction(ctx, action);
    case 'explore-ship':
      return scoreExploreShip(ctx);
    case 'inspect-artifact':
      return scoreInspectArtifact(ctx, action);
    case 'pass':
      return scorePass(ctx, action);
    case 'free-conversion':
      return scoreFreeConversion(ctx, action);
    case 'burn':
      return -0.3;
    case 'charge': {
      const pending = ctx.state.pending;
      if (pending?.kind === 'charge') {
        const offer = pending.queue[0];
        if (offer !== undefined) {
          const mult = ctx.cfg.phase[ctx.phase].chargeMult;
          return (
            offer.amount * ctx.cfg.resources.chargePower * mult -
            offer.vpCost * ctx.cfg.charge.vpCostRate
          );
        }
      }
      return 0;
    }
    case 'decline-charge':
      return 0;
    case 'place-initial-mine':
      return scorePlaceInitialMine(ctx, action.hex);
    case 'choose-booster':
      return boosterValue(ctx, action.booster, { forSetup: true });
    case 'itars-gaia-tech': {
      if (action.techTile === null && action.advTechTile === undefined) return 0.1;
      let s = -4 * ctx.cfg.resources.chargePower;
      if (action.techTile !== null) s += techTileValue(ctx, action.techTile);
      if (action.advTechTile !== undefined) s += advTechTileValue(ctx, action.advTechTile) + ctx.cfg.tech.advPremium - 1;
      if (action.flipToken !== undefined) s -= flipTokenCost(ctx, action.flipToken) - 1;
      return s;
    }
    case 'terrans-gaia-done':
      return 0;
    case 'choose-tinkering':
      return tinkeringTileValue(ctx, action.tile);
    case 'gain-tech-tile':
      return scoreGainTechTile(ctx, action);
    case 'free-mine': {
      if (action.hex === null) return 0;
      const t = estimateMine(ctx, action.hex);
      if (t === null) return 0;
      const R = ctx.cfg.resources;
      return scoreBuildMine(ctx, action.hex) + t.ore * R.ore + t.credits * R.credits + t.qic * R.qic;
    }
    case 'income-order':
      // tokens-first 通常 III 区更多（新 token 参与充能），微优
      return action.order === 'tokens-first' ? 0.2 : 0;
    case 'confirm-turn':
      return 0;
  }
}

/** 纯函数快评：通用评分 + 族 hook 修正。 */
export function scoreAction(ctx: EvalCtx, action: Action): number {
  const s = scoreGeneric(ctx, action);
  return ctx.hooks.adjustAction?.(s, action, ctx) ?? s;
}
