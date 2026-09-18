/**
 * GameSession——权威对局会话：engine 裁决 + 每步落库 + 按座位视角快照。
 *
 * 职责边界：
 * - 构造即开新局：engine newGame(config) + createGame 落库（games 行 + seats，
 *   roomCode 缺省取 gameId——真实房间码由 WS 层传入）。
 * - submitAction 是状态推进的唯一入口，校验顺序：**game-finished → invalid-seat →
 *   not-your-turn → engine 合法性**。"谁该行动"用 protocol 的 actorOf——盖亚存在
 *   非当前玩家的待决决策（pending 充能/盖亚决策/tinkering/gain-tech-tile/free-mine）
 *   与 setup 阶段（setupQueue），seat !== actorOf(state) 即 not-your-turn。
 * - engine 的 IllegalActionError 包装为 SessionError，原 code 透传（WS 层按 code 映射
 *   error 消息）；其余异常原样抛出（引擎 bug 不应被吞）。
 * - 每步 appendAction 落库（seq 从 0 递增）；append 成功后才替换内存态——落库失败
 *   不留脏状态。终局（phase==='game-over'）finishGame 落 final_state。
 * - snapshotFor(seat)：filterStateFor 剥 rngState；legalActions 仅 actor 座位非空。
 *
 * 随机性：gameId 用 node:crypto（server 不受引擎种子约束）；对局内随机性全部来自
 * engine 种子（可重放）。
 */
import { randomBytes } from 'node:crypto';
import { IllegalActionError, applyAction, enumerateActions, newGame } from '@gaia/engine';
import type { Action, GameConfig, GameState, PlayerIndex } from '@gaia/engine';
import { actorOf, filterStateFor } from '@gaia/protocol';
import type { FilteredState, RoomConfig } from '@gaia/protocol';
import {
  appendAction,
  createGame,
  findGameById,
  finishGame,
  listActions,
  listSeats,
  type Db,
} from './db/repo.js';

/**
 * SessionError.code：'game-finished' / 'invalid-seat' / 'invalid-seats' / 'not-your-turn'
 * / engine IllegalActionError 原 code（如 'illegal-action'）。engine code 集合开放，
 * 故类型为 string——WS 层对未知 code 按透传处理。
 */
export class SessionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'SessionError';
    this.code = code;
  }
}

export interface SessionSeat {
  seat: PlayerIndex;
  nickname: string;
  token: string;
  /** AI 座位标记（落库 seats.is_ai；恢复对局时重建 agents 用）。缺省 false。 */
  isAI?: boolean;
}

export interface Snapshot {
  seq: number;
  state: FilteredState;
  legalActions: Action[];
}

/** 'g_' + 8 字节 base64url（11 字符），crypto 随机。测试里应显式传 gameId。 */
export function generateGameId(): string {
  return `g_${randomBytes(8).toString('base64url')}`;
}

export class GameSession {
  readonly gameId: string;
  private readonly db: Db;
  private readonly seats: ReadonlySet<PlayerIndex>;
  private gameState: GameState;
  private seq = 0;

  constructor(
    db: Db,
    gameId: string | undefined,
    config: GameConfig,
    seats: SessionSeat[],
    roomCode?: string,
    opts?: { persist?: boolean; roomConfig?: RoomConfig },
  ) {
    const expected = new Set(Array.from({ length: config.playerCount }, (_, i) => i as PlayerIndex));
    if (
      seats.length !== config.playerCount ||
      !seats.every((s) => expected.delete(s.seat)) ||
      expected.size !== 0
    ) {
      throw new SessionError(
        'invalid-seats',
        `seats 须恰好覆盖 0..${config.playerCount - 1}，收到 ${JSON.stringify(seats.map((s) => s.seat))}`,
      );
    }
    this.db = db;
    this.gameId = gameId ?? generateGameId();
    this.seats = new Set(seats.map((s) => s.seat));
    this.gameState = newGame(config);
    if (opts?.persist !== false) {
      createGame(db, {
        id: this.gameId,
        roomCode: roomCode ?? this.gameId,
        playerCount: config.playerCount,
        seed: config.seed,
        config: {
          game: config,
          // 大厅配置缺省按对局配置重建（直连 GameSession 的调用方无房间概念）
          room: opts?.roomConfig ?? {
            playerCount: config.playerCount as RoomConfig['playerCount'],
            seed: config.seed,
            lostFleet: config.lostFleet ?? true,
          },
        },
        seats,
      });
    }
  }

