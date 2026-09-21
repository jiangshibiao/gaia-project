/**
 * 启发式行动评估器（HeuristicAgent）——LLM 预筛、降级兜底、bench 基线三用。
 *
 * scoreAction(state, seat, action) 纯函数快评（不仿真），全部折算 VP 等值
 * （价值尺度见 heuristic/values.ts）：
 * - build-mine：矿轨收入 NPV + 回合计分板匹配（建矿/terraform 步/Gaia 建矿/
 *   新扇区/新星球类型）+ proto +6vp + 新类型/新扇区终局进程 + gaiaformer 收回
 *   + 联邦潜力（与己方建筑群距离）+ asteroid 免矿性价比（报废 gaiaformer）
 *   − 对手充能邀约（2 格内对手建筑的最高 pv 折成的净收益是送对手的）− 成本。
 * - upgrade：收入轨揭开 NPV（TS 邻近折扣价）+ 拿板价值（科技板/高级板）+
 *   研究推进估值 + PI 种族能力解锁 + 联邦 pv 增量 + 回合计分板匹配 − 成本。
 * - research：按轨估值（terraform 折扣/射程/收入 NPV/gaiaformer/QIC，见
 *   values.researchLevelValue）+ L3/L4/L5 终局里程碑 + 回合计分板匹配 − 4k。
 * - form-federation：标记奖励 + 回合计分板 + structureFed 进程 − 卫星成本。
 * - power/qic/特殊/飞船行动：直接收益 − 费用 − 占格机会成本（随轮次加权）。
 * - explore-ship / inspect-artifact：解锁收益 − vp/power 成本。
 * - pass：旧助推器 pass VP + 新助推器「新−旧」差值（全额 NPV 会压过一切
 *   主行动导致每轮直接 Pass）+ 先手价值 − 自愿 pass 的节奏惩罚（还负担得
 *   起主行动时，越早轮次代价越大）；第 6 轮裸 pass 显著负分。
 * - free-conversion/burn：净资源差（一般为负，仅 pw1-c / o-t 等微正）。
 * - charge：接受 = amount×0.5 − vpCost；拒绝 = 0。
 * - setup：起始矿看 terraform 步数 + 对手依附充能 + 己方聚拢；起始助推器 =
 *   boosterValue 全额收入。
 * - 翻面门票（L5 研究/高级板/itars 盖亚换板）：按被翻标记的重结算价值折价
 *   （flipTokenCost，多枚可翻时优先翻最低价值标记）。
 * - choose-tinkering / tinkeroids-tile：按 tile 效果估值（建矿类 > 资源类）。
 *
 * 健壮性：safeScore 包裹 scoreAction——单个行动评分抛异常记 −1e9 排末位，
 * decide/prescreen 对任何 legal 输入都不抛、返回值恒在 legal 内（全灭时按
 * 确定性 tie-break 取 legal[0] 等效项）。空 legal 仍抛错（引擎契约不会调用）。
 *
 * prescreen：按 scoreAction 降序取 Top K（并列按 stableStringify 字典序，
 * 确定性）。HeuristicAgent：Top-1，reason 带分数简述。
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
  ROUND_SCORING,
  SHIP_ACTIONS,
  buildingPowerValue,
  colonizedHexes,
  countUnits,
  hexesWithin,
  minDistanceToAny,
  rangeOf,
  stableStringify,
  terraformStepsFor,
  type Action,
  type BoardActionId,
  type BoosterId,
  type FederationTokenId,
  type GameState,
  type HexKey,
  type PlanetType,
  type PlayerIndex,
  type PlayerState,
  type ResearchTrack,
  type ResourceGain,
  type SpecialActionId,
  type TechTileId,
  type TinkeringTileId,
} from '@gaia/engine';
import type { DecidingAgent, Decision } from './decision.js';
import {
  RESOURCE_VALUE,
  advTechTileValue,
  boosterValue,
  costValue,
  federationTokenValue,
  gainValue,
  incomeNpv,
  researchLevelValue,
  roundsLeft,
  techTileValue,
} from './heuristic/values.js';

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

/** terraform 每步 ore 费（terra 轨 L0-1=3、L2=2、L3+=1，data/research.ts）。 */
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
function estimateMine(state: GameState, seat: PlayerIndex, hexKey: HexKey): MineEstimate | null {
  const p = state.players[seat];
  const hex = state.map[hexKey];
  if (p === undefined || hex === undefined) return null;
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

/** 对手充能邀约惩罚：在 hex 建造送给对手的净充能收益（amount×0.5 − vpCost，仅正部分）。 */
function chargePenalty(state: GameState, seat: PlayerIndex, hexKey: HexKey): number {
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
      penalty += Math.max(0, maxPv * RESOURCE_VALUE.chargePower - (maxPv - 1));
    }
  }
  return penalty;
}

