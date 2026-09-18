/**
 * upgrade 主行动：建筑升级链、费用、拿科技板、PI 能力解锁、触发器与充能邀约。
 *
 * 链（data/prices.ts；bescods 用 UPGRADE_CHAIN_BESCODS——PI/学院位置互换）：
 * mine→ts（6c+2o；2 格内有对手建筑 3c+2o）；ts→lab（5c+3o）；ts→pi（6c+4o）；
 * lab→ac1/ac2（6c+6o）。
 * - 旧建筑回面板 supply、新建筑从 supply 出（supply 不足不可建）。
 * - 升 lab/学院立即拿科技板（actions/tech.ts 共享流程）；供应无板可拿时允许不拿。
 * - 升 PI 解锁种族 PI 能力（gleens 立即拿专属联邦标记；其余为被动/行动格解锁，
 *   由各系统按 buildings.pi===0 判定）。
 * - 触发器：onUpgrade（升 ts/升 lab/升 PI·学院）；对手被动充能邀约（同建矿）。
 */
import { IllegalActionError } from '../errors.js';
import type { Action, BuildingType, GameState, PlayerIndex, PlayerState } from '../types.js';
import type { HexKey } from '../hex.js';
import { hexesWithin } from '../map.js';
import { BUILDING_COST, UPGRADE_CHAIN, UPGRADE_CHAIN_BESCODS } from '../data/prices.js';
import { FEDERATION_TOKENS } from '../data/federations.js';
import { addVp, applyGain, player, spendResources } from '../state.js';
import { onFederationFormed, onUpgrade } from '../triggers.js';
import { makeChargeOffers } from './charge.js';
import { addBuildingToNearbyFederation } from './federation.js';
import {
  applyTechTileChoice,
  enumerateTechTileChoices,
  settlePendingAfter,
  type TechTileChoice,
  type TechTileChoiceResult,
} from './tech.js';
import type { ResearchAdvanceChoice } from './research.js';

/** 升级目标建筑类型（不含 mine/sp/gf）。 */
type UpgradeTarget = 'ts' | 'lab' | 'pi' | 'ac1' | 'ac2';

/** 该玩家的升级链（bescods PI/学院位置互换）。 */
export function upgradeChainOf(p: PlayerState): Record<BuildingType, readonly BuildingType[]> {
  return p.faction === 'bescods' ? UPGRADE_CHAIN_BESCODS : UPGRADE_CHAIN;
}

/** mine→ts 邻近折扣：2 格内有对手建筑（不含 gf/sp；含 Lantids 附加矿与 Lost Planet）。 */
function opponentStructureNearby(state: GameState, idx: PlayerIndex, hexKey: HexKey): boolean {
  for (const h of hexesWithin(state.map, hexKey, 2)) {
    const hex = state.map[h]!;
    const b = hex.building;
    if (b !== undefined && b.player !== idx && b.type !== 'gf' && b.type !== 'sp') {
      return true;
    }
    if (hex.additionalMine !== undefined && hex.additionalMine !== idx) {
      return true;
    }
    if (hex.planet === 'lost' && hex.satelliteOf !== undefined && hex.satelliteOf !== idx) {
      return true;
    }
  }
  return false;
}

/** 升级费用（枚举与 apply 共用）。 */
export function upgradeCost(
  state: GameState,
  idx: PlayerIndex,
  hexKey: HexKey,
  to: UpgradeTarget,
): { ore: number; credits: number } {
  const hex = state.map[hexKey]!;
  if (to === 'ts') {
    return opponentStructureNearby(state, idx, hexKey) ? BUILDING_COST.tsAdjacent : BUILDING_COST.ts;
  }
  if (to === 'lab') {
    return BUILDING_COST.lab;
  }
  if (to === 'pi') {
    return BUILDING_COST.pi;
  }
  return BUILDING_COST.academy;
}

