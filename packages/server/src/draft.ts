/**
 * 种族选取（draft）阶段纯逻辑（friendly / auction 两种模式；random 不进 draft）。
 *
 * 状态即协议 DraftState（广播安全，房间内存持有，不进库）。
 * 行动规则：
 * - friendly：当前行动者 draftPick 锁定一个无人持有的族，自动推进下一位；全员锁定即结束。
 * - auction（gaia-project.io BidWhileChoosing，参照 reference/gaia-project engine）：
 *   - draftPick：选一个**无人持有**的族，出价 0 持有之；
 *   - draftBid：对一个**已被持有**的族出更高价（整数、> 当前价、≤ 当前价+9——参考引擎
 *     range(bid+1, bid+10)），原持有者回到未分配状态；
 *   - 每次行动后，下一行动者 = 从当前行动者下一位起按座位序（环绕）找到的第一个
 *     未持有者（与参考引擎 moveToNextPlayerWithoutAChosenFaction 一致）；全员持有即结束。
 * - 开局结果：factions = 各座位持有族；startingVp = 10 − 各自出价。
 *
 * 校验全部先于状态变更（失败抛 DraftError，不留半变更状态）。
 */
import { createRng, FACTIONS, newGame } from '@gaia/engine';
import type { FactionId, GameState, PlayerIndex } from '@gaia/engine';
import type { DraftState, FactionMode } from '@gaia/protocol';

export type DraftMode = Exclude<FactionMode, 'random'>;

export type DraftErrorCode =
  | 'not-in-draft'
  | 'not-your-turn'
  | 'invalid-faction'
  | 'invalid-bid'
  | 'draft-not-finished';

/** 与 RoomError 同模式：code 机器可读，供 WS 层映射 error 消息。 */
export class DraftError extends Error {
  readonly code: DraftErrorCode;

  constructor(code: DraftErrorCode, message: string) {
    super(message);
    this.name = 'DraftError';
    this.code = code;
  }
}

/** 规则书设定：起始 VP 10 分；auction 出价从其中扣减。 */
const BASE_STARTING_VP = 10;
/** 单次出价相对当前价的最大加价幅度（参考引擎 range(bid+1, bid+10) → 当前价+1..+9）。 */
const MAX_BID_RAISE = 9;

/** Lost Fleet 4 个新种族（与 rooms.ts 的抽族池同源）。 */
const LF_FACTION_IDS: ReadonlySet<string> = new Set<FactionId>([
  'tinkeroids',
  'darkanians',
  'moweyds',
  'space-giants',
]);

const ALL_FACTION_IDS = Object.keys(FACTIONS) as FactionId[];

/**
 * Lost Fleet 探索板正反面配对（9 块双面板，规则书 p16）：
 * 同一局不允许两名玩家使用同一块探索板的正反面（共享同一块板）。
 */
const EXPLORATION_PAIRS: readonly (readonly [FactionId, FactionId])[] = [
  ['nevlas', 'itars'],
  ['lantids', 'terrans'],
  ['taklons', 'ambas'],
  ['xenos', 'gleens'],
  ['bescods', 'firaks'],
  ['space-giants', 'moweyds'],
  ['baltaks', 'geodens'],
  ['ivits', 'hadsch-hallas'],
  ['tinkeroids', 'darkanians'],
];

/** 返回与 faction 同一块探索板的另一族；不在配对表中时返回 null。 */
export function pairedFaction(faction: FactionId): FactionId | null {
  for (const [a, b] of EXPLORATION_PAIRS) {
    if (a === faction) return b;
    if (b === faction) return a;
  }
  return null;
}

/** draft 可选种族全集：lostFleet 18 族，否则基础 14 族。 */
export function draftFactionPool(lostFleet: boolean): FactionId[] {
  return lostFleet ? ALL_FACTION_IDS : ALL_FACTION_IDS.filter((f) => !LF_FACTION_IDS.has(f));
}

/** 创建 draft 初始状态：全员未持有，按种子洗牌的顺位先行动（规则书先手由任意方式定）。 */
export function createDraft(mode: DraftMode, playerCount: number, lostFleet: boolean, seed: number): DraftState {
  const picks: Record<PlayerIndex, { faction: FactionId; bid: number } | null> = {};
  for (let i = 0; i < playerCount; i++) picks[i] = null;
  const turnOrder = drawTurnOrder(seed, playerCount);
  return {
    mode,
    turnOrder,
    currentActor: turnOrder[0]!,
    picks,
    available: draftFactionPool(lostFleet),
    finished: false,
  };
}

/** 按种子洗牌行动顺序（派生种子与抽族流去相关；同 seed 结果确定）。 */
export function drawTurnOrder(seed: number, playerCount: number): PlayerIndex[] {
  const rng = createRng((seed ^ 0x85ebca6b) >>> 0);
  return rng.shuffle(Array.from({ length: playerCount }, (_, i) => i as PlayerIndex));
}

/**
 * draft 阶段的开局预览局面：板块/地图生成只依赖 playerCount+seed+lostFleet
 * （引擎 newGame 的 rng 消耗顺序为 板块 → 地图 → 种族相关抽取，前两项与种族无关），
 * 故占位种族重建的局面与 confirm 后真实开局逐格一致。仅内存展示用，不进库。
 */
export function buildDraftPreview(seed: number, playerCount: number, lostFleet: boolean): GameState {
  const factions = draftFactionPool(lostFleet).slice(0, playerCount);
  return newGame({ playerCount, seed, factions, lostFleet });
}