/** 与己方建筑群的最近距离（联邦潜力；无己方建筑时返回 null）。 */
function ownClusterDistance(state: GameState, seat: PlayerIndex, hexKey: HexKey): number | null {
  const own = colonizedHexes(state.map, seat).filter((h) => h !== hexKey);
  if (own.length === 0) return null;
  return minDistanceToAny(state.map, own, hexKey);
}

/** 面板收入轨揭开格的 NPV：该建筑放上地图后新揭开的收入。 */
function uncoverIncomeNpv(
  state: GameState,
  seat: PlayerIndex,
  building: 'mine' | 'ts' | 'lab' | 'pi' | 'ac1' | 'ac2',
): number {
  const p = state.players[seat]!;
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
      gain = null; // 学院2 是特殊行动格，无收入
      break;
  }
  return gain !== null ? incomeNpv(state, gain) : 0;
}

/** 本轮回合计分板（无则 null——setup 阶段 round=1 也有板）。 */
function roundTile(state: GameState) {
  const id = state.board.roundScoring[state.round - 1];
  return id !== undefined ? ROUND_SCORING[id] : null;
}

/**
 * 翻绿面联邦标记的机会成本（L5 研究/高级板门票）：翻面后该标记不能再被
 * qic2/ship-rescore/art-fed 重结算，按"标记 vp + 即时资源"的重结算价值折价。
 * 基本棋理：多枚可翻时优先翻最低价值的（fed6/gleens 先于 fed1/fedlf1）。
 */
function flipTokenCost(tokenId: FederationTokenId): number {
  const def = FEDERATION_TOKENS[tokenId];
  const rescore = def.vp + (def.other !== undefined ? gainValue(def.other) : 0);
  return 1 + 0.25 * rescore;
}

// ---------------------------------------------------------------------------
// 各行动评分
// ---------------------------------------------------------------------------

function scoreBuildMine(state: GameState, seat: PlayerIndex, hexKey: HexKey): number {
  const t = estimateMine(state, seat, hexKey);
  if (t === null) return -100;
  let s = 2; // 扩张基底（殖民计数/终局 structure 进程）
  s += uncoverIncomeNpv(state, seat, 'mine');
  const tile = roundTile(state);
  if (tile !== null) {
    if (tile.trigger.on === 'build-mine') s += tile.trigger.vp;
    if (tile.trigger.on === 'terraform-step') s += tile.trigger.vp * t.steps;
    if (tile.trigger.on === 'build-mine-gaia' && t.planet === 'gaia') s += tile.trigger.vp;
    if (tile.trigger.on === 'build-mine-new-sector' && t.newSector) s += tile.trigger.vp;
    if (tile.trigger.on === 'build-mine-new-planet-type' && t.newPlanetType) s += tile.trigger.vp;
  }
  if (t.planet === 'proto') s += 6; // LF 原行星建矿 +6vp
  if (t.newPlanetType) s += 2; // planetType 终局板 + tech2 进程
  if (t.newSector) s += 1.5; // sector 终局板进程
  if (t.gaiaformerRecover) s += 2.5; // 收回留置的 gaiaformer
  if (t.asteroid) s -= 3.5; // 报废 gaiaformer（免矿费 1o+2c 已计入成本侧）；asteroid 终局板进程约 +1 已含基底
  const dist = ownClusterDistance(state, seat, hexKey);
  if (dist !== null && dist <= 2) s += 1; // 联邦潜力：贴近己方建筑群
  else if (dist !== null && dist <= 3) s += 0.5;
  s -= chargePenalty(state, seat, hexKey);
  s -= t.ore * RESOURCE_VALUE.ore + t.credits * RESOURCE_VALUE.credits + t.qic * RESOURCE_VALUE.qic;
  return s;
}

