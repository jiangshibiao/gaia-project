/**
 * 房间管理器（内存态大厅）。WS 层在其上挂 GameSession 与持久化。
 *
 * 裁决：任意座位成员可开始（不限建房者）；startGame 条件为"真人数 >= 1 且
 * （满员 或 真人 + aiSeats.length >= playerCount）"。随机性一律用 node:crypto——
 * server 不受引擎种子约束；engine 种子在 startGame 时落地（config.seed 未给则
 * crypto 随机生成并保存，重放/复盘需要确定性种子）。
 *
 * 盖亚特有：
 * - lostFleet（默认 true）决定是否从 18 族（含 LF 4 族）抽种族，否则基础 14 族；
 * - factionMode（默认 'random'）：random 时 startGame 按 seed 随机分配种族（抽
 *   playerCount 个不重复）；friendly/auction 时 startGame 进入 draft 阶段
 *   （lobby → draft → playing，纯逻辑见 draft.ts），draft 全员就绪后 confirmDraft
 *   把 factions + startingVp（auction = 10 − 出价）落地——factions 不进 RoomConfig，
 *   落地在 room.factions，由 WS 层组装 engine GameConfig；
 * - AI 座位配置为数组（每席位各自难度/可选插件 spec），startGame 按座位序填充
 *   空位，填充数 = min(aiSeats.length, playerCount - 真人数)（clamp）。
 * AI 座位的 token 是伪造的 crypto token——只为满足 GameSession 构造/落库，
 * **永不进 tokenIndex、永不下发**（resume/submit 均不可达）。
 */
import { randomBytes } from 'node:crypto';
import { createRng } from '@gaia/engine';
import type { FactionId, GameState, PlayerIndex } from '@gaia/engine';
import type { AIDifficulty, AISeatConfig, DraftState, RoomConfig, RoomState } from '@gaia/protocol';
import { resolveAgentPlugin } from '@gaia/llm';
import { DraftError, applyDraftBid, applyDraftPick, buildDraftPreview, createDraft, draftFactionPool, draftResult, drawTurnOrder } from './draft.js';

export type RoomErrorCode =
  | 'room-full'
  | 'room-not-found'
  | 'already-started'
  | 'not-in-room'
  | 'room-not-full'
  | 'invalid-nickname'
  | 'invalid-config'
  | 'code-exhausted';

/** 与 engine 的 IllegalActionError 同模式：code 机器可读，供 WS 层映射 error 消息。 */
export class RoomError extends Error {
  readonly code: RoomErrorCode;

  constructor(code: RoomErrorCode, message: string) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}

/** 内部座位：含 token，绝不直接广播（广播用 toRoomState）。AI 座位的 token 是伪造的。 */
export interface Seat {
  seat: PlayerIndex;
  nickname: string;
  token: string;
  connected: boolean;
  isAI: boolean;
}

export interface Room {
  readonly code: string;
  readonly config: RoomConfig;
  readonly seats: (Seat | null)[];
  started: boolean;
  /** engine 种子，startGame 时落地；开始前为 null。 */
  seed: number | null;
  /** 每座位种族，startGame 时按 seed 随机分配（random）或 draft 结果落地；开始前为 null。 */
  factions: FactionId[] | null;
  /** 每座位起始 VP（auction = 10 − 出价）；非 draft 开局为 null（引擎缺省全 10）。 */
  startingVp: number[] | null;
  /** 初始行动顺序（按 seed 洗牌，规则书先手任意方式定）；startGame 时落地，开始前为 null。 */
  turnOrder: PlayerIndex[] | null;
  /** draft（种族选取）阶段状态；friendly/auction 模式 startGame 后非 null，确认开局后归 null。 */
  draft: DraftState | null;
  /** draft 阶段的开局预览局面（板块/地图与真实开局一致；仅内存展示，不进库）。 */
  preview: GameState | null;
  /** client 供 seed 时 true——公开标记，大厅可展示"房主指定了种子"（防作弊通道透明化）。 */
  readonly customSeed: boolean;
}

export interface JoinResult {
  room: Room;
  seat: PlayerIndex;
  token: string;
}

