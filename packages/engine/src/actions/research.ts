/**
 * research 主行动：4k 升 1 级；以及全部"推进 1 级研究"入口共享的 helper
 * （legalResearchAdvances / advanceResearchLevel）——科技板升轨、bescods-up、
 * firaks-down、ship-research 都走同一套。
 *
 * 通用规则：
 * - 目标轨 <5；升 L5 需 flipToken 翻自己一枚绿面联邦标记，且该轨
 *   board.researchLevel5 无人（每轨全游戏仅 1 人）。
 * - baltaks 未建 PI 时禁止推进 nav 轨（含科技板升轨）。
 * - 升 L3 充能 3pw（data/research.ts 已并入各级 once.chargePower）。
 * - Terraforming L5：拿 board.terraformingL5Token（绿面、立即得奖励、算组建
 *   联邦——触发 onFederationFormed 计分；标记 origin 记 fromTerraformingL5）。
 * - Navigation L5：lostPlanetHex 放 Lost Planet（可达空格 = 范围 4 内 empty hex，
 *   可 qic 补程 1q=+2 格——可达性同建矿，枚举算最小补程、apply 重算扣费；
 *   不放矿结构、放 1 卫星标记、算殖民的独立星球类型；触发 onMine 计分与对手充能）。
 */
import { IllegalActionError } from '../errors.js';
import type {
  Action,
  ChargeOffer,
  FederationTokenId,
  GameState,
  PlayerIndex,
  PlayerState,
  ResearchTrack,
} from '../types.js';
import type { HexKey } from '../hex.js';
import { minDistanceToAny } from '../map.js';
import { RESEARCH_TRACKS } from '../data/research.js';
import { FEDERATION_TOKENS } from '../data/federations.js';
import { addVp, applyGain, player, spendResources } from '../state.js';
import { onFederationFormed, onMineBuilt, onResearchAdvance } from '../triggers.js';
import { makeChargeOffers } from './charge.js';
import { rangeSources } from './mine.js';
import { countUnits } from '../score.js';

const TRACK_ORDER: readonly ResearchTrack[] = ['terra', 'nav', 'int', 'gaia', 'eco', 'sci'];

/** Lost Planet 放置射程（nav L5 的 range 4）。 */
const LOST_PLANET_RANGE = 4;

/** 玩家可翻的绿面联邦标记 id（去重）。 */
export function flippableTokenIds(p: PlayerState): FederationTokenId[] {
  const ids = p.federationTokens
    .filter((t) => !t.flipped && FEDERATION_TOKENS[t.id].flippable)
    .map((t) => t.id);
  return [...new Set(ids)];
}

/** Lost Planet 候选格与最小 qic 补程：empty、无建筑/卫星/飞船格，范围 4 + qic 补程内。 */
export function lostPlanetCandidates(state: GameState, idx: PlayerIndex): { hex: HexKey; qic: number }[] {
  const p = state.players[idx]!;
  const sources = rangeSources(state, idx);
  const out: { hex: HexKey; qic: number }[] = [];
  for (const [key, hex] of Object.entries(state.map)) {
    if (hex.planet !== 'empty' || hex.building !== undefined || hex.satelliteOf !== undefined || hex.ship !== undefined) {
      continue;
    }
    const need = minDistanceToAny(state.map, sources, key as HexKey) - LOST_PLANET_RANGE;
    const qic = need > 0 ? Math.ceil(need / 2) : 0;
    if (p.resources.qic >= qic) {
      out.push({ hex: key as HexKey, qic });
    }
  }
  return out;
}

/** 一次"推进 1 级研究"的完整选择（科技板/种族能力/研究行动共用）。 */
export interface ResearchAdvanceChoice {
  track: ResearchTrack;
  /** 升 L5 时翻面的联邦标记。 */
  flipToken?: FederationTokenId;
  /** nav L5 的 Lost Planet 放置格。 */
  lostPlanetHex?: HexKey;
}