function scoreGaiaProject(state: GameState, seat: PlayerIndex): number {
  const p = state.players[seat]!;
  // 盖亚计划下轮才转化：最后 1 轮启动是纯亏。
  if (state.round >= 6) return -50;
  let s = 3; // 解锁 transdim 星球 + 下轮回合 Gaia 建矿（配合 score6/9 与 tech7）
  const tile = roundTile(state);
  if (tile !== null && (tile.trigger.on === 'build-mine-gaia' || tile.trigger.on === 'terraform-step')) {
    s += 1; // 下轮板不可知，仅本轮板给微弱信号
  }
  s += countUnits(state, seat, 'gaia-planet') === 0 ? 1 : 0; // 首个 Gaia 星球（终局板/类型）
  // 移入 Gaia 区的 power 下轮才回 I 区：机会成本。
  const lvl = p.research.gaia;
  const cost = lvl >= 4 ? 3 : lvl >= 3 ? 4 : 6;
  s -= cost * 0.3;
  return s;
}

function scoreUpgrade(
  state: GameState,
  seat: PlayerIndex,
  action: Extract<Action, { type: 'upgrade' }>,
): number {
  const p = state.players[seat]!;
  const hexKey = action.hex;
  const to = action.to;
  let s = 0;
  // 成本（TS 邻近折扣：2 格内有对手建筑 2o+3c，否则 2o+6c）
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
  s -= cost.ore * RESOURCE_VALUE.ore + cost.credits * RESOURCE_VALUE.credits;
  s += uncoverIncomeNpv(state, seat, to);
  // 拿科技板（lab/PI/学院）
  if (action.techTile !== undefined) {
    s += techTileValue(state, seat, action.techTile);
  }
  if (action.advTechTile !== undefined) {
    s += advTechTileValue(state, seat, action.advTechTile) - 1; // 翻绿面标记门票
  }
  if (action.research !== undefined && action.research !== null) {
    const lvl = p.research[action.research];
    s += researchLevelValue(state, seat, action.research, lvl + 1);
  }
  if (action.flipToken !== undefined) {
    // 高级板/L5 的翻面门票：按被翻标记的重结算价值折价（优先翻低价值标记）。
    s -= flipTokenCost(action.flipToken) - (action.advTechTile !== undefined ? 1 : 0);
  }
  // 联邦 pv 增量（mine→ts +1；ts→lab +1；ts→pi +2；lab→ac +1）
  const pvGain = to === 'ts' ? 1 : to === 'lab' ? 1 : to === 'pi' ? 2 : 1;
  s += pvGain * 0.6;
  if (to === 'pi') s += 5; // 种族 PI 能力解锁估值
  // 回合计分板匹配
  const tile = roundTile(state);
  if (tile !== null) {
    if (tile.trigger.on === 'upgrade-ts' && to === 'ts') s += tile.trigger.vp;
    if (tile.trigger.on === 'upgrade-pi-academy' && (to === 'pi' || to === 'ac1' || to === 'ac2')) {
      s += tile.trigger.vp;
    }
    if (tile.trigger.on === 'build-lab' && to === 'lab') s += tile.trigger.vp;
  }
  return s;
}

function scoreFormFederation(
  state: GameState,
  seat: PlayerIndex,
  action: Extract<Action, { type: 'form-federation' }>,
): number {
  let s = 2; // 联邦基底：L5 研究/高级板的翻面门票
  s += federationTokenValue(state, seat, action.token);
  const tile = roundTile(state);
  if (tile !== null && tile.trigger.on === 'form-federation') s += tile.trigger.vp;
  s += 0.4 * action.hexes.length; // structureFed 终局板进程
  s -= 0.5 * action.satellites.length; // 卫星成本（弃 power token）
  s += 0.3 * action.satellites.length; // satellite 终局板进程
  return s;
}

function scoreResearch(
  state: GameState,
  seat: PlayerIndex,
  action: Extract<Action, { type: 'research' }>,
): number {
  const p = state.players[seat]!;
  const lvl = p.research[action.track];
  let s = researchLevelValue(state, seat, action.track, lvl + 1);
  const tile = roundTile(state);
  if (tile !== null && tile.trigger.on === 'research') s += tile.trigger.vp;
  s -= 4 * RESOURCE_VALUE.knowledge; // 4k
  if (action.flipToken !== undefined) s -= flipTokenCost(action.flipToken); // L5 翻面门票（优先翻低价值标记）
  return s;
}