/** 房间号字符集：大写字母数字去掉混淆字符 0O1IL（31 个）。 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const MAX_CODE_RETRIES = 100;
const NICKNAME_MAX = 16;

/**
 * 按 seed 抽取 playerCount 个不重复种族。用派生种子（异或黄金比例常数）与引擎
 * 本体的 rng 流去相关——种族分配与地图/板块生成互不锁定。同 seed 结果确定。
 */
export function drawFactions(seed: number, playerCount: number, lostFleet: boolean): FactionId[] {
  const pool = draftFactionPool(lostFleet);
  const rng = createRng((seed ^ 0x9e3779b9) >>> 0);
  return rng.shuffle([...pool]).slice(0, playerCount);
}

/** 广播安全视图：剥掉 token 与 config.seed（防泄露种子），只留协议 RoomState 字段。 */
export function toRoomState(room: Room): RoomState {
  return {
    code: room.code,
    // config 显式重建：含 lostFleet/aiSeats/factionMode（大厅展示），绝不含 seed 值
    config: {
      playerCount: room.config.playerCount,
      lostFleet: room.config.lostFleet ?? true,
      factionMode: room.config.factionMode ?? 'random',
      ...(room.config.aiSeats !== undefined
        ? { aiSeats: room.config.aiSeats.map((a) => ({ ...a })) }
        : {}),
    },
    customSeed: room.customSeed,
    seats: room.seats.map((s) =>
      s === null ? null : { seat: s.seat, nickname: s.nickname, isAI: s.isAI, connected: s.connected },
    ),
    started: room.started,
    drafting: room.draft !== null,
  };
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly tokenIndex = new Map<string, Room>();

  createRoom(config: RoomConfig, nickname: string): JoinResult {
    const name = validateNickname(nickname);
    if (config.playerCount !== 2 && config.playerCount !== 3 && config.playerCount !== 4) {
      throw new RoomError('invalid-config', `playerCount 须为 2/3/4，收到 ${config.playerCount}`);
    }
    if (config.lostFleet !== undefined && typeof config.lostFleet !== 'boolean') {
      throw new RoomError('invalid-config', `lostFleet 须为 boolean，收到 ${String(config.lostFleet)}`);
    }
    if (
      config.factionMode !== undefined &&
      config.factionMode !== 'friendly' &&
      config.factionMode !== 'random' &&
      config.factionMode !== 'auction'
    ) {
      throw new RoomError('invalid-config', `factionMode 须为 friendly/random/auction，收到 ${String(config.factionMode)}`);
    }
    if (config.aiSeats !== undefined) {
      validateAISeats(config.aiSeats, config.playerCount);
    }
    const code = this.generateCode();
    const token = generateToken();
    // 浅拷贝 config（aiSeats 数组同样换壳），防调用方后续 mutate 影响房间
    const configCopy: RoomConfig = {
      ...config,
      ...(config.aiSeats !== undefined ? { aiSeats: config.aiSeats.map((a) => ({ ...a })) } : {}),
    };
    const seats: (Seat | null)[] = Array.from({ length: config.playerCount }, () => null);
    seats[0] = { seat: 0, nickname: name, token, connected: true, isAI: false };
    const room: Room = {
      code,
      config: configCopy,
      seats,
      started: false,
      seed: null,
      factions: null,
      startingVp: null,
      turnOrder: null,
      draft: null,
      preview: null,
      customSeed: configCopy.seed !== undefined,
    };
    this.rooms.set(code, room);
    this.tokenIndex.set(token, room);
    return { room, seat: 0, token };
  }

  joinRoom(code: string, nickname: string): JoinResult {
    const name = validateNickname(nickname);
    const room = this.rooms.get(code.toUpperCase());
    if (room === undefined) {
      throw new RoomError('room-not-found', `房间不存在: ${code}`);
    }
    if (room.started) {
      throw new RoomError('already-started', `房间 ${room.code} 已开始，拒绝加入`);
    }
    const seat = room.seats.indexOf(null);
    if (seat === -1) {
      throw new RoomError('room-full', `房间 ${room.code} 已满员`);
    }
    const token = generateToken();
    room.seats[seat] = { seat, nickname: name, token, connected: true, isAI: false };
    this.tokenIndex.set(token, room);
    return { room, seat, token };
  }

  /**
   * 开局校验 + AI 填充 + 种子/种族落地；返回房间（GameSession 由 WS 层建）。
   *
   * 条件：真人数 >= 1 且（满员 或 真人 + aiSeats.length >= playerCount）。
   * AI 填充数 = min(aiSeats.length, playerCount - 真人数)（满员真人房填 0 个），
   * 第 n 个 AI 座位（按座位序）取 aiSeats[n-1] 的难度/spec。AI 座位 token 为伪造
   * crypto token：满足 GameSession 构造/落库，但**不进 tokenIndex、永不下发**
   * （resume/submit 不可达）。connected 恒 true（AI 无连接概念）。
   */
  startGame(token: string): Room {
    const room = this.tokenIndex.get(token);
    if (room === undefined) {
      throw new RoomError('not-in-room', 'token 不属于任何房间座位');
    }
    if (room.started) {
      throw new RoomError('already-started', `房间 ${room.code} 已开始`);
    }
    if (room.draft !== null) {
      throw new RoomError('already-started', `房间 ${room.code} 已在选族阶段，等待 draft_confirm`);
    }
    const humanCount = room.seats.filter((s) => s !== null).length;
    const aiSeats = room.config.aiSeats ?? [];
    const full = !room.seats.includes(null);
    if (humanCount < 1 || (!full && humanCount + aiSeats.length < room.config.playerCount)) {
      throw new RoomError(
        'room-not-full',
        `房间 ${room.code} 人数不足：真人 ${humanCount} + AI ${aiSeats.length} < ${room.config.playerCount}`,
      );
    }
    const fill = Math.min(aiSeats.length, room.config.playerCount - humanCount);
    if (fill > 0) {
      let n = 0;
      for (let i = 0; i < room.seats.length && n < fill; i++) {
        if (room.seats[i] !== null) continue;
        const cfg: AISeatConfig = aiSeats[n]!;
        n += 1;
        room.seats[i] = {
          seat: i as PlayerIndex,
          // 指定了插件 spec 时昵称带插件短名（否则沿用难度标签）。
          nickname: `AI-${n}（${cfg.spec?.replace(/^builtin:/, '') ?? DIFFICULTY_LABEL[cfg.difficulty]}）`,
          token: generateToken(), // 伪造 token：不进 tokenIndex
          connected: true,
          isAI: true,
        };
      }
    }
    room.seed = room.config.seed ?? randomSeed();
    const factionMode = room.config.factionMode ?? 'random';
    if (factionMode !== 'random') {
      // friendly/auction：先落地 seed 并进入 draft 阶段；factions/startingVp 待
      // draft 全员就绪后由 confirmDraft 按结果落地（见 draft.ts）。
      // draft 顺位即对局行动顺序（同一洗牌）；preview 与真实开局一致。
      room.draft = createDraft(factionMode, room.config.playerCount, room.config.lostFleet ?? true, room.seed);
      room.turnOrder = room.draft.turnOrder;
      room.preview = buildDraftPreview(room.seed, room.config.playerCount, room.config.lostFleet ?? true);
      return room;
    }
    room.turnOrder = drawTurnOrder(room.seed, room.config.playerCount);
    room.started = true;
    room.factions = drawFactions(room.seed, room.config.playerCount, room.config.lostFleet ?? true);
    return room;
  }

  /** token → {room, seat} 并要求房间处于 draft 阶段（draft_* 消息公共前置）。 */
  private requireDraft(token: string): { room: Room; seat: Seat } {
    const found = this.findByToken(token);
    if (found === null) {
      throw new RoomError('not-in-room', 'token 不属于任何房间座位');
    }
    if (found.room.draft === null) {
      throw new DraftError('not-in-draft', `房间 ${found.room.code} 不在选族阶段`);
    }
    return found;
  }

  /** draft 行动：选一个无人持有的族（friendly 锁定 / auction 出价 0 持有）。 */
  draftPick(token: string, faction: FactionId): Room {
    const { room, seat } = this.requireDraft(token);
    applyDraftPick(room.draft!, draftFactionPool(room.config.lostFleet ?? true), seat.seat, faction);
    return room;
  }

  /** draft 行动（仅 auction）：对已被持有的族出更高价，原持有者回到未分配。 */
  draftBid(token: string, faction: FactionId, bid: number): Room {
    const { room, seat } = this.requireDraft(token);
    applyDraftBid(room.draft!, draftFactionPool(room.config.lostFleet ?? true), seat.seat, faction, bid);
    return room;
  }

  /**
   * draft 全员就绪后确认开局：factions/startingVp 按 draft 结果落地，房间进入
   * 已开局态（GameSession 由 WS 层建）。与 start_game 一致，任意真人座位可确认。
   */
  confirmDraft(token: string): Room {
    const { room } = this.requireDraft(token);
    const { factions, startingVp } = draftResult(room.draft!);
    room.factions = factions;
    room.startingVp = startingVp;
    room.draft = null;
    room.preview = null;
    room.started = true;
    return room;
  }

  /** 中止 draft（真人中途离开房间）：回到大厅态（AI 填充座位保留，可重新 start）。 */
  abortDraft(room: Room): void {
    room.draft = null;
    room.preview = null;
  }

  getRoom(code: string): Room | null {
    return this.rooms.get(code.toUpperCase()) ?? null;
  }

  /** 处于 draft 阶段的房间（心跳兜底重触发 AI 驱动用）。 */
  draftingRooms(): Room[] {
    return [...this.rooms.values()].filter((r) => r.draft !== null);
  }

  /**
   * 收留一个重建的房间（session restore：重启后内存房间丢失，按库记录重建
   * Room 后注册回索引，leave/broadcast 等按码查房的路径才不断裂）。
   * 不登记 tokenIndex——恢复的对局只能经库表 findSeatByToken resume。
   */
  adopt(room: Room): void {
    this.rooms.set(room.code, room);
  }

  /** token → {room, seat}。开局前 resume 走此内存索引；开局后由 WS 层查库 findSeatByToken。 */
  findByToken(token: string): { room: Room; seat: Seat } | null {
    const room = this.tokenIndex.get(token);
    if (room === undefined) return null;
    const seat = room.seats.find((s): s is Seat => s !== null && s.token === token);
    if (seat === undefined) return null;
    return { room, seat };
  }

  /** 主动离开：从 token 索引移除（该 token 不再能 resume/create 相关操作）。 */
  dropToken(token: string): void {
    this.tokenIndex.delete(token);
  }

  private generateCode(): string {
    for (let attempt = 0; attempt < MAX_CODE_RETRIES; attempt++) {
      let code = '';
      const bytes = randomBytes(CODE_LENGTH);
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError('code-exhausted', '房间号分配失败（重试耗尽）');
  }
}

/** 24 字符 base64url（18 字节随机）。 */
function generateToken(): string {
  return randomBytes(18).toString('base64url');
}

const DIFFICULTY_LABEL: Record<AIDifficulty, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
};

