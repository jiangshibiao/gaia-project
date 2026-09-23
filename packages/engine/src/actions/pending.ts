/**
 * LF 新增待决决策的响应行动：gain-tech-tile（fedlf2/space-giants PI 等）、
 * free-mine（fedlf3/fedlf4/techlf1）、choose-tinkering（Tinkeroids 每轮开始）。
 *
 * 决策结算完后若 thenCharge 非空，转为充能邀约队列（主行动产生的邀约在
 * 该决策之后响应）；队列空则 pending=null，由 apply 层推进回合。
 */
import { IllegalActionError } from '../errors.js';
import type {
  Action,
  AdvTechTileId,
  FederationTokenId,
  GameState,
  PlayerIndex,
  ResearchTrack,
  TechTileId,
  TinkeringTileId,
} from '../types.js';
import type { HexKey } from '../hex.js';
import { TINKERING_TILES, tinkeringGroupForRound } from '../data/lostfleet.js';
import { player } from '../state.js';
import { applyBuildMine, computeMineTarget } from './mine.js';
import { applyTechTileChoice, enumerateTechTileChoices, settlePendingAfter, type TechTileChoice } from './tech.js';

// ---------------------------------------------------------------------------
// choose-tinkering
// ---------------------------------------------------------------------------

/** 本轮可选的 Tinkering tile（当前轮次组 ∩ 剩余池）。 */
export function tinkeringChoices(state: GameState, idx: PlayerIndex): TinkeringTileId[] {
  const p = state.players[idx]!;
  const group = tinkeringGroupForRound(state.round);
  return p.tinkering.pool.filter((t) => TINKERING_TILES[t].rounds === group);
}

/** 枚举 choose-tinkering（pending tinkering 期间）。 */
export function enumerateChooseTinkering(state: GameState, idx: PlayerIndex): Action[] {
  return tinkeringChoices(state, idx).map((tile) => ({ type: 'choose-tinkering', tile }));
}

/** 应用 choose-tinkering（原地修改）：选定本轮 tile 并移出池（每块限用一次）。 */
export function applyChooseTinkering(state: GameState, tile: TinkeringTileId): void {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'tinkering') {
    throw new IllegalActionError('no-pending-tinkering', '当前没有待决的 tinkering 选择');
  }
  const p = player(state, pending.player);
  if (!tinkeringChoices(state, pending.player).includes(tile)) {
    throw new IllegalActionError('illegal-tinkering-tile', `本轮不可选该 Tinkering tile: ${tile}`);
  }
  p.tinkering.pool = p.tinkering.pool.filter((t) => t !== tile);
  p.tinkering.current = tile;
  state.pending = null;
}

// ---------------------------------------------------------------------------
// gain-tech-tile
// ---------------------------------------------------------------------------

/** 枚举 gain-tech-tile 响应（无可拿板时只有放弃选项）。 */
export function enumerateGainTechTile(state: GameState, idx: PlayerIndex): Action[] {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'gain-tech-tile') {
    return [];
  }
  const choices = enumerateTechTileChoices(state, idx, { fromShips: pending.fromShips });
  if (choices.length === 0) {
    return [{ type: 'gain-tech-tile', techTile: null }];
  }
  return choices.map((choice) => {
    const a: Extract<Action, { type: 'gain-tech-tile' }> = {
      type: 'gain-tech-tile',
      techTile: choice.techTile ?? null,
    };
    if (choice.advTechTile !== undefined) {
      a.advTechTile = choice.advTechTile;
    }
    if (choice.coverTechTile !== undefined) {
      a.coverTechTile = choice.coverTechTile;
    }
    if (choice.flipToken !== undefined) {
      a.flipToken = choice.flipToken;
    }
    if (choice.ship !== undefined) {
      a.ship = choice.ship;
    }
    if (choice.research !== null) {
      a.research = choice.research.track;
      // 升 L5 的翻面负载必须随 research 选择携带：标准板路径挂 flipToken，
      // 缺失会让枚举出无 flipToken 的 L5 推进、apply 抛 no-flippable-token
      // （枚举与 apply 必须一致，否则重放即崩）。
      // 高级板路径 L5 翻面是第二枚 → researchFlipToken（flipToken 是拿板翻面）。
      if (choice.research.flipToken !== undefined) {
        if (choice.advTechTile !== undefined) {
          a.researchFlipToken = choice.research.flipToken;
        } else {
          a.flipToken = choice.research.flipToken;
        }
      }
      if (choice.research.lostPlanetHex !== undefined) {
        a.lostPlanetHex = choice.research.lostPlanetHex;
      }
    }
    return a;
  });
}