/** board action（power/qic 格）效果估值。 */
function boardActionEffectValue(state: GameState, seat: PlayerIndex, id: BoardActionId): number {
  const def = BOARD_ACTIONS[id];
  switch (def.effect.kind) {
    case 'gain':
      return gainValue(def.effect.gain);
    case 'build-mine':
      return 7; // 免费步建矿 ≈ 一次建矿评分（省 terraform 费）
    case 'gain-tech-tile':
      return 6;
    case 'rescore-federation': {
      // 重结算最佳联邦标记的即时资源。
      const p = state.players[seat]!;
      let best = 0;
      for (const t of p.federationTokens) {
        const def2 = FEDERATION_TOKENS[t.id];
        best = Math.max(best, def2.other !== undefined ? gainValue(def2.other) : 0);
      }
      return best;
    }
    case 'vp-per-planet-type':
      return def.effect.base + def.effect.perType * countUnits(state, seat, 'planet-type');
  }
}

function scoreBoardAction(
  state: GameState,
  seat: PlayerIndex,
  id: BoardActionId,
  payload: { hex?: HexKey } | undefined,
): number {
  const def = BOARD_ACTIONS[id];
  let s = boardActionEffectValue(state, seat, id);
  s -= costValue(def.cost);
  s -= 0.1 * state.round; // 占格机会成本（每轮全场 1 次，后期格更紧）
  if (def.effect.kind === 'build-mine' && payload?.hex !== undefined) {
    s -= chargePenalty(state, seat, payload.hex);
  }
  return s;
}

/** 特殊行动估值（科技板/助推器/种族来源）。 */
function scoreSpecialAction(
  state: GameState,
  seat: PlayerIndex,
  id: SpecialActionId,
  payload: { hex?: HexKey; track?: ResearchTrack } | undefined,
): number {
  switch (id) {
    case 'tech9':
      return 4 * RESOURCE_VALUE.chargePower;
    case 'advtech3':
      return gainValue({ qic: 1, credits: 5 });
    case 'advtech11':
      return gainValue({ ore: 3 });
    case 'advtech13':
      return gainValue({ knowledge: 3 });
    case 'booster4':
    case 'space-giants-mine': {
      let s = 7; // 建矿（1-2 免费步）
      if (payload?.hex !== undefined) s -= chargePenalty(state, seat, payload.hex);
      return s;
    }
    case 'booster5':
      return 4; // 建矿/盖亚计划射程 +3
    case 'boosterlf4':
      return 4; // 免费立即盖亚计划
    case 'ac2':
      return state.players[seat]?.faction === 'baltaks' ? gainValue({ credits: 4 }) : gainValue({ qic: 1 });
    case 'ivits-sp':
      return 3;
    case 'ambas-swap':
      return 2;
    case 'firaks-down': {
      if (payload?.track !== undefined) {
        const lvl = state.players[seat]!.research[payload.track];
        return researchLevelValue(state, seat, payload.track, lvl + 1) - 1; // lab 降级成本近似
      }
      return 2;
    }
    case 'bescods-up': {
      const p = state.players[seat]!;
      const track = (Object.entries(p.research) as [ResearchTrack, number][]).sort((a, b) => a[1] - b[1])[0]?.[0];
      return track !== undefined ? researchLevelValue(state, seat, track, p.research[track] + 1) : 2;
    }
    case 'gleens-range':
      return 2;
    case 'moweyds-ring':
      return 2;
    case 'tinkeroids-tile': {
      // 按当前 Tinkering tile 效果估值（tink1/4 建矿带对手充能邀约惩罚）。
      const tile = state.players[seat]?.tinkering.current ?? null;
      let s = tile !== null ? tinkeringTileValue(tile) : 1;
      if ((tile === 'tink1' || tile === 'tink4') && payload?.hex !== undefined) {
        s -= chargePenalty(state, seat, payload.hex);
      }
      return s;
    }
  }
}

/** Tinkering tile 效果估值（choose-tinkering 与 tinkeroids-tile 共用）。 */
function tinkeringTileValue(tile: TinkeringTileId): number {
  switch (tile) {
    case 'tink1':
      return 5; // 建矿（1 免费 terraform 步）
    case 'tink4':
      return 8; // 建矿（3 免费 terraform 步）
    case 'tink2':
      return 4 * RESOURCE_VALUE.chargePower; // 充能 4pw
    case 'tink3':
      return RESOURCE_VALUE.qic; // +1q
    case 'tink5':
      return 3 * RESOURCE_VALUE.knowledge; // +3k
    case 'tink6':
      return 2 * RESOURCE_VALUE.qic; // +2q
  }
}