const AI_DIFFICULTIES: ReadonlySet<string> = new Set(['easy', 'normal', 'hard']);

function validateAISeats(aiSeats: AISeatConfig[], playerCount: number): void {
  if (!Array.isArray(aiSeats) || aiSeats.length > playerCount - 1) {
    throw new RoomError(
      'invalid-config',
      `aiSeats 长度须为 0..${playerCount - 1}，收到 ${Array.isArray(aiSeats) ? aiSeats.length : '非数组'}`,
    );
  }
  for (const seat of aiSeats) {
    if (typeof seat !== 'object' || seat === null || !AI_DIFFICULTIES.has(seat.difficulty)) {
      throw new RoomError(
        'invalid-config',
        `aiSeats[].difficulty 须为 easy/normal/hard，收到 ${String(seat?.difficulty)}`,
      );
    }
    if (seat.spec !== undefined) {
      try {
        resolveAgentPlugin(seat.spec);
      } catch {
        throw new RoomError('invalid-config', `未知 AI 插件 spec：${String(seat.spec)}`);
      }
    }
  }
}

function randomSeed(): number {
  return randomBytes(4).readUInt32LE(0);
}

function validateNickname(nickname: string): string {
  const name = nickname.trim();
  if (name.length < 1 || name.length > NICKNAME_MAX) {
    throw new RoomError('invalid-nickname', `昵称长度须为 1-${NICKNAME_MAX} 字符`);
  }
  return name;
}
