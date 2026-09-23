/**
 * 研究板 power/qic 行动 + 特殊行动（科技板/助推器/学院/种族 PI 格）。
 *
 * - board action（power1-7/qic1-3，data/prices.ts BOARD_ACTIONS）：每格每轮
 *   全场 1 次（board.boardActionsUsed，turn.ts 整理阶段清空）。
 * - power2/power6/booster4 带免费 terraform 步的建矿、booster5 临时射程 +3
 *   建矿/盖亚：复用 mine.ts / gaia.ts 的 MineOptions/GaiaProjectOptions。
 * - qic1 拿科技板（actions/tech.ts 共享流程）；qic2 重结算自己一枚联邦标记
 *   的 VP/资源（不翻回）；qic3 计分（3vp + 每殖民星球类型 1vp）。
 * - 特殊行动（specialUsed，每格每轮 1 次）：tech9 充能 4pw、advtech3/11/13、
 *   booster4、booster5、ac2（+1q，baltaks +4c）、ivits-sp、firaks-down；
 *   ambas-swap/bescods-up/moweyds-ring/tinkeroids-tile 为每轮一次能力
 *   （roundAbilityUsed）。
 * - LF：研究板 3 个 qic 格被覆盖板盖住整局不可用（改由飞船行动格提供，
 *   见 actions/ships.ts）；gleens-range/moweyds-ring/tinkeroids-tile/
 *   space-giants-mine/boosterlf4 已实现。
 */
import { IllegalActionError } from '../errors.js';
import type {
  Action,
  ActionPayload,
  BoardActionId,
  ChargeOffer,
  GameState,
  PlayerIndex,
  ResearchTrack,
  SpecialActionId,
} from '../types.js';
import type { HexKey } from '../hex.js';
import { minDistanceToAny } from '../map.js';
import { BOARD_ACTIONS } from '../data/prices.js';
import { TECH_TILES, ADV_TECH_TILES } from '../data/techs.js';
import { FEDERATION_TOKENS } from '../data/federations.js';
import { addVp, applyGain, gainResources, player, spendPower, spendResources, spendablePower } from '../state.js';
import { countUnits } from '../score.js';
import { onUpgrade } from '../triggers.js';
import { applyBuildMine, computeMineTarget, rangeOf, rangeSources } from './mine.js';
import { applyGaiaProject, enumerateGaiaProject } from './gaia.js';
import { applyTechTileChoice, enumerateTechTileChoices, settlePendingAfter, type TechTileChoice } from './tech.js';
import { advanceResearchLevel, legalResearchAdvances, type ResearchAdvanceChoice } from './research.js';
import { makeChargeOffers } from './charge.js';
import {
  applyExploreShip,
  applyImmediateGaiaProject,
  computeImmediateGaiaTarget,
  exploreInRange,
} from './ships.js';

const TRACKS: readonly ResearchTrack[] = ['terra', 'nav', 'int', 'gaia', 'eco', 'sci'];

// ---------------------------------------------------------------------------
// 可用性判定
// ---------------------------------------------------------------------------

/** 玩家是否持有某特殊行动格（科技板/高级板/助推器/学院/种族 PI）。 */
export function hasSpecialAction(state: GameState, idx: PlayerIndex, id: SpecialActionId): boolean {
  const p = state.players[idx]!;
  switch (id) {
    case 'tech9': {
      const covered = new Set(p.advTechTiles.map((a) => a.covers));
      return p.techTiles.includes('tech9') && !covered.has('tech9');
    }
    case 'advtech3':
    case 'advtech11':
    case 'advtech13':
      return p.advTechTiles.some((a) => a.id === id);
    case 'booster4':
    case 'booster5':
      return p.booster === id;
    case 'ac2':
      return p.buildings.ac2 === 0;
    case 'ivits-sp':
      return p.faction === 'ivits' && p.buildings.pi === 0 && p.spaceStations < 6;
    case 'ambas-swap':
      return p.faction === 'ambas' && p.buildings.pi === 0;
    case 'firaks-down':
      return p.faction === 'firaks' && p.buildings.pi === 0;
    case 'bescods-up':
      return p.faction === 'bescods';
    case 'gleens-range':
      return state.config.lostFleet && p.faction === 'gleens';
    case 'moweyds-ring':
      return state.config.lostFleet && p.faction === 'moweyds' && p.buildings.pi === 0 && p.powerRings > 0;
    case 'tinkeroids-tile':
      return (
        state.config.lostFleet &&
        p.faction === 'tinkeroids' &&
        p.buildings.pi === 0 &&
        p.tinkering.current !== null
      );
    case 'space-giants-mine':
      return state.config.lostFleet && p.faction === 'space-giants';
    case 'boosterlf4':
      return p.booster === 'boosterlf4';
    default:
      return false;
  }
}

