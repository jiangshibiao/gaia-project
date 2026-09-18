/**
 * Lost Fleet 飞船系统：explore-ship（行动 11）、ship-action（12 格）、
 * inspect-artifact（行动 12）。
 *
 * 规则（lost-fleet-rules "New Actions" + Appendix II + rules-summary §2.5）：
 * - 探索：船在射程内（射程永远从最近已殖民星球量，飞船格不作起点；可 qic
 *   补程 1q=+2 格，特殊行动可加程）；玩家须有可用穿梭机（2 人 2 个/3–4 人
 *   3 个）且在该船无穿梭机；付 5vp（baltaks 7vp；taklons 额外 brainstone→
 *   gaia 区；nevlas/itars 额外弃 1pw）；放最小编号空位；非首个探索者立即
 *   按探索轨充能（0/2/2/3，见 data/lostfleet.ts）。
 * - 有穿梭机即解锁该船行动格：每格每轮全场 1 次（board.shipActionsUsed，
 *   键 `${shipId}:${actionId}`）；各船固定 3 格见 data/lostfleet.ts。
 * - 检查神器（限 twilight 且有己方穿梭机）：任意区弃 6 power → 拿 1 artifact。
 */
import { IllegalActionError } from '../errors.js';
import type {
  Action,
  ActionPayload,
  ArtifactState,
  ChargeOffer,
  FederationTokenId,
  GameState,
  PlayerIndex,
  ShipActionId,
  ShipId,
  ShipState,
} from '../types.js';
import type { HexKey } from '../hex.js';
import { minDistanceToAny } from '../map.js';
import { SHIP_ACTIONS, EXPLORE_SHIP_COST_VP, EXPLORE_SHIP_COST_VP_BALTAKS } from '../data/prices.js';
import { SHIP_ACTION_SPACES, shuttleSlotCharge, shuttlesPerPlayer } from '../data/lostfleet.js';
import {
  addVp,
  applyGain,
  chargePower,
  discardPowerTokens,
  gainResources,
  player,
  spendPower,
  spendResources,
  spendablePower,
} from '../state.js';
import { countUnits } from '../score.js';
import { onNewPlanetType, onQicAction, onUpgrade } from '../triggers.js';
import { applyBuildMine, computeMineTarget, rangeOf, rangeSources } from './mine.js';
import { applyGaiaProject, enumerateGaiaProject } from './gaia.js';
import { makeChargeOffers } from './charge.js';
import { applyTechTileChoice, enumerateTechTileChoices, settlePendingAfter, type TechTileChoice } from './tech.js';
import { advanceResearchLevel, legalResearchAdvances, type ResearchAdvanceChoice } from './research.js';
import { applyFederationTokenReward, addBuildingToNearbyFederation } from './federation.js';

const TRACKS = ['terra', 'nav', 'int', 'gaia', 'eco', 'sci'] as const;

function shipOf(state: GameState, shipId: ShipId): ShipState {
  const ship = state.board.ships.find((s) => s.id === shipId);
  if (ship === undefined) {
    throw new IllegalActionError('no-such-ship', `飞船不在局中: ${shipId}`);
  }
  return ship;
}

/** 玩家剩余的可用穿梭机数。 */
export function shuttlesAvailable(state: GameState, idx: PlayerIndex): number {
  const p = state.players[idx]!;
  return shuttlesPerPlayer(state.config.playerCount) - p.shuttles.length;
}

/** 探索费用（vp + 族属额外费用）。 */
function exploreCost(state: GameState, idx: PlayerIndex): { vp: number; discardPower: boolean; brainstoneToGaia: boolean } {
  const p = state.players[idx]!;
  return {
    vp: p.faction === 'baltaks' ? EXPLORE_SHIP_COST_VP_BALTAKS : EXPLORE_SHIP_COST_VP,
    discardPower: p.faction === 'nevlas' || p.faction === 'itars',
    brainstoneToGaia: p.faction === 'taklons',
  };
}