/** 应用 gain-tech-tile 响应（原地修改）。 */
export function applyGainTechTile(
  state: GameState,
  action: {
    techTile: TechTileId | null;
    advTechTile?: AdvTechTileId;
    coverTechTile?: TechTileId;
    flipToken?: FederationTokenId;
    researchFlipToken?: FederationTokenId;
    research?: ResearchTrack | null;
    lostPlanetHex?: HexKey;
    ship?: import('../types.js').ShipId;
  },
): void {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'gain-tech-tile') {
    throw new IllegalActionError('no-pending-tech-tile', '当前没有待决的拿板决策');
  }
  const idx = pending.player;
  if (action.techTile === null && action.advTechTile === undefined) {
    // 放弃：仅无可拿板时合法。
    if (enumerateTechTileChoices(state, idx, { fromShips: pending.fromShips }).length > 0) {
      throw new IllegalActionError('tech-tile-required', '有可拿科技板时不能放弃');
    }
    state.pending = pending.thenCharge.length > 0 ? { kind: 'charge', queue: pending.thenCharge } : null;
    return;
  }
  const choice: TechTileChoice = { research: null };
  if (action.techTile !== null && action.techTile !== undefined) {
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
    const research: import('./research.js').ResearchAdvanceChoice = { track: action.research };
    // 高级板路径 L5 翻面取 researchFlipToken（flipToken 是拿板翻面）；标准板升 L5 复用 flipToken。
    const rf = action.advTechTile !== undefined ? action.researchFlipToken : action.flipToken;
    if (rf !== undefined) {
      research.flipToken = rf;
    }
    if (action.lostPlanetHex !== undefined) {
      research.lostPlanetHex = action.lostPlanetHex;
    }
    choice.research = research;
  }
  const result = applyTechTileChoice(state, idx, choice);
  const offers = [...result.offers, ...pending.thenCharge];
  settlePendingAfter(state, idx, offers, { freeMine: result.freeMine });
}

// ---------------------------------------------------------------------------
// free-mine
// ---------------------------------------------------------------------------

/** 免费建矿目标（pending free-mine 期间）。 */
export function freeMineTargets(state: GameState, idx: PlayerIndex): HexKey[] {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'free-mine') {
    return [];
  }
  const p = state.players[idx]!;
  const out: HexKey[] = [];
  for (const key of Object.keys(state.map) as HexKey[]) {
    const t = computeMineTarget(state, idx, key, pending.opts);
    if (t !== null && p.resources.ore >= t.ore && p.resources.credits >= t.credits && p.resources.qic >= t.qic) {
      out.push(key);
    }
  }
  return out;
}

/** 枚举 free-mine 响应（无合法目标时只有跳过选项）。 */
export function enumerateFreeMine(state: GameState, idx: PlayerIndex): Action[] {
  const targets = freeMineTargets(state, idx);
  if (targets.length === 0) {
    return [{ type: 'free-mine', hex: null }];
  }
  return targets.map((hex) => ({ type: 'free-mine', hex }));
}

/** 应用 free-mine 响应（原地修改）。 */
export function applyFreeMine(state: GameState, hex: HexKey | null): void {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'free-mine') {
    throw new IllegalActionError('no-pending-free-mine', '当前没有待决的免费建矿');
  }
  const idx = pending.player;
  if (hex === null) {
    if (freeMineTargets(state, idx).length > 0) {
      throw new IllegalActionError('free-mine-required', '有合法目标时不能跳过免费建矿');
    }
    state.pending = pending.thenCharge.length > 0 ? { kind: 'charge', queue: pending.thenCharge } : null;
    return;
  }
  // applyBuildMine 自行设置 pending（建矿产生的充能邀约），随后接上 thenCharge。
  applyBuildMine(state, idx, hex, pending.opts);
  const mineOffers = state.pending?.kind === 'charge' ? state.pending.queue : [];
  const queue = [...mineOffers, ...pending.thenCharge];
  state.pending = queue.length > 0 ? { kind: 'charge', queue } : null;
}