/** 每轮一次能力（roundAbilityUsed）还是特殊行动格（specialUsed）。 */
function usesRoundAbility(id: SpecialActionId): boolean {
  return id === 'ambas-swap' || id === 'bescods-up' || id === 'moweyds-ring' || id === 'tinkeroids-tile';
}

/** 特殊行动是否可用（持有 + 本轮未用）。 */
function specialAvailable(state: GameState, idx: PlayerIndex, id: SpecialActionId): boolean {
  const p = state.players[idx]!;
  if (!hasSpecialAction(state, idx, id)) {
    return false;
  }
  return usesRoundAbility(id) ? !p.roundAbilityUsed.includes(id) : !p.specialUsed.includes(id);
}

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/** 带免费 terraform 步建矿的候选格（power2/power6/booster4 共用）。 */
function mineTargetsWithFreeSteps(state: GameState, idx: PlayerIndex, freeSteps: number): HexKey[] {
  const p = state.players[idx]!;
  const out: HexKey[] = [];
  for (const key of Object.keys(state.map) as HexKey[]) {
    const t = computeMineTarget(state, idx, key, { freeTerraformSteps: freeSteps });
    if (t !== null && p.resources.ore >= t.ore && p.resources.credits >= t.credits && p.resources.qic >= t.qic) {
      out.push(key);
    }
  }
  return out;
}

/** 研究板 power/qic 行动枚举。 */
export function enumerateBoardActions(state: GameState, idx: PlayerIndex): Action[] {
  const p = state.players[idx]!;
  const out: Action[] = [];
  for (const def of Object.values(BOARD_ACTIONS)) {
    // LF：研究板 3 个 QIC 行动格被覆盖板盖住整局不可用（改由飞船行动格提供）。
    if (state.config.lostFleet && def.cost.qic !== undefined) {
      continue;
    }
    if (state.board.boardActionsUsed.includes(def.id)) {
      continue;
    }
    if (def.cost.power !== undefined && spendablePower(p) < def.cost.power) {
      continue;
    }
    if (def.cost.qic !== undefined && p.resources.qic < def.cost.qic) {
      continue;
    }
    const kind = def.cost.power !== undefined ? 'power-action' : 'qic-action';
    switch (def.effect.kind) {
      case 'gain':
      case 'vp-per-planet-type':
        out.push({ type: kind, action: def.id });
        break;
      case 'build-mine':
        for (const hex of mineTargetsWithFreeSteps(state, idx, def.effect.freeTerraformSteps)) {
          out.push({ type: 'power-action', action: def.id, payload: { hex } });
        }
        break;
      case 'gain-tech-tile':
        for (const choice of enumerateTechTileChoices(state, idx)) {
          out.push({ type: 'qic-action', action: 'qic1', payload: payloadFromTechChoice(choice) });
        }
        break;
      case 'rescore-federation': {
        const ids = [...new Set(p.federationTokens.map((t) => t.id))];
        for (const federationToken of ids) {
          out.push({ type: 'qic-action', action: 'qic2', payload: { federationToken } });
        }
        break;
      }
    }
  }
  return out;
}

