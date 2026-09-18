/**
 * setup 放置行动：place-initial-mine（含 Xenos 第 3 矿、Ivits PI、LF 新族起始建筑）
 * 与 choose-booster。
 *
 * 队列中可能出现无合法放置的玩家（ivits 与 LF 新族在 mines-1/2 阶段、普通族在
 * extra 阶段）——枚举返回空，由 apply 层的 settleSetupSkips 自动跳过。
 *
 * 起始放置不触发对手被动充能邀约（参考引擎 placeBuilding 仅在
 * phase === RoundMove 时登记 leechSources；BGS 线上行为即 setup 无 leech）。
 */
import { IllegalActionError } from '../errors.js';
import type { Action, BuildingType, GameState, PlanetType, PlayerIndex } from '../types.js';
import { advanceSetupInPlace } from '../setup.js';
import { FACTIONS } from '../data/factions.js';
import { player } from '../state.js';

/** LF 4 新族（extra 阶段放置起始建筑）。 */
const LF_NEW_FACTIONS: readonly string[] = ['tinkeroids', 'darkanians', 'moweyds', 'space-giants'];

/** 当前 setup 阶段该玩家应放置的建筑与目标星球类型；null = 该阶段无放置。 */
function placementSpec(
  state: GameState,
  idx: PlayerIndex,
): { building: BuildingType; planet: PlanetType } | null {
  const p = state.players[idx]!;
  const def = FACTIONS[p.faction];
  switch (state.setupStage) {
    case 'mines-1':
    case 'mines-2':
      // ivits（startingMines 0）与 LF 新族（无母星）在前两轮无放置。
      if (def.startingMines === 0 || def.homePlanet === null) {
        return null;
      }
      return { building: 'mine', planet: def.homePlanet };
    case 'extra':
      if (p.faction === 'xenos') {
        return { building: 'mine', planet: 'desert' };
      }
      if (p.faction === 'ivits') {
        return { building: 'pi', planet: 'oxide' };
      }
      if (LF_NEW_FACTIONS.includes(p.faction)) {
        // tinkeroids 起始放 PI，其余 LF 新族放 1 矿；目标为各自起始星球类型。
        return {
          building: p.faction === 'tinkeroids' ? 'pi' : 'mine',
          planet: def.startingPlanetType ?? 'asteroid',
        };
      }
      return null;
    default:
      return null;
  }
}

/** 枚举 place-initial-mine（setupQueue[0] === idx 时由 enumerate.ts 调用）。 */
export function enumeratePlaceInitialMine(state: GameState, idx: PlayerIndex): Action[] {
  const spec = placementSpec(state, idx);
  if (spec === null) {
    return [];
  }
  const out: Action[] = [];
  for (const [key, hex] of Object.entries(state.map)) {
    if (hex.planet === spec.planet && hex.building === undefined && hex.ship === undefined) {
      out.push({ type: 'place-initial-mine', hex: key as `${number},${number}` });
    }
  }
  return out;
}

/** 应用 place-initial-mine（原地修改）：放建筑、记殖民、推进 setup 队列。 */
export function applyPlaceInitialMine(state: GameState, hexKey: `${number},${number}`): void {
  const idx = state.setupQueue[0];
  if (idx === undefined) {
    throw new IllegalActionError('not-in-setup', 'setup 队列为空');
  }
  const spec = placementSpec(state, idx);
  const hex = state.map[hexKey];
  if (spec === null || hex === undefined || hex.planet !== spec.planet || hex.building !== undefined) {
    throw new IllegalActionError('illegal-placement', `非法起始放置: ${hexKey}`);
  }
  const p = player(state, idx);
  hex.building = { type: spec.building, player: idx };
  if (spec.building === 'mine' || spec.building === 'pi') {
    p.buildings[spec.building] -= 1;
  }
  // 殖民记录（起始放置不触发回合计分——round 0 无计分板；Interspace 不算扇区）。
  if (!p.colonizedPlanetTypes.includes(hex.planet)) {
    p.colonizedPlanetTypes.push(hex.planet);
  }
  if (hex.sector !== 'interspace' && !p.colonizedSectors.includes(hex.sector)) {
    p.colonizedSectors.push(hex.sector);
  }
  advanceSetupInPlace(state);
  // setup 放置无充能邀约（见文件头注释）。
  state.pending = null;
}

/** 枚举 choose-booster（boosters 阶段）。 */
export function enumerateChooseBooster(state: GameState, _idx: PlayerIndex): Action[] {
  return state.board.boosters.map((b) => ({ type: 'choose-booster', booster: b }));
}

/** 应用 choose-booster（原地修改）：从供应拿走助推器并推进队列。 */
export function applyChooseBooster(state: GameState, booster: (typeof state.board.boosters)[number]): void {
  const idx = state.setupQueue[0];
  if (idx === undefined) {
    throw new IllegalActionError('not-in-setup', 'setup 队列为空');
  }
  const i = state.board.boosters.indexOf(booster);
  if (i < 0) {
    throw new IllegalActionError('booster-unavailable', `助推器不可选: ${booster}`);
  }
  state.board.boosters.splice(i, 1);
  player(state, idx).booster = booster;
  advanceSetupInPlace(state);
}