function scoreShipAction(
  state: GameState,
  seat: PlayerIndex,
  action: Extract<Action, { type: 'ship-action' }>,
): number {
  const def = SHIP_ACTIONS[action.action];
  const p = state.players[seat]!;
  let s = 0;
  switch (def.effect.kind) {
    case 'rescore-federation-full': {
      let best = 0;
      for (const t of p.federationTokens) {
        const d = FEDERATION_TOKENS[t.id];
        best = Math.max(best, d.vp * 0 + (d.other !== undefined ? gainValue(d.other) : 0));
      }
      s = best + 1;
      break;
    }
    case 'vp-per-planet-type':
      s = def.effect.base + def.effect.perType * countUnits(state, seat, 'planet-type');
      break;
    case 'gain-tech-tile':
      s = 6;
      break;
    case 'vp-per-standard-tech-tile':
      s = def.effect.base + def.effect.perTile * countUnits(state, seat, 'standard-tech-tile');
      break;
    case 'free-upgrade':
      s = def.effect.to === 'lab' ? 9 : 7; // 免费升级（省费用 + 拿板/收入）
      break;
    case 'research': {
      const best = Math.max(
        ...(Object.keys(p.research) as ResearchTrack[]).map((t) =>
          researchLevelValue(state, seat, t, p.research[t] + 1),
        ),
      );
      s = best;
      break;
    }
    case 'gaia-project-immediate':
      s = 4;
      break;
    case 'range':
      s = 2;
      break;
    case 'gain':
      s = gainValue(def.effect.gain);
      break;
    case 'build-mine':
      s = 7;
      break;
    case 'build-mine-asteroid':
      s = 6;
      break;
  }
  s -= costValue(def.cost);
  s -= 0.1 * state.round; // 占格机会成本
  return s;
}

function scoreExploreShip(state: GameState, seat: PlayerIndex): number {
  const p = state.players[seat]!;
  const vpCost = p.faction === 'baltaks' ? EXPLORE_SHIP_COST_VP_BALTAKS : EXPLORE_SHIP_COST_VP;
  // 解锁：飞船行动格 + 舰载科技板/神器/联邦标记 + exploredShips（高级板第 7 槽
  // 进度）——价值随剩余轮数衰减（解锁后要时间兑现，第 6 轮探索是纯亏）。
  let s = (7 * roundsLeft(state)) / 5 - vpCost;
  if (p.faction === 'nevlas' || p.faction === 'itars' || p.faction === 'taklons') s -= 1; // 族属额外费用
  return s;
}

function scoreInspectArtifact(
  state: GameState,
  seat: PlayerIndex,
  action: Extract<Action, { type: 'inspect-artifact' }>,
): number {
  const p = state.players[seat]!;
  let v = 5; // 默认资源/收入类神器估值
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
      v = 3 + countUnits(state, seat, 'planet-type');
      break;
    case 'art-deep':
      v = 3 * countUnits(state, seat, 'deep-space-sector');
      break;
    case 'art-fed':
      v = 3;
      break;
    case 'art-1k1o':
      v = incomeNpv(state, { knowledge: 1, ore: 1 });
      break;
    case 'art-pwt':
      v = incomeNpv(state, { powerToken: 2 });
      break;
    case 'art-3c3o':
      v = gainValue({ credits: 3, ore: 3 });
      break;
    case 'art-3k1q':
      v = gainValue({ knowledge: 3, qic: 1 });
      break;
    case 'art-5c2o':
      v = gainValue({ credits: 5, ore: 2 });
      break;
  }
  return v - INSPECT_ARTIFACT_COST_POWER * 0.5;
}

function scorePass(
  state: GameState,
  seat: PlayerIndex,
  action: Extract<Action, { type: 'pass' }>,
): number {
  const p = state.players[seat]!;
  let s = 0;
  // 旧助推器 pass VP 结算。
  if (p.booster !== null) {
    const def = BOOSTERS[p.booster];
    if (def.passVp !== undefined) {
      s += countUnits(state, seat, def.passVp.per) * def.passVp.vp;
    }
  }
  // 新助推器只计「新−旧」差值——不 pass 就续用旧的（全额 NPV 会压过一切
  // 主行动，导致每轮直接 Pass 的死亡螺旋，bench 实测）。
  if (action.booster !== null) {
    const newValue = boosterValue(state, seat, action.booster);
    const oldValue = p.booster !== null ? boosterValue(state, seat, p.booster) : 0;
    s += newValue - oldValue;
  } else {
    s -= 3; // 第 6 轮裸 pass：把资源花完再 pass
  }
  // 先手价值。
  if (state.passedPlayers.length === 0 && state.round < 6) s += 1.5;
  // 自愿 pass 的节奏惩罚：还负担得起主行动就 pass = 把 tempo 让给对手，
  // 越早轮次代价越大（剩余可行动轮次多）。
  const canAct =
    (p.resources.ore >= 1 && p.resources.credits >= 2 && p.buildings.mine > 0) ||
    p.resources.knowledge >= 4;
  if (canAct) s -= 0.8 * (7 - Math.max(1, state.round));
  return s;
}