/** 把拿板选择折进 ActionPayload。 */
function payloadFromTechChoice(choice: TechTileChoice): ActionPayload {
  const payload: ActionPayload = {};
  if (choice.techTile !== undefined) {
    payload.techTile = choice.techTile;
  }
  if (choice.advTechTile !== undefined) {
    payload.advTechTile = choice.advTechTile;
  }
  if (choice.coverTechTile !== undefined) {
    payload.coverTechTile = choice.coverTechTile;
  }
  if (choice.flipToken !== undefined) {
    payload.flipToken = choice.flipToken;
  }
  const research = choice.research;
  if (research !== null) {
    payload.track = research.track;
    if (research.flipToken !== undefined) {
      // 高级板路径：L5 翻面是第二枚（researchFlipToken）；标准板路径复用 flipToken。
      if (choice.advTechTile !== undefined) {
        payload.researchFlipToken = research.flipToken;
      } else {
        payload.flipToken = research.flipToken;
      }
    }
    if (research.lostPlanetHex !== undefined) {
      payload.lostPlanetHex = research.lostPlanetHex;
    }
  }
  return payload;
}

/** Ivits 空间站候选格：可达（可 qic 补程）的空格（非星球、无建筑/卫星/飞船）。 */
function spaceStationTargets(state: GameState, idx: PlayerIndex): { hex: HexKey; qic: number }[] {
  const p = state.players[idx]!;
  const sources = rangeSources(state, idx);
  const range = rangeOf(p);
  const out: { hex: HexKey; qic: number }[] = [];
  for (const [key, hex] of Object.entries(state.map)) {
    if (hex.planet !== 'empty' || hex.building !== undefined || hex.satelliteOf !== undefined || hex.ship !== undefined) {
      continue;
    }
    const need = minDistanceToAny(state.map, sources, key as HexKey) - range;
    const qic = need > 0 ? Math.ceil(need / 2) : 0;
    if (p.resources.qic >= qic) {
      out.push({ hex: key as HexKey, qic });
    }
  }
  return out;
}

/** 特殊行动枚举。 */
export function enumerateSpecialActions(state: GameState, idx: PlayerIndex): Action[] {
  const p = state.players[idx]!;
  const out: Action[] = [];
  const push = (action: SpecialActionId, payload?: ActionPayload): void => {
    out.push(payload !== undefined ? { type: 'special-action', action, payload } : { type: 'special-action', action });
  };
  for (const id of ['tech9', 'advtech3', 'advtech11', 'advtech13', 'ac2'] as const) {
    if (specialAvailable(state, idx, id)) {
      push(id);
    }
  }
  if (specialAvailable(state, idx, 'booster4')) {
    for (const hex of mineTargetsWithFreeSteps(state, idx, 1)) {
      push('booster4', { hex });
    }
  }
  if (specialAvailable(state, idx, 'booster5')) {
    // 射程 +3：建矿/盖亚计划/探索飞船（LF 与 gleens-range/ship-range3 同型）。
    for (const a of rangeBoostTargets(state, idx, 3)) {
      push('booster5', a);
    }
  }
  if (specialAvailable(state, idx, 'ivits-sp')) {
    for (const t of spaceStationTargets(state, idx)) {
      push('ivits-sp', { hex: t.hex });
    }
  }
  if (specialAvailable(state, idx, 'ambas-swap')) {
    for (const [key, hex] of Object.entries(state.map)) {
      if (hex.building?.type === 'mine' && hex.building.player === idx) {
        push('ambas-swap', { hex: key as HexKey });
      }
    }
  }
  if (specialAvailable(state, idx, 'firaks-down')) {
    for (const [key, hex] of Object.entries(state.map)) {
      if (hex.building?.type !== 'lab' || hex.building.player !== idx) {
        continue;
      }
      for (const adv of legalResearchAdvances(state, idx, TRACKS)) {
        push('firaks-down', payloadFromResearchChoice(key as HexKey, adv));
      }
      // 放弃升轨变体（参考 decline up；降级仍生效）
      push('firaks-down', { hex: key as HexKey });
    }
  }
  if (specialAvailable(state, idx, 'bescods-up')) {
    const minLevel = Math.min(...TRACKS.map((t) => p.research[t]));
    const lowest = TRACKS.filter((t) => p.research[t] === minLevel);
    for (const adv of legalResearchAdvances(state, idx, lowest)) {
      push('bescods-up', payloadFromResearchChoice(undefined, adv));
    }
    // 放弃升轨（参考允许 decline up，行动仍消耗）
    push('bescods-up', {});
  }
  // --- LF ---
  // gleens-range / booster5 同型：建矿/盖亚计划/探索飞船 射程 +2。
  if (specialAvailable(state, idx, 'gleens-range')) {
    for (const a of rangeBoostTargets(state, idx, 2)) {
      push('gleens-range', a);
    }
  }
  // moweyds-ring：放 Power Ring 到有己建筑且无环的星球。
  if (specialAvailable(state, idx, 'moweyds-ring')) {
    for (const [key, hex] of Object.entries(state.map)) {
      if (
        hex.building !== undefined &&
        hex.building.player === idx &&
        hex.building.type !== 'gf' &&
        hex.building.type !== 'sp' &&
        hex.powerRing !== true &&
        hex.planet !== 'empty'
      ) {
        push('moweyds-ring', { hex: key as HexKey });
      }
    }
  }
  // tinkeroids-tile：把当前 Tinkering tile 的行动当主行动用。
  if (specialAvailable(state, idx, 'tinkeroids-tile')) {
    for (const a of tinkeringTileTargets(state, idx)) {
      push('tinkeroids-tile', a);
    }
  }
  // space-giants-mine：建矿（2 免费步，可补 ore 第 3 步）。
  if (specialAvailable(state, idx, 'space-giants-mine')) {
    for (const hex of mineTargetsWithFreeSteps(state, idx, 2)) {
      push('space-giants-mine', { hex });
    }
  }
  // boosterlf4：免费立即盖亚计划。
  if (specialAvailable(state, idx, 'boosterlf4')) {
    for (const key of Object.keys(state.map) as HexKey[]) {
      if (computeImmediateGaiaTarget(state, idx, key) !== null) {
        push('boosterlf4', { hex: key });
      }
    }
  }
  return out;
}