/** 探索某船的最小 qic 补程；不可探索返回 null（射程/穿梭机/费用不满足）。 */
function exploreTarget(
  state: GameState,
  idx: PlayerIndex,
  ship: ShipState,
  opts?: { tempRange?: number },
): { qic: number } | null {
  const p = state.players[idx]!;
  if (shuttlesAvailable(state, idx) <= 0 || p.shuttles.some((s) => s.ship === ship.id)) {
    return null;
  }
  const cost = exploreCost(state, idx);
  if (p.vp < cost.vp) {
    return null;
  }
  if (cost.discardPower) {
    const pw = p.power;
    if (pw.bowl1 + pw.bowl2 + pw.bowl3 + (pw.brainstone !== 'none' ? 1 : 0) < 1) {
      return null;
    }
  }
  const range = rangeOf(p) + (opts?.tempRange ?? 0);
  const need = minDistanceToAny(state.map, rangeSources(state, idx), ship.hex) - range;
  const qic = need > 0 ? Math.ceil(need / 2) : 0;
  return p.resources.qic >= qic ? { qic } : null;
}

/** 探索某船的最小 qic 补程是否付得起（gleens-range/ship-range3 加程探索枚举用）。 */
export function exploreInRange(state: GameState, idx: PlayerIndex, shipId: ShipId, tempRange = 0): boolean {
  const ship = state.board.ships.find((s) => s.id === shipId);
  return ship !== undefined && exploreTarget(state, idx, ship, { tempRange }) !== null;
}

/** 枚举 explore-ship（行动 11；每船一个行动，qic 补程 apply 时重算扣除）。 */
export function enumerateExploreShip(state: GameState, idx: PlayerIndex): Action[] {
  if (!state.config.lostFleet) {
    return [];
  }
  const out: Action[] = [];
  for (const ship of state.board.ships) {
    if (exploreTarget(state, idx, ship) !== null) {
      out.push({ type: 'explore-ship', ship: ship.id });
    }
  }
  return out;
}

/** 应用 explore-ship（原地修改）；opts.tempRange 供 gleens-range/ship-range3 加程。 */
export function applyExploreShip(
  state: GameState,
  idx: PlayerIndex,
  shipId: ShipId,
  opts?: { tempRange?: number },
): void {
  const ship = shipOf(state, shipId);
  const t = exploreTarget(state, idx, ship, opts);
  if (t === null) {
    throw new IllegalActionError('illegal-explore', `不可探索飞船: ${shipId}`);
  }
  const p = player(state, idx);
  const cost = exploreCost(state, idx);
  spendResources(p, { qic: t.qic });
  p.vp -= cost.vp;
  if (cost.discardPower) {
    discardPowerTokens(p, 1);
  }
  if (cost.brainstoneToGaia) {
    p.power.brainstone = 'gaia';
  }
  const slot = ship.shuttleSlots.indexOf(null);
  if (slot < 0) {
    throw new IllegalActionError('ship-full', `飞船穿梭机位已满: ${shipId}`);
  }
  ship.shuttleSlots[slot] = idx;
  p.shuttles.push({ ship: shipId, slot });
  if (!p.exploredShips.includes(shipId)) {
    p.exploredShips.push(shipId);
  }
  // 非首个探索者按格号充能。
  const charge = shuttleSlotCharge(slot);
  if (charge > 0) {
    chargePower(p, charge);
  }
  state.pending = null;
}

// ---------------------------------------------------------------------------
// 立即盖亚计划（ship-instant-gaia / boosterlf4：免移 power、立即转化、本轮可建矿复用）
// ---------------------------------------------------------------------------

/** 立即盖亚计划目标；非法返回 null（枚举与 apply 共用）。 */
export function computeImmediateGaiaTarget(
  state: GameState,
  idx: PlayerIndex,
  hexKey: HexKey,
  opts?: { tempRange?: number },
): { qic: number } | null {
  const p = state.players[idx];
  const hex = state.map[hexKey];
  if (p === undefined || hex === undefined || p.gaiaformers.available < 1) {
    return null;
  }
  if (hex.planet !== 'transdim' || hex.building !== undefined || hex.ship !== undefined) {
    return null;
  }
  if (state.gaiaProjectsInProgress.some((pr) => pr.hex === hexKey)) {
    return null;
  }
  const range = rangeOf(p) + (opts?.tempRange ?? 0);
  const need = minDistanceToAny(state.map, rangeSources(state, idx), hexKey) - range;
  const qic = need > 0 ? Math.ceil(need / 2) : 0;
  return p.resources.qic >= qic ? { qic } : null;
}