function scoreFreeConversion(
  state: GameState,
  seat: PlayerIndex,
  action: Extract<Action, { type: 'free-conversion' }>,
): number {
  const def = FREE_CONVERSIONS[action.conversion];
  let s = gainValue(def.gain) - costValue(def.cost);
  // gaiaformer 弃置成本（baltaks-gf-q）。
  if (def.cost.gaiaformer !== undefined) s -= def.cost.gaiaformer * 2;
  // v1 简单处理：净差为负但转换后能负担任何主行动时视为中性（解锁关键行动）。
  if (s < 0) {
    const p = state.players[seat]!;
    const r = p.resources;
    const canAffordSomething =
      r.ore >= 1 && r.credits >= 2; // 最便宜主行动（建矿 1o+2c）的最低门槛
    if (canAffordSomething) s = Math.max(s, -0.1);
  }
  return s;
}

function scorePlaceInitialMine(state: GameState, seat: PlayerIndex, hexKey: HexKey): number {
  const p = state.players[seat]!;
  const hex = state.map[hexKey];
  if (hex === undefined) return -100;
  const steps = terraformStepsFor(p, hex.planet);
  let s = 12 - 2.5 * steps; // 母星类型（0 步）优先
  // 对手依附充能：2 格内有对手建筑（未来它们建造送我充能）。
  const near = hexesWithin(state.map, hexKey, 2);
  for (const h of near) {
    const b = state.map[h]?.building;
    if (b !== undefined && b.player !== seat) s += 2;
  }
  // 己方聚拢（联邦潜力），但别太挤（同格簇已有 2 座以上略降）。
  const dist = ownClusterDistance(state, seat, hexKey);
  if (dist !== null && dist <= 3) s += 1;
  if (hex.deepSpace) s += 0.5; // 深空终局板进程
  return s;
}

function scoreGainTechTile(
  state: GameState,
  seat: PlayerIndex,
  action: Extract<Action, { type: 'gain-tech-tile' }>,
): number {
  let s = 0;
  if (action.techTile !== null) s += techTileValue(state, seat, action.techTile);
  if (action.advTechTile !== undefined) s += advTechTileValue(state, seat, action.advTechTile) - 1;
  if (action.research !== undefined && action.research !== null) {
    const lvl = state.players[seat]!.research[action.research];
    s += researchLevelValue(state, seat, action.research, lvl + 1);
  }
  if (action.flipToken !== undefined) s -= flipTokenCost(action.flipToken) - 1;
  return s;
}

// ---------------------------------------------------------------------------
// scoreAction / prescreen / HeuristicAgent
// ---------------------------------------------------------------------------