/** 射程加成行动的候选（建矿/盖亚计划/探索飞船；gleens-range/ship-range3 共用）。 */
function rangeBoostTargets(state: GameState, idx: PlayerIndex, tempRange: number): ActionPayload[] {
  const p = state.players[idx]!;
  const out: ActionPayload[] = [];
  for (const key of Object.keys(state.map) as HexKey[]) {
    const t = computeMineTarget(state, idx, key, { tempRange });
    if (t !== null && p.resources.ore >= t.ore && p.resources.credits >= t.credits && p.resources.qic >= t.qic) {
      out.push({ hex: key });
    }
  }
  for (const a of enumerateGaiaProject(state, idx, { tempRange })) {
    out.push({ hex: (a as Extract<Action, { type: 'start-gaia-project' }>).hex });
  }
  for (const ship of state.board.ships) {
    if (exploreInRange(state, idx, ship.id, tempRange)) {
      out.push({ ship: ship.id });
    }
  }
  return out;
}

/** Tinkering tile 行动的候选（按当前 tile 效果）。 */
function tinkeringTileTargets(state: GameState, idx: PlayerIndex): ActionPayload[] {
  const p = state.players[idx]!;
  const tile = p.tinkering.current;
  if (tile === null) {
    return [];
  }
  switch (tile) {
    case 'tink1': // 建矿（1 免费步）
      return mineTargetsWithFreeSteps(state, idx, 1).map((hex) => ({ hex }));
    case 'tink2': // 充能 4 power
    case 'tink3': // +1q
    case 'tink5': // +3k
    case 'tink6': // +2q
      return [{}];
    case 'tink4': // 建矿（3 免费步）
      return mineTargetsWithFreeSteps(state, idx, 3).map((hex) => ({ hex }));
  }
}

/** 把研究推进选择折进 ActionPayload（firaks-down 带 lab 格 hex）。 */
function payloadFromResearchChoice(hex: HexKey | undefined, adv: ResearchAdvanceChoice): ActionPayload {
  const payload: ActionPayload = { track: adv.track };
  if (hex !== undefined) {
    payload.hex = hex;
  }
  if (adv.flipToken !== undefined) {
    payload.flipToken = adv.flipToken;
  }
  if (adv.lostPlanetHex !== undefined) {
    payload.lostPlanetHex = adv.lostPlanetHex;
  }
  return payload;
}

// ---------------------------------------------------------------------------
// 应用
// ---------------------------------------------------------------------------