/** 应用立即盖亚计划（原地修改）：不移动 power，transdim 立即转 gaia。 */
export function applyImmediateGaiaProject(
  state: GameState,
  idx: PlayerIndex,
  hexKey: HexKey,
  opts?: { tempRange?: number },
): void {
  const t = computeImmediateGaiaTarget(state, idx, hexKey, opts);
  if (t === null) {
    throw new IllegalActionError('illegal-gaia-project', `非法立即盖亚计划目标: ${hexKey}`);
  }
  const p = player(state, idx);
  spendResources(p, { qic: t.qic });
  p.gaiaformers.available -= 1;
  const hex = state.map[hexKey]!;
  hex.planet = 'gaia';
  hex.gaiaformerOf = idx;
  state.pending = null;
}

// ---------------------------------------------------------------------------
// ship-action（12 格）
// ---------------------------------------------------------------------------

function shipActionKey(ship: ShipId, action: ShipActionId): string {
  return `${ship}:${action}`;
}

/** 玩家是否解锁某船行动格（有穿梭机 + 该格在本船 + 本轮未用）。 */
function shipActionAvailable(state: GameState, idx: PlayerIndex, ship: ShipId, action: ShipActionId): boolean {
  const p = state.players[idx]!;
  return (
    p.shuttles.some((s) => s.ship === ship) &&
    SHIP_ACTION_SPACES[ship].includes(action) &&
    !state.board.shipActionsUsed.includes(shipActionKey(ship, action))
  );
}

/** 负担得起飞船行动格费用。 */
function canAffordShipAction(state: GameState, idx: PlayerIndex, action: ShipActionId): boolean {
  const p = state.players[idx]!;
  const cost = SHIP_ACTIONS[action].cost;
  if (cost.power !== undefined && spendablePower(p) < cost.power) {
    return false;
  }
  const r = p.resources;
  return (
    (cost.qic ?? 0) <= r.qic &&
    (cost.ore ?? 0) <= r.ore &&
    (cost.credits ?? 0) <= r.credits &&
    (cost.knowledge ?? 0) <= r.knowledge
  );
}

/** 扣除行动格资源费用后的剩余（枚举建矿/盖亚目标时须与行动费合并核算）。 */
function resourcesAfterShipCost(state: GameState, idx: PlayerIndex, action: ShipActionId): { ore: number; credits: number; knowledge: number; qic: number } {
  const p = state.players[idx]!;
  const cost = SHIP_ACTIONS[action].cost;
  return {
    ore: p.resources.ore - (cost.ore ?? 0),
    credits: p.resources.credits - (cost.credits ?? 0),
    knowledge: p.resources.knowledge - (cost.knowledge ?? 0),
    qic: p.resources.qic - (cost.qic ?? 0),
  };
}

