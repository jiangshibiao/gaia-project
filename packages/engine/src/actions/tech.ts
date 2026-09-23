/**
 * 拿科技板共享流程：升级 lab/学院、qic1、itars 盖亚换板、space-giants PI、
 * fedlf2、ship-tech-tile 等入口共用。
 *
 * 规则（rules-summary §1 科技板 + reference engine.ts ChooseTechTile）：
 * - 标准板：从 board.techTiles 供应拿（不可重复同名，含已被覆盖的）；位置在
 *   board.techTilePositions——轨正下方 6 块拿后只能升该轨，底排 free1-3 升任意轨。
 * - 高级板：槽位 i 对应 TRACKS[i] 轨 L4/L5 + 翻 1 枚绿面联邦标记 + 覆盖自己
 *   一块未被覆盖的标准板（被覆盖板失效：收入/触发/被动/特殊格全部失效）；
 *   拿后可升任意轨（参照 reference：adv 位置不锁定升轨）。
 * - 拿板后选择推进 1 级研究（可放弃）；升 L5 规则同 research 行动（翻标记、
 *   每轨限 1 人、nav L5 放 Lost Planet）。高级板路径允许拿板翻面+升 L5 翻面
 *   双翻面（researchFlipToken 载荷；翻面池按枚扣减拿板用掉的那枚）。
 */
import { IllegalActionError } from '../errors.js';
import type {
  AdvTechTileId,
  ChargeOffer,
  FederationTokenId,
  FreeMineOptions,
  GameState,
  PlayerIndex,
  ResearchTrack,
  ShipId,
  TechTileId,
  TechTilePosition,
} from '../types.js';
import { ADV_TECH_TILES, TECH_TILES, type TechEffect } from '../data/techs.js';
import { FEDERATION_TOKENS } from '../data/federations.js';
import type { ResourceGain } from '../data/rewards.js';
import { applyGain, player } from '../state.js';
import { countUnits } from '../score.js';
import {
  advanceResearchLevel,
  flippableTokenIds,
  legalResearchAdvances,
  type ResearchAdvanceChoice,
} from './research.js';

const TRACKS: readonly ResearchTrack[] = ['terra', 'nav', 'int', 'gaia', 'eco', 'sci'];
const TRACK_SET: ReadonlySet<string> = new Set(TRACKS);

/** 计分板扩展条第 7 槽（LF；index 6）的条件。 */
export function advExtensionConditionMet(state: GameState, idx: PlayerIndex): boolean {
  const p = state.players[idx]!;
  // 条件按 setup 抽取的扩展条面（§E6）：'ships' = 已探索 3 艘不同飞船；'vp' = ≥25vp。
  return state.board.scoringExtension === 'ships' ? p.exploredShips.length >= 3 : p.vp >= 25;
}

/** 一次拿板选择（标准板或高级板 + 研究推进）。 */
export interface TechTileChoice {
  techTile?: TechTileId;
  advTechTile?: AdvTechTileId;
  /** 高级板必覆盖：自己一块未被覆盖的标准板。 */
  coverTechTile?: TechTileId;
  /** 高级板必翻的绿面联邦标记。 */
  flipToken?: FederationTokenId;
  /** 拿板后的研究推进；null=不推进。 */
  research: ResearchAdvanceChoice | null;
  /** 从该飞船拿标准板（LF：有穿梭机的船；拿后升任意轨 1 级）。 */
  ship?: ShipId;
}

/** 标准板所在位置。 */
export function techTilePositionOf(state: GameState, id: TechTileId): TechTilePosition {
  for (const [pos, tile] of Object.entries(state.board.techTilePositions)) {
    if (tile === id) {
      return pos as TechTilePosition;
    }
  }
  throw new IllegalActionError('no-such-tech-tile', `科技板不在研究板上: ${id}`);
}

/** 高级板槽位对应的研究轨。 */
export function advSlotTrack(slot: number): ResearchTrack {
  return TRACKS[slot]!;
}

/** 玩家已被高级板覆盖的标准板。 */
function coveredTiles(state: GameState, idx: PlayerIndex): Set<TechTileId> {
  return new Set(state.players[idx]!.advTechTiles.map((a) => a.covers));
}

/** 高级板槽位是否可拿（槽 0–5：对应轨 L4/L5；槽 6 = LF 扩展条：扩展条件）。 */
export function advSlotAvailable(state: GameState, idx: PlayerIndex, slot: number): boolean {
  if (slot >= 6) {
    return advExtensionConditionMet(state, idx);
  }
  return state.players[idx]!.research[advSlotTrack(slot)] >= 4;
}