/** 应用研究板 power/qic 行动（原地修改）。 */
export function applyBoardAction(
  state: GameState,
  idx: PlayerIndex,
  actionId: BoardActionId,
  payload?: ActionPayload,
): void {
  const p = player(state, idx);
  const def = BOARD_ACTIONS[actionId];
  if (state.config.lostFleet && def.cost.qic !== undefined) {
    throw new IllegalActionError('qic-covered', `LF 中研究板 QIC 行动格被覆盖: ${actionId}`);
  }
  if (state.board.boardActionsUsed.includes(actionId)) {
    throw new IllegalActionError('board-action-used', `该行动格本轮已用: ${actionId}`);
  }
  if (def.cost.power !== undefined) {
    spendPower(p, def.cost.power);
  }
  if (def.cost.qic !== undefined) {
    spendResources(p, { qic: def.cost.qic });
  }
  state.board.boardActionsUsed.push(actionId);

  let offers: ChargeOffer[] = [];
  switch (def.effect.kind) {
    case 'gain':
      applyGain(state, idx, def.effect.gain);
      break;
    case 'vp-per-planet-type':
      addVp(p, def.effect.base + countUnits(state, idx, 'planet-type') * def.effect.perType);
      break;
    case 'build-mine': {
      if (payload?.hex === undefined) {
        throw new IllegalActionError('missing-payload', `${actionId} 需要 payload.hex`);
      }
      applyBuildMine(state, idx, payload.hex, { freeTerraformSteps: def.effect.freeTerraformSteps });
      // applyBuildMine 已设置 pending（含充能邀约）。
      return;
    }
    case 'gain-tech-tile': {
      const result = applyTechTileChoice(state, idx, techChoiceFromPayload(payload));
      settlePendingAfter(state, idx, result.offers, { freeMine: result.freeMine });
      return;
    }
    case 'rescore-federation': {
      const tokenId = payload?.federationToken;
      const tok = p.federationTokens.find((t) => t.id === tokenId);
      if (tokenId === undefined || tok === undefined) {
        throw new IllegalActionError('no-such-token', `未持有联邦标记: ${String(tokenId)}`);
      }
      const tokDef = FEDERATION_TOKENS[tok.id];
      addVp(p, tokDef.vp);
      if (tokDef.other !== undefined) {
        applyGain(state, idx, tokDef.other);
      }
      break;
    }
  }
  state.pending = offers.length > 0 ? { kind: 'charge', queue: offers } : null;
}

/** 把 ActionPayload 折回 TechTileChoice。 */
function techChoiceFromPayload(payload?: ActionPayload): TechTileChoice {
  if (payload === undefined || (payload.techTile === undefined && payload.advTechTile === undefined)) {
    throw new IllegalActionError('missing-payload', '拿科技板需要 payload.techTile/advTechTile');
  }
  const choice: TechTileChoice = { research: null };
  if (payload.techTile !== undefined) {
    choice.techTile = payload.techTile;
  }
  if (payload.advTechTile !== undefined) {
    choice.advTechTile = payload.advTechTile;
  }
  if (payload.coverTechTile !== undefined) {
    choice.coverTechTile = payload.coverTechTile;
  }
  if (payload.flipToken !== undefined) {
    choice.flipToken = payload.flipToken;
  }
  if (payload.track !== undefined) {
    const research: ResearchAdvanceChoice = { track: payload.track };
    // 高级板路径 L5 翻面取 researchFlipToken（flipToken 是拿板翻面）；标准板升 L5 复用 flipToken。
    const rf = choice.advTechTile !== undefined ? payload.researchFlipToken : payload.flipToken;
    if (rf !== undefined) {
      research.flipToken = rf;
    }
    if (payload.lostPlanetHex !== undefined) {
      research.lostPlanetHex = payload.lostPlanetHex;
    }
    choice.research = research;
  }
  return choice;
}