/** 纯函数快评：分数越高越优；同分由调用方按 stableStringify 字典序裁决。 */
export function scoreAction(state: GameState, seat: PlayerIndex, action: Action): number {
  switch (action.type) {
    case 'build-mine':
      return scoreBuildMine(state, seat, action.hex);
    case 'start-gaia-project':
      return scoreGaiaProject(state, seat);
    case 'upgrade':
      return scoreUpgrade(state, seat, action);
    case 'form-federation':
      return scoreFormFederation(state, seat, action);
    case 'research':
      return scoreResearch(state, seat, action);
    case 'power-action':
    case 'qic-action':
      return scoreBoardAction(state, seat, action.action, action.payload);
    case 'special-action':
      return scoreSpecialAction(state, seat, action.action, action.payload);
    case 'ship-action':
      return scoreShipAction(state, seat, action);
    case 'explore-ship':
      return scoreExploreShip(state, seat);
    case 'inspect-artifact':
      return scoreInspectArtifact(state, seat, action);
    case 'pass':
      return scorePass(state, seat, action);
    case 'free-conversion':
      return scoreFreeConversion(state, seat, action);
    case 'burn':
      return -0.3; // 2 个 II 区 token 换 1 个 III 区 pw：净亏，仅急需时值得
    case 'charge': {
      const pending = state.pending;
      if (pending?.kind === 'charge') {
        const offer = pending.queue[0];
        if (offer !== undefined) {
          return offer.amount * RESOURCE_VALUE.chargePower - offer.vpCost;
        }
      }
      return 0;
    }
    case 'decline-charge':
      return 0;
    case 'place-initial-mine':
      return scorePlaceInitialMine(state, seat, action.hex);
    case 'choose-booster':
      return boosterValue(state, seat, action.booster, { forSetup: true });
    case 'itars-gaia-tech': {
      if (action.techTile === null && action.advTechTile === undefined) return 0.1; // 结束决策
      let s = -4 * 0.5; // 弃 4 gaia power
      if (action.techTile !== null) s += techTileValue(state, seat, action.techTile);
      if (action.advTechTile !== undefined) s += advTechTileValue(state, seat, action.advTechTile) - 1;
      if (action.flipToken !== undefined) s -= flipTokenCost(action.flipToken) - 1;
      return s;
    }
    case 'terrans-gaia-done':
      return 0;
    case 'choose-tinkering':
      return tinkeringTileValue(action.tile);
    case 'gain-tech-tile':
      return scoreGainTechTile(state, seat, action);
    case 'free-mine': {
      if (action.hex === null) return 0;
      // 免费建矿：按 build-mine 评分但成本清零（费用已由来源豁免）。
      const t = estimateMine(state, seat, action.hex);
      if (t === null) return 0;
      return scoreBuildMine(state, seat, action.hex) + t.ore + t.credits + t.qic * RESOURCE_VALUE.qic;
    }
    case 'income-order':
      // tokens-first 通常 III 区更多（新 token 参与充能），微优
      return action.order === 'tokens-first' ? 0.2 : 0;
    case 'confirm-turn':
      return 0;
  }
}

/**
 * 评分兜底：scoreAction 对畸形/边界行动抛异常时记 −1e9（排到最后），
 * 保证 decide/prescreen 对任何输入都不抛、且返回 legal 内的行动。
 */
function safeScore(state: GameState, seat: PlayerIndex, action: Action): number {
  try {
    return scoreAction(state, seat, action);
  } catch {
    return -1e9;
  }
}

/**
 * LLM 候选集预筛：按 scoreAction 降序取 Top K。
 * 并列按 stableStringify 字典序（确定性）；k 超出 legal 长度时返回全部。
 */
export function prescreen(
  state: GameState,
  seat: PlayerIndex,
  legal: Action[],
  k: number,
): Action[] {
  return legal
    .map((action, index) => ({ action, index, score: safeScore(state, seat, action) }))
    .sort((a, b) => b.score - a.score || stableStringify(a.action).localeCompare(stableStringify(b.action)) || a.index - b.index)
    .slice(0, k)
    .map((x) => x.action);
}

/** 评分明细（decide reason 与 bench 分析用）。 */
export function scoredActions(
  state: GameState,
  seat: PlayerIndex,
  legal: Action[],
): { action: Action; score: number }[] {
  return legal
    .map((action, index) => ({ action, index, score: safeScore(state, seat, action) }))
    .sort((a, b) => b.score - a.score || stableStringify(a.action).localeCompare(stableStringify(b.action)) || a.index - b.index);
}

/**
 * 启发式 AI：scoreAction 取 Top-1（确定性 tie-break：stableStringify 字典序）。
 * 与 LLMAgent 同接口（DecidingAgent），degraded 恒 true（非 LLM 路径）。
 */
export class HeuristicAgent implements DecidingAgent {
  async decide(state: GameState, seat: PlayerIndex, legal: Action[]): Promise<Decision> {
    if (legal.length === 0) {
      throw new Error('HeuristicAgent.decide: no legal actions');
    }
    const scored = scoredActions(state, seat, legal);
    const best = scored[0]!;
    const second = scored[1];
    const reason =
      `heuristic Top-1: ${best.action.type} score=${best.score.toFixed(1)}` +
      (second !== undefined ? `（次优 ${second.action.type} ${second.score.toFixed(1)}）` : '');
    return {
      action: best.action,
      reason,
      degraded: true,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