/**
 * 枚举拿板选择。opts.allowLevel5=false 时研究推进不枚举 L5
 * （itars 盖亚换板等不便携带翻面/Lost Planet 负载的入口）。
 * opts.fromShips=true 时追加已探索飞船上的标准板（拿后升任意轨 1 级）。
 */
export function enumerateTechTileChoices(
  state: GameState,
  idx: PlayerIndex,
  opts?: { allowLevel5?: boolean; fromShips?: boolean },
): TechTileChoice[] {
  const p = state.players[idx]!;
  const out: TechTileChoice[] = [];

  // 标准板：供应有剩 + 自己未持有（含已被覆盖的同名板）。
  for (const id of Object.keys(state.board.techTiles) as TechTileId[]) {
    if ((state.board.techTiles[id] ?? 0) <= 0 || p.techTiles.includes(id)) {
      continue;
    }
    const pos = techTilePositionOf(state, id);
    const tracks: readonly ResearchTrack[] = TRACK_SET.has(pos) ? [pos as ResearchTrack] : TRACKS;
    out.push({ techTile: id, research: null });
    for (const research of legalResearchAdvances(state, idx, tracks, opts)) {
      out.push({ techTile: id, research });
    }
  }

  // 船上标准板（LF）：有穿梭机的船上的板；拿后升任意轨 1 级。
  if (opts?.fromShips === true) {
    for (const ship of state.board.ships) {
      if (!p.shuttles.some((s) => s.ship === ship.id) || ship.techTileClaims.includes(idx)) {
        continue;
      }
      for (const tile of ship.techTiles) {
        if (p.techTiles.includes(tile)) {
          continue;
        }
        out.push({ techTile: tile, ship: ship.id, research: null });
        for (const research of legalResearchAdvances(state, idx, TRACKS, opts)) {
          out.push({ techTile: tile, ship: ship.id, research });
        }
      }
    }
  }

  // 高级板：槽位条件 + 有可翻标记 + 有可覆盖标准板。
  const covered = coveredTiles(state, idx);
  const coverable = p.techTiles.filter((t) => !covered.has(t));
  const flips = flippableTokenIds(p);
  // 未翻绿面标记按枚计（flippableTokenIds 去重，同款两枚时拿板耗一枚后仍剩一枚）。
  const unflipped = p.federationTokens
    .filter((t) => !t.flipped && FEDERATION_TOKENS[t.id].flippable)
    .map((t) => t.id);
  state.board.advTechTiles.forEach((tile, slot) => {
    if (tile === null || !advSlotAvailable(state, idx, slot)) {
      return;
    }
    for (const coverTechTile of coverable) {
      for (const flipToken of flips) {
        out.push({ advTechTile: tile, coverTechTile, flipToken, research: null });
        // 升轨翻面池 = 全部绿面标记减去拿板用掉的那一枚（拿板+L5 双翻面场景
        // 存在，L5 推进必须照常枚举，不能简化掉）。
        const remaining = [...new Set(unflipped.filter((id, i) => !(id === flipToken && unflipped.indexOf(id) === i)))];
        const advances = legalResearchAdvances(state, idx, TRACKS, { flipTokens: remaining });
        for (const research of advances) {
          out.push({ advTechTile: tile, coverTechTile, flipToken, research });
        }
      }
    }
  });
  return out;
}

/**
 * 一次性科技板效果结算（仅 kind='once'：固定奖励 + 每单位计数奖励）。
 * income/trigger/pass/special 的 gain 不是立即效果（收入每轮结算、trigger 按需触发、
 * pass 在 pass 时结算、special 是行动格），拿板时不得结算。
 * techlf1 的免费建矿不直接结算，作为 freeMine 返回给调用方转成 pending。
 */
function applyOnceEffect(
  state: GameState,
  idx: PlayerIndex,
  eff: TechEffect,
): FreeMineOptions | null {
  if (eff.kind === 'once') {
    if (eff.gain !== undefined) {
      applyGain(state, idx, eff.gain);
    }
    if (eff.per !== undefined && eff.perGain !== undefined) {
      const n = countUnits(state, idx, eff.per);
      const gain: ResourceGain = {};
      for (const k of ['ore', 'credits', 'knowledge', 'qic', 'vp', 'chargePower', 'powerToken', 'gaiaformer'] as const) {
        const v = eff.perGain[k];
        if (v !== undefined && v !== 0) {
          gain[k] = v * n;
        }
      }
      applyGain(state, idx, gain);
    }
  }
  // techlf1：一次性免费建矿（最多 2 免费步、免矿费；可补 ore 第 3 步、qic 加程）。
  if (eff.freeMine !== undefined) {
    return { freeTerraformSteps: eff.freeMine.freeTerraformSteps, waiveMineCost: true };
  }
  return null;
}