/** 持有某族的玩家座位（无人持有时 null）。 */
function holderOf(state: DraftState, faction: FactionId): PlayerIndex | null {
  for (const seat of state.turnOrder) {
    if (state.picks[seat]?.faction === faction) return seat;
  }
  return null;
}

/** 重算 available（pool − 已被持有）；每次行动后调用。 */
function refreshAvailable(state: DraftState, pool: readonly FactionId[]): void {
  const held = new Set(
    state.turnOrder.map((seat) => state.picks[seat]?.faction).filter((f) => f !== undefined),
  );
  state.available = pool.filter((f) => !held.has(f));
}

/**
 * 行动后推进：下一行动者 = 从刚行动者下一位起按座位序（环绕）找到的第一个未持有者；
 * 全员持有 → finished，currentActor 置 null。
 */
function advance(state: DraftState, pool: readonly FactionId[]): void {
  refreshAvailable(state, pool);
  const n = state.turnOrder.length;
  const from = state.currentActor ?? 0;
  for (let step = 1; step < n; step++) {
    const seat = state.turnOrder[(from + step) % n]!;
    if (state.picks[seat] === null) {
      state.currentActor = seat;
      return;
    }
  }
  state.currentActor = null;
  state.finished = true;
}

function assertActor(state: DraftState, seat: PlayerIndex): void {
  if (state.finished) {
    throw new DraftError('draft-not-finished', '选族已结束，等待确认开局');
  }
  if (state.currentActor !== seat) {
    throw new DraftError(
      'not-your-turn',
      `还没轮到你选族（当前行动者：座位 ${String(state.currentActor)}）`,
    );
  }
}

/**
 * 选一个无人持有的族（friendly 锁定 / auction 出价 0 持有）。
 * pool 需为创建时的全集（调用方从 room.config.lostFleet 推导，避免状态中冗余存储）。
 */
export function applyDraftPick(
  state: DraftState,
  pool: readonly FactionId[],
  seat: PlayerIndex,
  faction: FactionId,
): void {
  assertActor(state, seat);
  if (!pool.includes(faction)) {
    throw new DraftError('invalid-faction', `未知种族: ${faction}`);
  }
  const holder = holderOf(state, faction);
  if (holder !== null) {
    throw new DraftError(
      'invalid-faction',
      state.mode === 'auction'
        ? `${faction} 已被座位 ${holder} 持有——竞价模式请用 draft_bid 出更高价`
        : `${faction} 已被座位 ${holder} 选取`,
    );
  }
  // 探索板正反面冲突：同一块探索板的另一族已被持有，不能共享同一块板。
  const pair = pairedFaction(faction);
  if (pair !== null) {
    const pairHolder = holderOf(state, pair);
    if (pairHolder !== null) {
      throw new DraftError(
        'invalid-faction',
        `${faction} 与 ${pair} 共用同一块探索板（正反面）——已被座位 ${pairHolder} 占用，不能共享`,
      );
    }
  }
  state.picks[seat] = { faction, bid: 0 };
  advance(state, pool);
}

/**
 * 对一个已被持有的族出更高价（仅 auction）：原持有者回到未分配。
 * 校验：整数、严格大于当前价、不超过当前价 +9（参考引擎同区间）。
 */
export function applyDraftBid(
  state: DraftState,
  pool: readonly FactionId[],
  seat: PlayerIndex,
  faction: FactionId,
  bid: number,
): void {
  if (state.mode !== 'auction') {
    throw new DraftError('invalid-bid', '仅竞价模式可以出价');
  }
  assertActor(state, seat);
  if (!pool.includes(faction)) {
    throw new DraftError('invalid-faction', `未知种族: ${faction}`);
  }
  const holder = holderOf(state, faction);
  if (holder === null) {
    throw new DraftError('invalid-faction', `${faction} 无人持有——直接选取即可，无需出价`);
  }
  // 探索板正反面冲突（竞价抢走他人族时同样不能共享同一块板）。
  const pair = pairedFaction(faction);
  if (pair !== null) {
    const pairHolder = holderOf(state, pair);
    if (pairHolder !== null && pairHolder !== holder) {
      throw new DraftError(
        'invalid-faction',
        `${faction} 与 ${pair} 共用同一块探索板（正反面）——已被座位 ${pairHolder} 占用，不能共享`,
      );
    }
  }
  const current = state.picks[holder]!.bid;
  if (!Number.isInteger(bid) || bid < current + 1 || bid > current + MAX_BID_RAISE) {
    throw new DraftError(
      'invalid-bid',
      `出价须为 ${current + 1}..${current + MAX_BID_RAISE} 的整数（当前价 ${current}），收到 ${String(bid)}`,
    );
  }
  state.picks[holder] = null;
  state.picks[seat] = { faction, bid };
  advance(state, pool);
}

/** draft 结果 → engine GameConfig 片段（须 finished；friendly 出价全 0 → 起始 VP 全 10）。 */
export function draftResult(state: DraftState): { factions: FactionId[]; startingVp: number[] } {
  if (!state.finished) {
    throw new DraftError('draft-not-finished', '选族尚未结束，不能开局');
  }
  const factions: FactionId[] = [];
  const startingVp: number[] = [];
  for (const seat of state.turnOrder) {
    const pick = state.picks[seat];
    if (pick === null || pick === undefined) {
      throw new DraftError('draft-not-finished', `座位 ${seat} 尚未持有种族`);
    }
    factions.push(pick.faction);
    startingVp.push(BASE_STARTING_VP - pick.bid);
  }
  return { factions, startingVp };
}