  /**
   * 服务器重启后的对局恢复：库中 status='playing'/'finished' 的对局按 actions 表
   * 重放重建（engine 确定性：newGame(config) + 逐条 applyAction，含 setup 阶段行动）。
   * 返回 null = 不可恢复（对局不存在/重放校验失败），WS 层回 'session-lost'。
   * 已终局对局同样恢复（只读查看终局盘面/记录；submitAction 仍被 game-finished 拒）。
   */
  static restore(db: Db, gameId: string): GameSession | null {
    const game = findGameById(db, gameId);
    if (game === null || (game.status !== 'playing' && game.status !== 'finished')) return null;
    const seatRows = listSeats(db, gameId);
    const session = new GameSession(
      db,
      gameId,
      game.config.game,
      seatRows.map((s) => ({
        seat: s.seat as PlayerIndex,
        nickname: s.nickname,
        token: s.token,
        isAI: s.isAI,
      })),
      game.roomCode,
      { persist: false, roomConfig: game.config.room },
    );
    try {
      for (const { player, action } of listActions(db, gameId)) {
        // 数据完整性校验：行动者必须是当时应行动的玩家
        if (player !== actorOf(session.gameState)) return null;
        session.gameState = applyAction(session.gameState, action);
        session.seq += 1;
      }
    } catch {
      return null; // 重放失败（库脏数据/引擎语义漂移）——按不可恢复处理
    }
    return session;
  }

  /** 终局（engine phase==='game-over'，此刻 final_state 已落库）。 */
  get finished(): boolean {
    return this.gameState.phase === 'game-over';
  }

  /** 当前应行动的玩家（actorOf；终局为 null）。 */
  get actor(): PlayerIndex | null {
    return actorOf(this.gameState);
  }

  /**
   * 权威 GameState（只读约定，勿改）。服务端内部用：广播 action_applied 需要
   * lastEvents、game_over 需要 winner 与 players[].vp；web 端一律走 snapshotFor。
   */
  get state(): GameState {
    return this.gameState;
  }

  /** 已落库行动数 = 下一个行动的 seq。 */
  get currentSeq(): number {
    return this.seq;
  }

  /**
   * 提交行动：校验 → engine applyAction 推进 → appendAction 落库（seq 递增）→
   * 终局则 finishGame 落 final_state。返回所落行动的 seq。
   */
  submitAction(seat: PlayerIndex, action: Action): { seq: number } {
    if (this.finished) {
      throw new SessionError('game-finished', `对局 ${this.gameId} 已结束，拒绝行动`);
    }
    this.assertSeat(seat);
    const actor = actorOf(this.gameState);
    if (actor === null || seat !== actor) {
      throw new SessionError(
        'not-your-turn',
        `座位 ${seat} 非当前应行动玩家（当前为 ${String(actor)}）`,
      );
    }
    let next: GameState;
    try {
      next = applyAction(this.gameState, action);
    } catch (e) {
      if (e instanceof IllegalActionError) {
        throw new SessionError(e.code, e.message);
      }
      throw e;
    }
    appendAction(this.db, this.gameId, this.seq, seat, action);
    this.gameState = next;
    const applied = this.seq;
    this.seq += 1;
    if (this.finished) {
      finishGame(this.db, this.gameId, this.gameState);
    }
    return { seq: applied };
  }

  /** 按座位视角的快照；legalActions 仅当 seat 是当前应行动玩家且对局未结束时非空。 */
  snapshotFor(seat: PlayerIndex): Snapshot {
    this.assertSeat(seat);
    return {
      seq: this.seq,
      state: filterStateFor(this.gameState),
      legalActions:
        !this.finished && seat === actorOf(this.gameState)
          ? enumerateActions(this.gameState, seat)
          : [],
    };
  }

  private assertSeat(seat: PlayerIndex): void {
    if (!this.seats.has(seat)) {
      throw new SessionError('invalid-seat', `座位 ${seat} 不属于对局 ${this.gameId}`);
    }
  }
}