/** 应用特殊行动（原地修改）。 */
export function applySpecialAction(
  state: GameState,
  idx: PlayerIndex,
  actionId: SpecialActionId,
  payload?: ActionPayload,
): void {
  const p = player(state, idx);
  if (!specialAvailable(state, idx, actionId)) {
    throw new IllegalActionError('special-unavailable', `特殊行动不可用: ${actionId}`);
  }
  if (usesRoundAbility(actionId)) {
    p.roundAbilityUsed.push(actionId);
  } else {
    p.specialUsed.push(actionId);
  }

  switch (actionId) {
    case 'tech9':
    case 'advtech3':
    case 'advtech11':
    case 'advtech13': {
      const eff =
        actionId === 'tech9' ? TECH_TILES['tech9'].effect : ADV_TECH_TILES[actionId].effect;
      if (eff.gain !== undefined) {
        applyGain(state, idx, eff.gain);
      }
      state.pending = null;
      return;
    }
    case 'ac2':
      // QIC 学院：+1q（baltaks +4c）。
      gainResources(p, p.faction === 'baltaks' ? { credits: 4 } : { qic: 1 });
      state.pending = null;
      return;
    case 'booster4':
      if (payload?.hex === undefined) {
        throw new IllegalActionError('missing-payload', 'booster4 需要 payload.hex');
      }
      applyBuildMine(state, idx, payload.hex, { freeTerraformSteps: 1 });
      return;
    case 'booster5': {
      // LF：射程 +3 也可用于探索飞船（参照参考引擎 qicForExplorationDistance 用 temporaryRange）。
      if (payload?.ship !== undefined) {
        applyExploreShip(state, idx, payload.ship, { tempRange: 3 });
        return;
      }
      if (payload?.hex === undefined) {
        throw new IllegalActionError('missing-payload', 'booster5 需要 payload.hex/ship');
      }
      if (state.map[payload.hex]!.planet === 'transdim') {
        applyGaiaProject(state, idx, payload.hex, { tempRange: 3, powerFrom: payload.powerFrom });
        state.pending = null;
      } else {
        applyBuildMine(state, idx, payload.hex, { tempRange: 3 });
      }
      return;
    }
    case 'ivits-sp': {
      if (payload?.hex === undefined) {
        throw new IllegalActionError('missing-payload', 'ivits-sp 需要 payload.hex');
      }
      const t = spaceStationTargets(state, idx).find((x) => x.hex === payload.hex);
      if (t === undefined) {
        throw new IllegalActionError('illegal-space-station', `非法空间站格: ${payload.hex}`);
      }
      spendResources(p, { qic: t.qic });
      state.map[payload.hex]!.building = { type: 'sp', player: idx };
      p.spaceStations += 1;
      state.pending = null;
      return;
    }
    case 'ambas-swap': {
      // 交换 PI 与一个 mine 的位置（无 vp/充能/触发）。
      const piHex = (Object.keys(state.map) as HexKey[]).find(
        (k) => state.map[k]!.building?.type === 'pi' && state.map[k]!.building.player === idx,
      );
      const mineHex = payload?.hex;
      if (piHex === undefined || mineHex === undefined || state.map[mineHex]?.building?.type !== 'mine' || state.map[mineHex]!.building!.player !== idx) {
        throw new IllegalActionError('illegal-swap', `非法交换目标: ${String(mineHex)}`);
      }
      state.map[piHex]!.building = { type: 'mine', player: idx };
      state.map[mineHex]!.building = { type: 'pi', player: idx };
      state.pending = null;
      return;
    }
    case 'firaks-down': {
      // lab 降级回 ts 并推进任意轨 1 级（算"升级到贸易站"行动）。
      const hexKey = payload?.hex;
      if (hexKey === undefined || state.map[hexKey]?.building?.type !== 'lab' || state.map[hexKey]!.building!.player !== idx) {
        throw new IllegalActionError('illegal-downgrade', `非法降级目标: ${String(hexKey)}`);
      }
      state.map[hexKey]!.building = { type: 'ts', player: idx };
      p.buildings.lab += 1;
      p.buildings.ts -= 1;
      // 降级的 ts 同样产生对手被动充能邀约（算升级行动）。
      const buildingOffers = makeChargeOffers(state, idx, hexKey);
      // payload.track 缺省 = 放弃升轨（参考 decline up；降级仍生效）
      if (payload?.track === undefined) {
        onUpgrade(state, idx, 'ts');
        state.pending = buildingOffers.length > 0 ? { kind: 'charge', queue: buildingOffers } : null;
        return;
      }
      const track = payload.track;
      const choice: ResearchAdvanceChoice = { track };
      if (payload.flipToken !== undefined) {
        choice.flipToken = payload.flipToken;
      }
      if (payload.lostPlanetHex !== undefined) {
        choice.lostPlanetHex = payload.lostPlanetHex;
      }
      const offers = [...advanceResearchLevel(state, idx, choice), ...buildingOffers];
      onUpgrade(state, idx, 'ts');
      state.pending = offers.length > 0 ? { kind: 'charge', queue: offers } : null;
      return;
    }
    case 'bescods-up': {
      // payload.track 缺省 = 放弃升轨（参考 decline up；行动仍消耗）。
      if (payload?.track === undefined) {
        state.pending = null;
        return;
      }
      const choice: ResearchAdvanceChoice = { track: payload.track };
      if (payload.flipToken !== undefined) {
        choice.flipToken = payload.flipToken;
      }
      if (payload.lostPlanetHex !== undefined) {
        choice.lostPlanetHex = payload.lostPlanetHex;
      }
      const offers = advanceResearchLevel(state, idx, choice);
      state.pending = offers.length > 0 ? { kind: 'charge', queue: offers } : null;
      return;
    }
    case 'gleens-range': {
      // LF Gleens 探索板：建矿/盖亚计划/探索飞船 基本射程 +2。
      if (payload?.ship !== undefined) {
        applyExploreShip(state, idx, payload.ship, { tempRange: 2 });
        return;
      }
      if (payload?.hex === undefined) {
        throw new IllegalActionError('missing-payload', 'gleens-range 需要 payload.hex/ship');
      }
      if (state.map[payload.hex]!.planet === 'transdim') {
        applyGaiaProject(state, idx, payload.hex, { tempRange: 2 });
        state.pending = null;
      } else {
        applyBuildMine(state, idx, payload.hex, { tempRange: 2 });
      }
      return;
    }
    case 'moweyds-ring': {
      // Moweyds PI：放 Power Ring，该建筑 pv +2。
      const hexKey = payload?.hex;
      const hex = hexKey === undefined ? undefined : state.map[hexKey];
      if (
        hexKey === undefined ||
        hex === undefined ||
        hex.building === undefined ||
        hex.building.player !== idx ||
        hex.building.type === 'gf' ||
        hex.building.type === 'sp' ||
        hex.powerRing === true ||
        hex.planet === 'empty'
      ) {
        throw new IllegalActionError('illegal-power-ring', `非法 Power Ring 目标: ${String(hexKey)}`);
      }
      hex.powerRing = true;
      p.powerRings -= 1;
      state.pending = null;
      return;
    }
    case 'tinkeroids-tile': {
      // Tinkeroids PI：把当前 Tinkering tile 的行动当主行动用。
      const tile = p.tinkering.current;
      if (tile === null) {
        throw new IllegalActionError('no-tinkering-tile', '本轮未选择 Tinkering tile');
      }
      switch (tile) {
        case 'tink1':
        case 'tink4': {
          if (payload?.hex === undefined) {
            throw new IllegalActionError('missing-payload', `${tile} 需要 payload.hex`);
          }
          applyBuildMine(state, idx, payload.hex, { freeTerraformSteps: tile === 'tink1' ? 1 : 3 });
          return;
        }
        case 'tink2':
          applyGain(state, idx, { chargePower: 4 });
          state.pending = null;
          return;
        case 'tink3':
          gainResources(p, { qic: 1 });
          state.pending = null;
          return;
        case 'tink5':
          gainResources(p, { knowledge: 3 });
          state.pending = null;
          return;
        case 'tink6':
          gainResources(p, { qic: 2 });
          state.pending = null;
          return;
      }
      return;
    }
    case 'space-giants-mine': {
      if (payload?.hex === undefined) {
        throw new IllegalActionError('missing-payload', 'space-giants-mine 需要 payload.hex');
      }
      applyBuildMine(state, idx, payload.hex, { freeTerraformSteps: 2 });
      return;
    }
    case 'boosterlf4': {
      if (payload?.hex === undefined) {
        throw new IllegalActionError('missing-payload', 'boosterlf4 需要 payload.hex');
      }
      applyImmediateGaiaProject(state, idx, payload.hex);
      return;
    }
    default:
      throw new IllegalActionError('not-implemented', `特殊行动暂未实现: ${actionId}`);
  }
}