/** 枚举 ship-action。 */
export function enumerateShipActions(state: GameState, idx: PlayerIndex): Action[] {
  if (!state.config.lostFleet) {
    return [];
  }
  const p = state.players[idx]!;
  const out: Action[] = [];
  for (const ship of state.board.ships) {
    if (!p.shuttles.some((s) => s.ship === ship.id)) {
      continue;
    }
    for (const actionId of SHIP_ACTION_SPACES[ship.id]) {
      if (!shipActionAvailable(state, idx, ship.id, actionId) || !canAffordShipAction(state, idx, actionId)) {
        continue;
      }
      const push = (payload?: ActionPayload): void => {
        out.push(
          payload !== undefined
            ? { type: 'ship-action', action: actionId, ship: ship.id, payload }
            : { type: 'ship-action', action: actionId, ship: ship.id },
        );
      };
      const def = SHIP_ACTIONS[actionId];
      switch (def.effect.kind) {
        case 'rescore-federation-full': {
          const ids = [...new Set(p.federationTokens.map((t) => t.id))];
          for (const federationToken of ids) {
            push({ federationToken });
          }
          break;
        }
        case 'vp-per-planet-type':
        case 'vp-per-standard-tech-tile':
        case 'gain':
          push();
          break;
        case 'gain-tech-tile':
          for (const choice of enumerateTechTileChoices(state, idx, { fromShips: true })) {
            push(payloadFromTechChoice(choice));
          }
          break;
        case 'free-upgrade': {
          const from = def.effect.from;
          const to = def.effect.to;
          if (p.buildings[to] > 0) {
            for (const [key, hex] of Object.entries(state.map)) {
              if (hex.building?.type === from && hex.building.player === idx) {
                if (to === 'lab') {
                  // 升 lab 拿科技板：每个目标格 × 每组拿板选择（与正常升级一致）。
                  for (const choice of enumerateTechTileChoices(state, idx, { fromShips: true })) {
                    push({ hex: key as HexKey, ...payloadFromTechChoice(choice) });
                  }
                } else {
                  push({ hex: key as HexKey });
                }
              }
            }
          }
          break;
        }
        case 'research':
          for (const adv of legalResearchAdvances(state, idx, TRACKS)) {
            push(payloadFromResearchChoice(adv));
          }
          push(); // 放弃升轨（参考允许 decline up，行动格仍消耗）
          break;
        case 'gaia-project-immediate':
          for (const key of Object.keys(state.map) as HexKey[]) {
            if (computeImmediateGaiaTarget(state, idx, key) !== null) {
              push({ hex: key });
            }
          }
          break;
        case 'range': {
          const tempRange = def.effect.amount;
          const rem = resourcesAfterShipCost(state, idx, actionId);
          // 建矿 / 盖亚计划（临时射程，如 booster5）+ 探索飞船。
          for (const key of Object.keys(state.map) as HexKey[]) {
            const t = computeMineTarget(state, idx, key, { tempRange });
            if (t !== null && rem.ore >= t.ore && rem.credits >= t.credits && rem.qic >= t.qic) {
              push({ hex: key });
            }
          }
          for (const a of enumerateGaiaProject(state, idx, { tempRange })) {
            push({ hex: (a as Extract<Action, { type: 'start-gaia-project' }>).hex });
          }
          for (const target of state.board.ships) {
            if (exploreTarget(state, idx, target, { tempRange }) !== null) {
              push({ ship: target.id });
            }
          }
          break;
        }
        case 'build-mine': {
          const rem = resourcesAfterShipCost(state, idx, actionId);
          for (const key of Object.keys(state.map) as HexKey[]) {
            // ship-terraform-step：参考 spaceship 建矿路径（shipCreditBuild：
            // 免 Gaia 居住费、不得 proto +6vp、排除 asteroid 目标）。
            const t = computeMineTarget(state, idx, key, {
              freeTerraformSteps: def.effect.freeTerraformSteps,
              shipCreditBuild: true,
            });
            if (t !== null && rem.ore >= t.ore && rem.credits >= t.credits && rem.qic >= t.qic) {
              push({ hex: key });
            }
          }
          break;
        }
        case 'build-mine-asteroid': {
          const rem = resourcesAfterShipCost(state, idx, actionId);
          for (const key of Object.keys(state.map) as HexKey[]) {
            if (state.map[key]!.planet !== 'asteroid') {
              continue;
            }
            const t = computeMineTarget(state, idx, key, { asteroidNoGaiaformer: true });
            // 注意 lantids：在对手小行星矿上建附加矿需付矿费（kind='lantids'），
            // 与其它小行星目标（免费）分开按完整成本校验。
            if (t !== null && rem.ore >= t.ore && rem.credits >= t.credits && rem.qic >= t.qic) {
              push({ hex: key });
            }
          }
          break;
        }
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
  if (choice.ship !== undefined) {
    payload.ship = choice.ship;
  }
  const research = choice.research;
  if (research !== null) {
    payload.track = research.track;
    if (research.flipToken !== undefined) {
      payload.flipToken = research.flipToken;
    }
    if (research.lostPlanetHex !== undefined) {
      payload.lostPlanetHex = research.lostPlanetHex;
    }
  }
  return payload;
}

/** 把研究推进选择折进 ActionPayload。 */
function payloadFromResearchChoice(adv: ResearchAdvanceChoice): ActionPayload {
  const payload: ActionPayload = { track: adv.track };
  if (adv.flipToken !== undefined) {
    payload.flipToken = adv.flipToken;
  }
  if (adv.lostPlanetHex !== undefined) {
    payload.lostPlanetHex = adv.lostPlanetHex;
  }
  return payload;
}

/** 应用 ship-action（原地修改）。 */
export function applyShipAction(
  state: GameState,
  idx: PlayerIndex,
  shipId: ShipId,
  actionId: ShipActionId,
  payload?: ActionPayload,
): void {
  const p = player(state, idx);
  if (!shipActionAvailable(state, idx, shipId, actionId)) {
    throw new IllegalActionError('ship-action-unavailable', `飞船行动格不可用: ${shipId}:${actionId}`);
  }
  const def = SHIP_ACTIONS[actionId];
  const cost = def.cost;
  if (cost.power !== undefined) {
    spendPower(p, cost.power);
  }
  spendResources(p, { qic: cost.qic ?? 0, ore: cost.ore ?? 0, credits: cost.credits ?? 0, knowledge: cost.knowledge ?? 0 });
  state.board.shipActionsUsed.push(shipActionKey(shipId, actionId));
  // advtechlf5 触发器：每次执行 Q.I.C. 行动 +4vp。
  if ((cost.qic ?? 0) > 0) {
    onQicAction(state, idx);
  }

  let offers: ChargeOffer[] = [];
  switch (def.effect.kind) {
    case 'rescore-federation-full': {
      // 重结算联邦标记：vp + 资源 + 全部即时效果（fedlf 转 pending）。
      const tokenId = payload?.federationToken;
      if (tokenId === undefined || !p.federationTokens.some((t) => t.id === tokenId)) {
        throw new IllegalActionError('no-such-token', `未持有联邦标记: ${String(tokenId)}`);
      }
      const effect = applyFederationTokenReward(state, idx, tokenId);
      settlePendingAfter(state, idx, [], {
        freeMine: effect.freeMine ?? null,
        ...(effect.gainTechTile === true ? { gainTechTileFromShips: true } : {}),
      });
      return;
    }
    case 'vp-per-planet-type':
      addVp(p, def.effect.base + countUnits(state, idx, 'planet-type') * def.effect.perType);
      break;
    case 'vp-per-standard-tech-tile':
      addVp(p, def.effect.base + countUnits(state, idx, 'standard-tech-tile') * def.effect.perTile);
      break;
    case 'gain':
      applyGain(state, idx, def.effect.gain);
      break;
    case 'gain-tech-tile': {
      const choice = techChoiceFromPayload(payload);
      const result = applyTechTileChoice(state, idx, choice);
      settlePendingAfter(state, idx, result.offers, { freeMine: result.freeMine });
      return;
    }
    case 'free-upgrade': {
      // 免费升 mine→ts / ts→lab。升 lab 与正常升级一样拿科技板
      // （参考引擎 placeBuilding 对 lab 统一走 ChooseTechTile 流程）。
      const hexKey = payload?.hex;
      const hex = hexKey === undefined ? undefined : state.map[hexKey];
      if (hexKey === undefined || hex === undefined || hex.building?.type !== def.effect.from || hex.building.player !== idx) {
        throw new IllegalActionError('illegal-free-upgrade', `非法免费升级目标: ${String(hexKey)}`);
      }
      const to = def.effect.to;
      if (p.buildings[to] <= 0) {
        throw new IllegalActionError('no-building-supply', `面板无剩余建筑: ${to}`);
      }
      hex.building = { type: to, player: idx };
      p.buildings[def.effect.from] += 1;
      p.buildings[to] -= 1;
      addBuildingToNearbyFederation(state, idx, hexKey);
      onUpgrade(state, idx, to === 'ts' ? 'ts' : 'lab');
      offers = makeChargeOffers(state, idx, hexKey);
      if (to === 'lab') {
        // 升 lab 拿科技板（payload 科技链；techlf1 免费建矿转 pending）。
        const result = applyTechTileChoice(state, idx, techChoiceFromPayload(payload));
        settlePendingAfter(state, idx, [...result.offers, ...offers], { freeMine: result.freeMine });
        return;
      }
      break;
    }
    case 'research': {
      // payload.track 缺省 = 放弃升轨（参考 decline up；行动格仍消耗）。
      if (payload?.track === undefined) {
        break;
      }
      const choice: ResearchAdvanceChoice = { track: payload.track };
      if (payload.flipToken !== undefined) {
        choice.flipToken = payload.flipToken;
      }
      if (payload.lostPlanetHex !== undefined) {
        choice.lostPlanetHex = payload.lostPlanetHex;
      }
      offers = advanceResearchLevel(state, idx, choice);
      break;
    }
    case 'gaia-project-immediate': {
      if (payload?.hex === undefined) {
        throw new IllegalActionError('missing-payload', 'ship-instant-gaia 需要 payload.hex');
      }
      applyImmediateGaiaProject(state, idx, payload.hex);
      return;
    }
    case 'range': {
      if (payload?.ship !== undefined) {
        applyExploreShip(state, idx, payload.ship, { tempRange: def.effect.amount });
        return;
      }
      if (payload?.hex === undefined) {
        throw new IllegalActionError('missing-payload', 'ship-range3 需要 payload.hex/ship');
      }
      if (state.map[payload.hex]!.planet === 'transdim') {
        applyGaiaProject(state, idx, payload.hex, { tempRange: def.effect.amount });
        state.pending = null;
      } else {
        applyBuildMine(state, idx, payload.hex, { tempRange: def.effect.amount });
      }
      return;
    }
    case 'build-mine': {
      if (payload?.hex === undefined) {
        // 参考允许激活后放弃建矿（spaceshipAction tfmars credit. endturn）：
        // 费用照付、行动格照耗（枚举不产出该变体，harness 对拍用）。
        state.pending = null;
        return;
      }
      // ship-terraform-step：参考 spaceship 建矿路径（shipCreditBuild，见 mine.ts）。
      applyBuildMine(state, idx, payload.hex, {
        freeTerraformSteps: def.effect.freeTerraformSteps,
        shipCreditBuild: true,
      });
      return;
    }
    case 'build-mine-asteroid': {
      if (payload?.hex === undefined) {
        // 同 ship-terraform-step：参考允许放弃（费用照付、行动格照耗）。
        state.pending = null;
        return;
      }
      applyBuildMine(state, idx, payload.hex, { asteroidNoGaiaformer: true });
      return;
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
  if (payload.ship !== undefined) {
    choice.ship = payload.ship;
  }
  if (payload.track !== undefined) {
    const research: ResearchAdvanceChoice = { track: payload.track };
    if (payload.flipToken !== undefined) {
      research.flipToken = payload.flipToken;
    }
    if (payload.lostPlanetHex !== undefined) {
      research.lostPlanetHex = payload.lostPlanetHex;
    }
    choice.research = research;
  }
  return choice;
}

// ---------------------------------------------------------------------------
// inspect-artifact（行动 12）
// ---------------------------------------------------------------------------

/** 枚举 inspect-artifact（限 twilight 有己方穿梭机 + 弃得起 6 power；art-fed 按持有标记逐枚枚举）。 */
export function enumerateInspectArtifact(state: GameState, idx: PlayerIndex): Action[] {
  if (!state.config.lostFleet) {
    return [];
  }
  const p = state.players[idx]!;
  const twilight = state.board.ships.find((s) => s.id === 'twilight');
  if (twilight === undefined || twilight.artifacts.length === 0) {
    return [];
  }
  if (!p.shuttles.some((s) => s.ship === 'twilight')) {
    return [];
  }
  const pw = p.power;
  if (pw.bowl1 + pw.bowl2 + pw.bowl3 + (pw.brainstone !== 'none' ? 1 : 0) < 6) {
    return [];
  }
  const out: Action[] = [];
  for (const a of twilight.artifacts) {
    if (a.id === 'art-fed') {
      // 重新触发 1 枚已有联邦标记：逐枚枚举；未持有标记时参考引擎仍可取
      // （no-effect 认领，参考 available/artifacts.ts noEffectTokens）。
      const owned = new Set(p.federationTokens.map((t) => t.id));
      if (owned.size === 0) {
        out.push({ type: 'inspect-artifact', artifact: a.id });
      } else {
        for (const federationToken of owned) {
          out.push({ type: 'inspect-artifact', artifact: a.id, federationToken });
        }
      }
    } else {
      out.push({ type: 'inspect-artifact', artifact: a.id });
    }
  }
  return out;
}

/** art-asteroid/art-proto：+7vp 且视作殖民对应星球类型（触发新类型计分；无扇区、不得 proto 6vp）。 */
function applyArtifactPlanetType(state: GameState, idx: PlayerIndex, planet: 'asteroid' | 'proto'): void {
  const p = player(state, idx);
  addVp(p, 7);
  if (!p.colonizedPlanetTypes.includes(planet)) {
    p.colonizedPlanetTypes.push(planet);
    // 视作建矿殖民新星球类型（参照 reference move/artifacts.ts 的 NewPlanetType 触发）。
    onNewPlanetType(state, idx);
  }
}

/** 应用 inspect-artifact（原地修改）：弃 6 power 拿 1 artifact 并立即结算。 */
export function applyInspectArtifact(
  state: GameState,
  idx: PlayerIndex,
  artifact: ArtifactState['id'],
  federationToken?: FederationTokenId,
): void {
  const p = player(state, idx);
  const twilight = shipOf(state, 'twilight');
  if (!p.shuttles.some((s) => s.ship === 'twilight')) {
    throw new IllegalActionError('inspect-unavailable', '未探索 Twilight 不能检查神器');
  }
  const ai = twilight.artifacts.findIndex((a) => a.id === artifact);
  if (ai < 0) {
    throw new IllegalActionError('artifact-unavailable', `神器不在 Twilight 上: ${artifact}`);
  }
  discardPowerTokens(p, 6);
  const taken = twilight.artifacts.splice(ai, 1)[0]!;
  p.artifacts.push(taken);
  switch (taken.id) {
    case 'art-1k1o':
    case 'art-pwt':
      // 收入类（turn.ts settleIncome 结算），无即时效果。
      break;
    case 'art-3c3o':
      gainResources(p, { credits: 3, ore: 3 });
      break;
    case 'art-3k1q':
      gainResources(p, { knowledge: 3, qic: 1 });
      break;
    case 'art-5c2o':
      gainResources(p, { credits: 5, ore: 2 });
      break;
    case 'art-asteroid':
      applyArtifactPlanetType(state, idx, 'asteroid');
      break;
    case 'art-proto':
      applyArtifactPlanetType(state, idx, 'proto');
      break;
    case 'art-sci':
      addVp(p, 3 * p.research.sci);
      break;
    case 'art-gaia':
      addVp(p, 3 * p.research.gaia);
      break;
    case 'art-track':
      addVp(p, 3 * TRACKS.filter((t) => p.research[t] >= 3).length);
      break;
    case 'art-planet':
      addVp(p, 3 + countUnits(state, idx, 'planet-type'));
      break;
    case 'art-deep':
      addVp(p, 3 * countUnits(state, idx, 'deep-space-sector'));
      break;
    case 'art-fed': {
      // 重新触发 1 枚已有联邦标记（含即时效果；同 ship-rescore-fed 流程）。
      // 未指定标记 = no-effect 认领（参考：未持有标记时仍可取，无效果）。
      if (federationToken === undefined) {
        break;
      }
      if (!p.federationTokens.some((t) => t.id === federationToken)) {
        throw new IllegalActionError('no-such-token', `未持有联邦标记: ${String(federationToken)}`);
      }
      const effect = applyFederationTokenReward(state, idx, federationToken);
      settlePendingAfter(state, idx, [], {
        freeMine: effect.freeMine ?? null,
        ...(effect.gainTechTile === true ? { gainTechTileFromShips: true } : {}),
      });
      return;
    }
  }
  state.pending = null;
}