/** 拿板选择的结算结果。 */
export interface TechTileChoiceResult {
  /** 研究推进产生的充能邀约（nav L5 Lost Planet）。 */
  offers: ChargeOffer[];
  /** 板带来的一次性免费建矿（techlf1），调用方转成 pending free-mine。 */
  freeMine: FreeMineOptions | null;
}

/**
 * 效果结算后的 pending 收口（各主行动共用）：
 * 免费建矿（techlf1/fedlf3/fedlf4）> 拿科技板（fedlf2/space-giants PI）>
 * 充能邀约 > null。thenCharge 记录决策后再响应的邀约。
 */
export function settlePendingAfter(
  state: GameState,
  idx: PlayerIndex,
  offers: ChargeOffer[],
  effect?: { freeMine?: FreeMineOptions | null; gainTechTileFromShips?: boolean },
): void {
  if (effect?.freeMine != null) {
    state.pending = { kind: 'free-mine', player: idx, opts: effect.freeMine, thenCharge: offers };
    return;
  }
  if (effect?.gainTechTileFromShips !== undefined) {
    state.pending = { kind: 'gain-tech-tile', player: idx, fromShips: effect.gainTechTileFromShips, thenCharge: offers };
    return;
  }
  state.pending = offers.length > 0 ? { kind: 'charge', queue: offers } : null;
}

/**
 * 应用拿板选择（原地修改）。校验与 enumerateTechTileChoices 一致。
 */
export function applyTechTileChoice(state: GameState, idx: PlayerIndex, choice: TechTileChoice): TechTileChoiceResult {
  const p = player(state, idx);
  let freeMine: FreeMineOptions | null = null;
  if (choice.advTechTile !== undefined) {
    const slot = state.board.advTechTiles.indexOf(choice.advTechTile);
    if (slot < 0) {
      throw new IllegalActionError('adv-tech-unavailable', `高级科技板槽位不可用: ${choice.advTechTile}`);
    }
    if (!advSlotAvailable(state, idx, slot)) {
      throw new IllegalActionError('adv-tech-track-low', `高级板槽位条件未满足: slot ${slot}`);
    }
    const tok = p.federationTokens.find(
      (t) => !t.flipped && t.id === choice.flipToken && FEDERATION_TOKENS[t.id].flippable,
    );
    if (tok === undefined) {
      throw new IllegalActionError('no-flippable-token', `无可翻联邦标记: ${String(choice.flipToken)}`);
    }
    const cover = choice.coverTechTile;
    if (cover === undefined || !p.techTiles.includes(cover) || coveredTiles(state, idx).has(cover)) {
      throw new IllegalActionError('illegal-cover-tile', `不可覆盖的标准板: ${String(cover)}`);
    }
    tok.flipped = true;
    state.board.advTechTiles[slot] = null;
    p.advTechTiles.push({ id: choice.advTechTile, covers: cover });
    p.acquisitions.push({ kind: 'adv', id: choice.advTechTile });
    freeMine = applyOnceEffect(state, idx, ADV_TECH_TILES[choice.advTechTile].effect);
  } else if (choice.techTile !== undefined) {
    const id = choice.techTile;
    if (p.techTiles.includes(id)) {
      throw new IllegalActionError('tech-tile-duplicate', `已持有同名科技板: ${id}`);
    }
    if (choice.ship !== undefined) {
      // 船上标准板：须在该船有穿梭机，且本玩家未拿过该船的板（参考 count 模型：
      // 每人至多 1 块，全员拿过后板从船上移除）。
      const ship = state.board.ships.find((s) => s.id === choice.ship);
      const tileIdx = ship?.techTiles.indexOf(id) ?? -1;
      if (ship === undefined || tileIdx < 0 || !p.shuttles.some((s) => s.ship === ship.id) || ship.techTileClaims.includes(idx)) {
        throw new IllegalActionError('ship-tech-unavailable', `船上科技板不可拿: ${id} @ ${String(choice.ship)}`);
      }
      ship.techTileClaims.push(idx);
      if (ship.techTileClaims.length >= state.config.playerCount) {
        ship.techTiles.splice(tileIdx, 1);
      }
    } else {
      if ((state.board.techTiles[id] ?? 0) <= 0) {
        throw new IllegalActionError('tech-tile-unavailable', `科技板供应已空: ${id}`);
      }
      state.board.techTiles[id] = state.board.techTiles[id]! - 1;
    }
    p.techTiles.push(id);
    p.acquisitions.push({ kind: 'tech', id });
    freeMine = applyOnceEffect(state, idx, TECH_TILES[id].effect);
  } else {
    throw new IllegalActionError('no-tech-tile', '拿板选择为空');
  }
  const offers = choice.research !== null && choice.research !== undefined
    ? advanceResearchLevel(state, idx, choice.research)
    : [];
  return { offers, freeMine };
}