/** baltaks 未建 PI 禁止 nav 推进（建 PI 后解锁）。 */
export function trackAdvanceBlocked(p: PlayerState, track: ResearchTrack): boolean {
  return p.faction === 'baltaks' && p.buildings.pi > 0 && track === 'nav';
}

/**
 * 枚举候选轨上的合法推进选择。
 * - lvl<4：直接 {track}；
 * - lvl=4：该轨 L5 无人 + 有绿面标记可翻 → 每个可翻标记一个选择
 *   （nav 还需每个 Lost Planet 候选格一个选择）；
 * - opts.allowLevel5=false 时不枚举 L5 推进（itars 盖亚换板等不便携带
 *   翻面/Lost Planet 负载的入口）。
 */
export function legalResearchAdvances(
  state: GameState,
  idx: PlayerIndex,
  tracks: readonly ResearchTrack[],
  opts?: { allowLevel5?: boolean; flipTokens?: FederationTokenId[] },
): ResearchAdvanceChoice[] {
  const p = state.players[idx]!;
  const allowL5 = opts?.allowLevel5 !== false;
  // L5 翻面池：缺省=自己全部绿面标记；拿高级板等已耗一枚的场景由调用方扣减后传入。
  const flipPool = opts?.flipTokens ?? flippableTokenIds(p);
  const out: ResearchAdvanceChoice[] = [];
  for (const track of tracks) {
    if (trackAdvanceBlocked(p, track)) {
      continue;
    }
    const lvl = p.research[track];
    if (lvl >= 5) {
      continue;
    }
    if (lvl < 4) {
      out.push({ track });
      continue;
    }
    if (!allowL5 || state.board.researchLevel5[track] !== undefined) {
      continue;
    }
    for (const tokenId of flipPool) {
      if (track === 'nav') {
        for (const c of lostPlanetCandidates(state, idx)) {
          out.push({ track, flipToken: tokenId, lostPlanetHex: c.hex });
        }
      } else {
        out.push({ track, flipToken: tokenId });
      }
    }
  }
  return out;
}

/** 放置 Lost Planet（nav L5；原地修改，含 qic 补程扣费）；返回产生的充能邀约。 */
function placeLostPlanet(state: GameState, idx: PlayerIndex, hexKey: HexKey | undefined): ChargeOffer[] {
  const candidate = hexKey === undefined ? undefined : lostPlanetCandidates(state, idx).find((c) => c.hex === hexKey);
  if (hexKey === undefined || candidate === undefined) {
    throw new IllegalActionError('illegal-lost-planet', `非法 Lost Planet 放置格: ${String(hexKey)}`);
  }
  const p = player(state, idx);
  spendResources(p, { qic: candidate.qic });
  const hex = state.map[hexKey]!;
  hex.planet = 'lost';
  // 参考引擎把 Lost Planet 当作一个"矿"放置：不占卫星计数（data.satellites 不变），
  // satelliteOf 仅作归属标记（射程起点/充能 pv/联邦 pv 用）。
  hex.satelliteOf = idx;
  p.lostPlanetPlaced = true;
  // 视为殖民（独立星球类型；不放矿结构、放 1 卫星标记作提示）。
  let newPlanetType = false;
  if (!p.colonizedPlanetTypes.includes('lost')) {
    p.colonizedPlanetTypes.push('lost');
    newPlanetType = true;
  }
  let newSector = false;
  if (hex.sector !== 'interspace' && !p.colonizedSectors.includes(hex.sector)) {
    p.colonizedSectors.push(hex.sector);
    newSector = true;
  }
  // 算一次"建矿"：计分触发 + 对手充能邀约。
  onMineBuilt(state, idx, { onGaiaPlanet: false, newSector, newPlanetType });
  return makeChargeOffers(state, idx, hexKey);
}

/**
 * 推进 1 级研究（原地修改）；返回产生的充能邀约（nav L5 Lost Planet）。
 * 调用方负责合并邀约并设置 pending。校验与 legalResearchAdvances 一致。
 */