/** hex 上该玩家的可升级目标（链合法 + supply 有剩 + 负担得起）。 */
function legalUpgradeTargets(state: GameState, idx: PlayerIndex, hexKey: HexKey): UpgradeTarget[] {
  const p = state.players[idx]!;
  const hex = state.map[hexKey]!;
  const b = hex.building;
  if (b === undefined || b.player !== idx) {
    return [];
  }
  const out: UpgradeTarget[] = [];
  for (const to of upgradeChainOf(p)[b.type]) {
    if (to !== 'ts' && to !== 'lab' && to !== 'pi' && to !== 'ac1' && to !== 'ac2') {
      continue;
    }
    if (p.buildings[to] <= 0) {
      continue;
    }
    const cost = upgradeCost(state, idx, hexKey, to);
    if (p.resources.ore >= cost.ore && p.resources.credits >= cost.credits) {
      out.push(to);
    }
  }
  return out;
}

/** 升级行动负载（科技板选择折进 upgrade 行动字段）。 */
function upgradeActionWithChoice(
  hex: HexKey,
  to: UpgradeTarget,
  choice: TechTileChoice | null,
): Extract<Action, { type: 'upgrade' }> {
  const action: Extract<Action, { type: 'upgrade' }> = { type: 'upgrade', hex, to };
  if (choice === null) {
    return action;
  }
  if (choice.techTile !== undefined) {
    action.techTile = choice.techTile;
  }
  if (choice.advTechTile !== undefined) {
    action.advTechTile = choice.advTechTile;
  }
  if (choice.coverTechTile !== undefined) {
    action.coverTechTile = choice.coverTechTile;
  }
  if (choice.flipToken !== undefined) {
    action.flipToken = choice.flipToken;
  }
  if (choice.ship !== undefined) {
    action.ship = choice.ship;
  }
  const research: ResearchAdvanceChoice | null = choice.research;
  action.research = research === null ? null : research.track;
  if (research !== null && research.flipToken !== undefined) {
    action.flipToken = research.flipToken;
  }
  if (research !== null && research.lostPlanetHex !== undefined) {
    action.lostPlanetHex = research.lostPlanetHex;
  }
  return action;
}

/** 枚举 upgrade 行动。 */
export function enumerateUpgrade(state: GameState, idx: PlayerIndex): Action[] {
  const out: Action[] = [];
  for (const key of Object.keys(state.map) as HexKey[]) {
    const targets = legalUpgradeTargets(state, idx, key);
    for (const to of targets) {
      // 仅升 lab/学院拿科技板（ts/pi 不拿）；供应无板可拿时允许不拿。
      if (to === 'ts' || to === 'pi') {
        out.push({ type: 'upgrade', hex: key, to });
        continue;
      }
      const choices = enumerateTechTileChoices(state, idx, { fromShips: state.config.lostFleet });
      if (choices.length === 0) {
        out.push({ type: 'upgrade', hex: key, to });
      } else {
        for (const choice of choices) {
          out.push(upgradeActionWithChoice(key, to, choice));
        }
      }
    }
  }
  return out;
}