export function advanceResearchLevel(
  state: GameState,
  idx: PlayerIndex,
  choice: ResearchAdvanceChoice,
): ChargeOffer[] {
  const p = player(state, idx);
  const track = choice.track;
  if (trackAdvanceBlocked(p, track)) {
    throw new IllegalActionError('track-blocked', `baltaks 未建 PI 不能推进 nav 轨`);
  }
  const lvl = p.research[track];
  if (lvl >= 5) {
    throw new IllegalActionError('research-max', `研究轨已满级: ${track}`);
  }
  const newLevel = lvl + 1;

  if (newLevel === 5) {
    // 翻 1 枚绿面联邦标记到灰面；每轨全游戏仅 1 人。
    if (state.board.researchLevel5[track] !== undefined) {
      throw new IllegalActionError('track-level5-taken', `该轨已有人到 L5: ${track}`);
    }
    const tok = p.federationTokens.find(
      (t) => !t.flipped && t.id === choice.flipToken && FEDERATION_TOKENS[t.id].flippable,
    );
    if (tok === undefined) {
      throw new IllegalActionError('no-flippable-token', `无可翻联邦标记: ${String(choice.flipToken)}`);
    }
    tok.flipped = true;
    state.board.researchLevel5[track] = idx;
  }
  p.research[track] = newLevel;

  const effect = RESEARCH_TRACKS[track].levels[newLevel - 1]!;
  if (effect.once !== undefined) {
    applyGain(state, idx, effect.once);
  }
  // Gaia 轨 L5：每颗有建筑的 Gaia 星球额外 +vp。
  if (effect.vpPerGaiaPlanet !== undefined) {
    addVp(p, countUnits(state, idx, 'gaia-planet') * effect.vpPerGaiaPlanet);
  }
  // Terraforming L5：拿预设联邦标记（绿面、立即得奖励、算组建联邦）。
  if (effect.grantsPresetFederationToken === true && state.board.terraformingL5Token !== null) {
    const tokenId = state.board.terraformingL5Token;
    const def = FEDERATION_TOKENS[tokenId];
    p.federationTokens.push({ id: tokenId, flipped: false, fromTerraformingL5: true });
    p.acquisitions.push({ kind: 'fed', id: tokenId });
    state.board.terraformingL5Token = null;
    addVp(p, def.vp);
    if (def.other !== undefined) {
      applyGain(state, idx, def.other);
    }
    onFederationFormed(state, idx);
  }
  // Navigation L5：放置 Lost Planet（可能产生充能邀约）。
  const offers = effect.placesLostPlanet === true ? placeLostPlanet(state, idx, choice.lostPlanetHex) : [];
  onResearchAdvance(state, idx, track);
  return offers;
}

/** 枚举 research 行动（4k 升 1 级）。 */
export function enumerateResearch(state: GameState, idx: PlayerIndex): Action[] {
  const p = state.players[idx]!;
  if (p.resources.knowledge < 4) {
    return [];
  }
  const out: Action[] = [];
  for (const choice of legalResearchAdvances(state, idx, TRACK_ORDER)) {
    const action: Extract<Action, { type: 'research' }> = { type: 'research', track: choice.track };
    if (choice.flipToken !== undefined) {
      action.flipToken = choice.flipToken;
    }
    if (choice.lostPlanetHex !== undefined) {
      action.hex = choice.lostPlanetHex;
    }
    out.push(action);
  }
  return out;
}

/** 应用 research（原地修改）：4k 升 1 级。 */
export function applyResearch(
  state: GameState,
  idx: PlayerIndex,
  action: { track: ResearchTrack; flipToken?: FederationTokenId; hex?: HexKey },
): void {
  const p = player(state, idx);
  spendResources(p, { knowledge: 4 });
  const choice: ResearchAdvanceChoice = { track: action.track };
  if (action.flipToken !== undefined) {
    choice.flipToken = action.flipToken;
  }
  if (action.hex !== undefined) {
    choice.lostPlanetHex = action.hex;
  }
  const offers = advanceResearchLevel(state, idx, choice);
  state.pending = offers.length > 0 ? { kind: 'charge', queue: offers } : null;
}