/** 应用 upgrade（原地修改）。 */
export function applyUpgrade(
  state: GameState,
  idx: PlayerIndex,
  action: Extract<Action, { type: 'upgrade' }>,
): void {
  const p = player(state, idx);
  const hex = state.map[action.hex];
  if (hex === undefined || hex.building === undefined || hex.building.player !== idx) {
    throw new IllegalActionError('illegal-upgrade', `该格没有己方建筑: ${action.hex}`);
  }
  const from = hex.building.type;
  if (!upgradeChainOf(p)[from].includes(action.to) || p.buildings[action.to] <= 0) {
    throw new IllegalActionError('illegal-upgrade', `非法升级: ${from} → ${action.to}`);
  }
  const cost = upgradeCost(state, idx, action.hex, action.to);
  spendResources(p, cost);

  // 旧建筑回 supply、新建筑出 supply。
  hex.building = { type: action.to, player: idx };
  if (from === 'mine' || from === 'ts' || from === 'lab' || from === 'pi' || from === 'ac1' || from === 'ac2') {
    p.buildings[from] += 1;
  }
  p.buildings[action.to] -= 1;

  // 新建筑并入邻近联邦（参考 addBuildingToNearbyFederation）。
  addBuildingToNearbyFederation(state, idx, action.hex);

  // 拿科技板（升 lab/学院；可能产生 nav L5 Lost Planet 充能邀约或 techlf1 免费建矿）。
  const techResult = action.to === 'ts' || action.to === 'pi' ? null : applyUpgradeTechTile(state, idx, action);
  let offers = techResult?.offers ?? [];

  // PI 能力解锁（gleens：立即拿专属联邦标记，算组建联邦）。
  if (action.to === 'pi' && p.faction === 'gleens' && (state.board.federationTokens['gleens'] ?? 0) > 0) {
    state.board.federationTokens['gleens'] = state.board.federationTokens['gleens']! - 1;
    p.federationTokens.push({ id: 'gleens', flipped: false });
    p.acquisitions.push({ kind: 'fed', id: 'gleens' });
    const def = FEDERATION_TOKENS['gleens'];
    addVp(p, def.vp);
    if (def.other !== undefined) {
      applyGain(state, idx, def.other);
    }
    onFederationFormed(state, idx);
  }

  // 升级触发器。
  if (action.to === 'ts') {
    onUpgrade(state, idx, 'ts');
  } else if (action.to === 'lab') {
    onUpgrade(state, idx, 'lab');
  } else {
    onUpgrade(state, idx, 'pi-academy');
  }

  // 对手被动充能邀约（与 Lost Planet 邀约合并为一个队列）。
  offers = [...offers, ...makeChargeOffers(state, idx, action.hex)];

  // Space Giants PI：一次性立即拿 1 块科技板（规则同升级拿板；可拿船上板）。
  if (action.to === 'pi' && p.faction === 'space-giants') {
    settlePendingAfter(state, idx, offers, { gainTechTileFromShips: true });
    return;
  }
  settlePendingAfter(state, idx, offers, { freeMine: techResult?.freeMine ?? null });
}

/** 升级拿板：把 upgrade 行动字段折回 TechTileChoice 并应用。 */
function applyUpgradeTechTile(
  state: GameState,
  idx: PlayerIndex,
  action: Extract<Action, { type: 'upgrade' }>,
): TechTileChoiceResult {
  if (action.techTile === undefined && action.advTechTile === undefined) {
    // 供应无板可拿（枚举层只在 choices 为空时产生无板升级）。
    if (enumerateTechTileChoices(state, idx, { fromShips: state.config.lostFleet }).length > 0) {
      throw new IllegalActionError('tech-tile-required', '升级 lab/学院必须拿科技板');
    }
    return { offers: [], freeMine: null };
  }
  const choice: TechTileChoice = { research: null };
  if (action.techTile !== undefined) {
    choice.techTile = action.techTile;
  }
  if (action.advTechTile !== undefined) {
    choice.advTechTile = action.advTechTile;
  }
  if (action.coverTechTile !== undefined) {
    choice.coverTechTile = action.coverTechTile;
  }
  if (action.flipToken !== undefined) {
    choice.flipToken = action.flipToken;
  }
  if (action.ship !== undefined) {
    choice.ship = action.ship;
  }
  if (action.research !== undefined && action.research !== null) {
    const research: ResearchAdvanceChoice = { track: action.research };
    if (action.lostPlanetHex !== undefined) {
      research.lostPlanetHex = action.lostPlanetHex;
    }
    // 标准板升 L5 的翻面标记复用 flipToken 字段。
    if (action.flipToken !== undefined) {
      research.flipToken = action.flipToken;
    }
    choice.research = research;
  }
  return applyTechTileChoice(state, idx, choice);
}
