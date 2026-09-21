/**
 * WebSocket 传输层 + HTTP 静态托管（M2b，server 包收口）。
 *
 * 结构：http.createServer + ws.Server({ noServer })；upgrade 只接受路径 /ws（其余 426）。
 * staticDir 存在时同一 http.Server 托管静态文件（生产单端口：静态 + /ws 共端口；dev 不起
 * staticDir，由 vite proxy 转发 /ws）。
 *
 * 广播安全：room_state 一律走 toRoomState（无 token、config 无 seed 值）；credentials
 * （seat+token）仅 create/join/resume 时单发本人。submit_action 以 token → seat 映射校验
 * 身份（防代打）。resume：开局后查库 findSeatByToken 再对内存 session；进程重启后内存
 * session 丢失时按库（games + actions 表）重放恢复（GameSession.restore），仅已终局或
 * 重放失败才回 'session-lost'；开局前走 RoomManager 内存索引。
 *
 * 心跳：interval（默认 30s）server 发 ws 控制帧 ping；超过 timeout（默认 60s）未收 pong
 * 即 terminate。应用层 'ping' 消息另回 'pong' JSON（协议消息，与控制帧无关）。
 *
 * 断线：座位 connected=false 并广播 room_state；resume 成功 connected=true 再广播。
 * 同座位多连接：允许多地共存（不踢旧连接，各地同步收快照/可各自提交）；
 * 仅当某座位最后一条连接断开才标 connected=false。
 *
 * AI 驱动（driveAI）：options.aiAgentFactory 为注入缝——测试注入 fixture agent，
 * main.ts 用 agentFactoryFromSpec(GAIA_AI_SPEC ?? DEFAULT_SPEC)。driveAI 在
 * startGame/submitAction/resume/心跳后触发（幂等）：同一 session 同时只有一个
 * driveAI（driving 守卫防重入）；循环 actorOf(state) → 若该座位是 AI →
 * enumerateActions → agent.decide → session.submitAction → 广播 action_applied
 * （带 reason/degraded）→ 广播快照；ai_thinking(true/false) 成对广播；**循环体
 * 整体 try/catch**——任何未预期异常 → error 日志 + legal[0] 末级兜底直接
 * submitAction（再失败才放弃，等下次触发），对局永不卡死。
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { PROTOCOL_VERSION, actorOf, filterStateFor } from '@gaia/protocol';
import type { ClientMessage, GameRecord, ServerMessage } from '@gaia/protocol';
import { applyAction, enumerateActions, newGame } from '@gaia/engine';
import type { Action, FactionId, GameConfig, PlayerIndex } from '@gaia/engine';
import { DEFAULT_SPEC, agentFactoryFromSpec, listAgentPlugins, pickFactionByStrength } from '@gaia/llm';
import type { DecidingAgent, Difficulty } from '@gaia/llm';
import { RoomError, RoomManager, toRoomState, type Room, type Seat } from './rooms.js';
import { DraftError, applyDraftPick, draftFactionPool } from './draft.js';
import { GameSession, SessionError, generateGameId, type SessionSeat } from './session.js';
import { findGameById, findSeatByToken, listActions, listSeats, openDb, type Db } from './db/repo.js';

export interface GameServerOptions {
  port: number;
  dbPath: string;
  /** 静态文件根目录（生产单端口托管 web dist）；缺省不托管。 */
  staticDir?: string;
  /** 心跳 ping 间隔，默认 30_000ms。 */
  heartbeatIntervalMs?: number;
  /** 无 pong 断开阈值，默认 60_000ms。 */
  heartbeatTimeoutMs?: number;
  /**
   * AI agent 注入缝：按座位与难度构造决策 agent。缺省用 agentFactoryFromSpec
   * （DEFAULT_SPEC）。每个 AI 座位开局时各构造一个。
   */
  aiAgentFactory?: (seat: PlayerIndex, difficulty: Difficulty) => DecidingAgent;
  /**
   * AI 行动节奏（ms）：每步 AI 行动之间的间隔，让真人玩家看得清 AI 过程。
   * 缺省 0（测试不减速）；生产 main.ts 注入（GAIA_AI_PACE_MS，默认 300）。
   */
  aiPaceMs?: number;
}

export interface GameServer {
  /** 实际监听端口（传 port: 0 时为系统分配值）。 */
  readonly port: number;
  close(): Promise<void>;
}

/** 传输层自产错误码（RoomError/SessionError 之外）：code 机器可读，直接透传给 client。 */
class WsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'WsError';
    this.code = code;
  }
}

interface Conn {
  ws: WebSocket;
  roomCode: string | null;
  seat: PlayerIndex | null;
  lastPongAt: number;
}

/** 进行中对局：session + 所在房间 + token → seat 映射（submit_action 身份校验）。 */
interface SessionEntry {
  session: GameSession;
  room: Room;
  /** 仅真人座位的 token（AI token 永不进任何索引）。 */
  tokenSeats: Map<string, PlayerIndex>;
  /** AI 座位 → 决策 agent（开局时经 aiAgentFactory 各构造一个）。 */
  agents: Map<PlayerIndex, DecidingAgent>;
  /** driveAI 并发守卫：同一 session 同时只有一个驱动循环。 */
  driving: boolean;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export async function createGameServer(options: GameServerOptions): Promise<GameServer> {
  const db: Db = openDb(options.dbPath);
  const rooms = new RoomManager();
  const conns = new Set<Conn>();
  const sessionsByGameId = new Map<string, SessionEntry>();
  const sessionByToken = new Map<string, SessionEntry>();
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? 60_000;
  const aiPaceMs = options.aiPaceMs ?? 0;
  const staticRoot = options.staticDir !== undefined ? resolve(options.staticDir) : null;
  /** 缺省 AI 工厂（注入缝未给时）：服务器默认插件。 */
  const defaultFactory = agentFactoryFromSpec(DEFAULT_SPEC);

  const httpServer: Server = createServer((req, res) => {
    void serveStatic(req, res, staticRoot);
  });
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    if (pathname !== '/ws') {
      socket.write('HTTP/1.1 426 Upgrade Required\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  function send(conn: Conn, msg: ServerMessage): void {
    if (conn.ws.readyState !== WebSocket.OPEN) return;
    try {
      conn.ws.send(JSON.stringify(msg));
    } catch {
      // 连接过渡态（terminate 后 close 未处理完）send 可同步抛——单连接投递失败
      // 不应炸掉广播方（尤其 driveAI 的 async 循环，抛出会变 unhandled rejection）。
      // close 事件随后统一清理该连接。
    }
  }

  function sendError(conn: Conn, code: string, message: string): void {
    send(conn, { type: 'error', protocolVersion: PROTOCOL_VERSION, code, message });
  }

  /** 广播 room_state（toRoomState 广播安全视图；yourSeat 按接收连接各自填）。 */
  function broadcastRoomState(room: Room): void {
    const state = toRoomState(room);
    for (const conn of conns) {
      if (conn.roomCode !== room.code) continue;
      send(conn, {
        type: 'room_state',
        protocolVersion: PROTOCOL_VERSION,
        room: state,
        yourSeat: conn.seat,
      });
    }
  }

  function broadcast(room: Room, msg: ServerMessage): void {
    for (const conn of conns) {
      if (conn.roomCode !== room.code) continue;
      send(conn, msg);
    }
  }

  /** 广播 draft 阶段状态（DraftState 本身广播安全：无 token、全程公开；preview 附开局预览局面）。 */
  function broadcastDraftState(room: Room): void {
    if (room.draft === null) return;
    const draft =
      room.preview !== null ? { ...room.draft, preview: filterStateFor(room.preview) } : room.draft;
    broadcast(room, { type: 'draft_state', protocolVersion: PROTOCOL_VERSION, draft });
  }

  /** 每人视角快照（legalActions 仅当前应行动座位非空）。 */
  function broadcastSnapshots(entry: SessionEntry): void {
    for (const conn of conns) {
      if (conn.roomCode !== entry.room.code || conn.seat === null) continue;
      const snap = entry.session.snapshotFor(conn.seat);
      send(conn, {
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: snap.seq,
        state: snap.state,
        legalActions: snap.legalActions,
        log: snap.log,
      });
    }
  }

  function attach(conn: Conn, room: Room, seat: PlayerIndex): void {
    conn.roomCode = room.code;
    conn.seat = seat;
  }

  function assertDetached(conn: Conn): void {
    if (conn.roomCode !== null) {
      throw new WsError('already-in-room', `连接已在房间 ${conn.roomCode}，先断开再换房`);
    }
  }

  function setSeatConnected(room: Room, seat: PlayerIndex, connected: boolean): void {
    const seatObj = room.seats[seat];
    if (seatObj === null || seatObj === undefined) return;
    seatObj.connected = connected;
  }

  function handleCreateRoom(conn: Conn, msg: { nickname: string; config: unknown }): void {
    assertDetached(conn);
    if (typeof msg.nickname !== 'string' || typeof msg.config !== 'object' || msg.config === null) {
      throw new WsError('bad-message', 'create_room 需要 nickname(string) 与 config(object)');
    }
    const { room, seat, token } = rooms.createRoom(
      msg.config as Parameters<RoomManager['createRoom']>[0],
      msg.nickname,
    );
    attach(conn, room, seat);
    send(conn, { type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat, token });
    broadcastRoomState(room);
  }

  function handleJoinRoom(conn: Conn, msg: { code: string; nickname: string }): void {
    assertDetached(conn);
    if (typeof msg.code !== 'string' || typeof msg.nickname !== 'string') {
      throw new WsError('bad-message', 'join_room 需要 code(string) 与 nickname(string)');
    }
    const { room, seat, token } = rooms.joinRoom(msg.code, msg.nickname);
    attach(conn, room, seat);
    send(conn, { type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat, token });
    broadcastRoomState(room);
  }

  /** 第 n 个 AI 席位（按座位序数）对应的 AI 配置（aiSeats[n-1]；越界回退第一个/缺省）。 */
  function aiConfigOfSeat(room: Room, seat: PlayerIndex): { difficulty: Difficulty; spec?: string } {
    const aiSeats = room.config.aiSeats ?? [];
    let n = 0;
    for (const s of room.seats) {
      if (s === null || !s.isAI) continue;
      n += 1;
      if (s.seat === seat) {
        const cfg = aiSeats[n - 1] ?? aiSeats[0];
        if (cfg !== undefined) {
          return { difficulty: cfg.difficulty, ...(cfg.spec !== undefined ? { spec: cfg.spec } : {}) };
        }
        return { difficulty: 'normal' };
      }
    }
    return { difficulty: 'normal' };
  }

  /** AI agent 构造：席位指定插件 spec 优先，注入缝其次，缺省服务器默认插件。 */
  function makeAgent(seat: PlayerIndex, cfg: { difficulty: Difficulty; spec?: string }): DecidingAgent {
    if (cfg.spec !== undefined) return agentFactoryFromSpec(cfg.spec)(seat, cfg.difficulty);
    if (options.aiAgentFactory !== undefined) return options.aiAgentFactory(seat, cfg.difficulty);
    return defaultFactory(seat, cfg.difficulty);
  }

  /** 按房间当前座位建 SessionEntry 索引（开局与恢复共用）。 */
  function buildEntry(session: GameSession, room: Room): SessionEntry {
    const agents = new Map<PlayerIndex, DecidingAgent>();
    const tokenSeats = new Map<string, PlayerIndex>();
    for (const s of room.seats) {
      if (s === null) continue;
      if (s.isAI) agents.set(s.seat, makeAgent(s.seat, aiConfigOfSeat(room, s.seat)));
      else tokenSeats.set(s.token, s.seat);
    }
    const entry: SessionEntry = { session, room, tokenSeats, agents, driving: false };
    sessionsByGameId.set(session.gameId, entry);
    for (const token of tokenSeats.keys()) sessionByToken.set(token, entry);
    return entry;
  }

  /** 房间 → engine GameConfig（startGame/confirmDraft 已落地 seed 与 factions）。 */
  function engineConfigOf(room: Room): GameConfig {
    if (room.seed === null || room.factions === null) {
      throw new Error('unreachable: startGame 后 seed/factions 未落地');
    }
    return {
      playerCount: room.config.playerCount,
      seed: room.seed,
      factions: room.factions,
      lostFleet: room.config.lostFleet ?? true,
      ...(room.startingVp !== null ? { startingVp: room.startingVp } : {}),
      ...(room.turnOrder !== null ? { turnOrder: room.turnOrder } : {}),
    };
  }

  /** 开局建房：GameSession + SessionEntry + 广播（random 直开 / draft_confirm 共用）。 */
  function launchSession(room: Room): void {
    const seats: SessionSeat[] = room.seats.map((s) => {
      if (s === null) throw new Error('unreachable: startGame 校验后仍有空座位');
      return { seat: s.seat, nickname: s.nickname, token: s.token, isAI: s.isAI };
    });
    // seats（含 token）随开局落库；roomCode 传真实房间码
    const session = new GameSession(db, undefined, engineConfigOf(room), seats, room.code, {
      roomConfig: room.config,
    });
    const entry = buildEntry(session, room);
    broadcastRoomState(room);
    broadcastSnapshots(entry);
    void driveAI(entry);
  }

  function handleStartGame(msg: { token: string }): void {
    if (typeof msg.token !== 'string') throw new WsError('bad-message', 'start_game 需要 token');
    // RoomError：not-in-room / already-started / room-not-full
    const room = rooms.startGame(msg.token);
    if (room.draft !== null) {
      // friendly/auction：进入 draft 阶段（房间未 started），选族完成后走 draft_confirm
      broadcastRoomState(room);
      broadcastDraftState(room);
      void driveDraftAI(room);
      return;
    }
    launchSession(room);
  }

  // -------------------------------------------------------------------------
  // draft（种族选取）阶段
  // -------------------------------------------------------------------------

  /** draft 并发守卫：同一房间同时只有一个 AI 驱动循环。 */
  const draftDriving = new Set<string>();

  function handleDraftPick(msg: { token: string; faction: unknown }): void {
    if (typeof msg.token !== 'string' || typeof msg.faction !== 'string') {
      throw new WsError('bad-message', 'draft_pick 需要 token 与 faction(string)');
    }
    const room = rooms.draftPick(msg.token, msg.faction as FactionId);
    broadcastDraftState(room);
    void driveDraftAI(room);
  }

  function handleDraftBid(msg: { token: string; faction: unknown; bid: unknown }): void {
    if (typeof msg.token !== 'string' || typeof msg.faction !== 'string' || typeof msg.bid !== 'number') {
      throw new WsError('bad-message', 'draft_bid 需要 token、faction(string) 与 bid(number)');
    }
    const room = rooms.draftBid(msg.token, msg.faction as FactionId, msg.bid);
    broadcastDraftState(room);
    void driveDraftAI(room);
  }

  function handleDraftConfirm(msg: { token: string }): void {
    if (typeof msg.token !== 'string') throw new WsError('bad-message', 'draft_confirm 需要 token');
    const room = rooms.confirmDraft(msg.token);
    launchSession(room);
  }

  /**
   * draft 阶段的 AI 驱动：startGame/draft_pick/draft_bid/resume 后触发（幂等）。
   * AI 策略：按 FACTION_STRENGTH 强度表（@gaia/llm，base/LF 分表）选可用池中
   * 最强族；auction 出价 0 持有、从不抬价（被挤后轮到它时重新选最强空闲族——
   * 18/14 族池大于人数，空闲族恒存在）。任何未预期异常 → 取首个可用族兜底，
   * draft 永不卡死。
   */
  async function driveDraftAI(room: Room): Promise<void> {
    if (draftDriving.has(room.code)) return;
    draftDriving.add(room.code);
    try {
      for (;;) {
        const draft = room.draft;
        if (draft === null || draft.finished) break;
        const actor = draft.currentActor;
        if (actor === null) break;
        const seat = room.seats[actor];
        if (seat === null || seat === undefined || !seat.isAI) break;
        const lostFleet = room.config.lostFleet ?? true;
        const pool = draftFactionPool(lostFleet);
        try {
          const faction = pickFactionByStrength(draft.available, lostFleet ? 'lostFleet' : 'base');
          if (faction === undefined) break; // 防御：理论不可达
          applyDraftPick(draft, pool, actor, faction);
          broadcastDraftState(room);
        } catch (err) {
          console.error(`[ai] driveDraftAI 未预期异常（room=${room.code} seat=${actor}），取首个可用族兜底`, err);
          try {
            const fallback = draft.available[0];
            if (fallback === undefined) break;
            applyDraftPick(draft, pool, actor, fallback);
            broadcastDraftState(room);
          } catch (fallbackErr) {
            console.error(`[ai] driveDraftAI 兜底失败（room=${room.code}），放弃本次驱动`, fallbackErr);
            break;
          }
        }
        // 节奏延迟：让真人看清 AI 选族过程（测试为 0）
        if (aiPaceMs > 0 && room.draft !== null && !room.draft.finished) {
          const next = room.draft.currentActor;
          if (next !== null && room.seats[next]?.isAI === true) {
            await new Promise((r) => setTimeout(r, aiPaceMs));
          }
        }
      }
    } catch (err) {
      console.error(`[ai] driveDraftAI 外层异常（room=${room.code}）`, err);
    } finally {
      draftDriving.delete(room.code);
    }
  }

  /**
   * 服务器重启后的对局恢复：库中 status='playing' 的对局重放重建 session，
   * 并按 seats 表重建 Room（adopt 回 RoomManager）与 tokenSeats/agents 索引。
   * 返回 undefined = 不可恢复（对局不存在/已终局/重放失败）。
   */
  function restoreSessionEntry(gameId: string): SessionEntry | undefined {
    const session = GameSession.restore(db, gameId);
    if (session === null) return undefined;
    const game = findGameById(db, gameId);
    if (game === null) return undefined;
    const seatRows = listSeats(db, gameId);
    const roomSeats: (Seat | null)[] = Array.from({ length: game.playerCount }, () => null);
    for (const s of seatRows) {
      roomSeats[s.seat] = {
        seat: s.seat as PlayerIndex,
        nickname: s.nickname,
        token: s.token,
        connected: s.isAI, // AI 恒在线；真人等 resume 置 true
        isAI: s.isAI,
      };
    }
    const room: Room = {
      code: game.roomCode,
      config: game.config.room,
      seats: roomSeats,
      started: true,
      seed: game.seed,
      factions: game.config.game.factions,
      startingVp: game.config.game.startingVp ?? null,
      turnOrder: game.config.game.turnOrder ?? null,
      draft: null, // 已开局对局无 draft 阶段（draft 仅存在于开局前内存态）
      preview: null,
      customSeed: game.config.room.seed !== undefined,
    };
    rooms.adopt(room);
    const entry = buildEntry(session, room);
    console.log(`[session] 对局 ${gameId} 已经库重放恢复（seq=${session.currentSeq}）`);
    return entry;
  }

  /** AI 行动落库 + 广播（action_applied 带 reason/degraded；终局则补 game_over）。 */
  function applyAIAction(entry: SessionEntry, seat: PlayerIndex, action: Action, reason: string, degraded: boolean): void {
    const { seq } = entry.session.submitAction(seat, action);
    broadcast(entry.room, {
      type: 'action_applied',
      protocolVersion: PROTOCOL_VERSION,
      seq,
      player: seat,
      action,
      events: entry.session.state.lastEvents,
      reason,
      ...(degraded ? { degraded: true } : {}),
    });
    broadcastSnapshots(entry);
    if (entry.session.finished) {
      broadcastGameOver(entry);
    }
  }

  function broadcastGameOver(entry: SessionEntry): void {
    const st = entry.session.state;
    broadcast(entry.room, {
      type: 'game_over',
      protocolVersion: PROTOCOL_VERSION,
      winner: st.winner ?? [],
      finalScores: st.players.map((p) => p.vp),
    });
  }

  /**
   * AI 驱动循环：startGame/submitAction/resume/心跳后触发（幂等）。
   *
   * - 守卫：entry.driving 保证同一 session 同时只有一个驱动循环（检查+置位之间
   *   无 await，单线程下原子）；重入直接返回。
   * - 循环体整体 try/catch：任何未预期异常（agent bug、submitAction 非预期抛出）
   *   → error 日志 + legal[0] 末级兜底直接 submitAction；兜底再失败才放弃本次
   *   驱动（ai_thinking(false) 照发，等 resume/心跳再次触发），对局永不卡死。
   * - ai_thinking(true) 按座位广播，循环结束（含异常路径）对所有广播过 true 的
   *   座位补 false（成对）。
   */
  async function driveAI(entry: SessionEntry): Promise<void> {
    if (entry.driving) return;
    entry.driving = true;
    const thinkingSeats = new Set<PlayerIndex>();
    try {
      for (;;) {
        if (entry.session.finished) break;
        const actor = actorOf(entry.session.state);
        if (actor === null || !entry.agents.has(actor)) break;
        const seat = actor;
        const agent = entry.agents.get(seat)!;
        broadcast(entry.room, {
          type: 'ai_thinking',
          protocolVersion: PROTOCOL_VERSION,
          seat,
          thinking: true,
        });
        thinkingSeats.add(seat);
        try {
          const state = entry.session.state;
          const legal = enumerateActions(state, seat);
          if (legal.length === 0) break; // 防御：理论不可达（applyAction 已结算 setup 跳过）
          const decision = await agent.decide(state, seat, legal);
          applyAIAction(entry, seat, decision.action, decision.reason, decision.degraded);
        } catch (err) {
          console.error(
            `[ai] driveAI 未预期异常（game=${entry.session.gameId} seat=${seat}），走 legal[0] 末级兜底`,
            err,
          );
          try {
            // submitAction 校验序抛错时对局状态未变（session.submitAction 先校验后
            // 替换内存态），actor 应仍等于 seat；不等则说明状态已被外力推进，
            // 交回循环条件重估。
            if (entry.session.finished || actorOf(entry.session.state) !== seat) continue;
            const legal = enumerateActions(entry.session.state, seat);
            const fallback = legal[0];
            if (fallback === undefined) break;
            applyAIAction(entry, seat, fallback, '末级兜底（agent 异常）：取首个合法行动', true);
          } catch (fallbackErr) {
            console.error(
              `[ai] 末级兜底失败（game=${entry.session.gameId} seat=${seat}），放弃本次驱动`,
              fallbackErr,
            );
            break;
          }
        } finally {
          // 逐座位结算 thinking(false)；true→false 成对
          broadcast(entry.room, {
            type: 'ai_thinking',
            protocolVersion: PROTOCOL_VERSION,
            seat,
            thinking: false,
          });
          thinkingSeats.delete(seat);
        }
        // 节奏延迟：给真人留看清每步 AI 行动的时间（测试为 0）
        if (aiPaceMs > 0 && !entry.session.finished) {
          const next = actorOf(entry.session.state);
          if (next !== null && entry.agents.has(next)) {
            await new Promise((r) => setTimeout(r, aiPaceMs));
          }
        }
      }
    } catch (err) {
      // 循环体已整体 try/catch，理论不可达；兜底防 unhandled rejection
      console.error(`[ai] driveAI 外层异常（game=${entry.session.gameId}）`, err);
    } finally {
      entry.driving = false;
      for (const seat of thinkingSeats) {
        broadcast(entry.room, {
          type: 'ai_thinking',
          protocolVersion: PROTOCOL_VERSION,
          seat,
          thinking: false,
        });
      }
    }
  }

  function handleSubmitAction(msg: { token: string; action: unknown }): void {
    if (typeof msg.token !== 'string') throw new WsError('bad-message', 'submit_action 需要 token');
    const entry = sessionByToken.get(msg.token);
    if (entry === undefined) {
      if (rooms.findByToken(msg.token) !== null) {
        throw new WsError('not-started', '对局尚未开始，不能提交行动');
      }
      throw new WsError('invalid-token', 'token 不属于任何进行中对局');
    }
    // token → seat 映射：身份由 token 唯一决定，client 无法指定座位代打
    const seat = entry.tokenSeats.get(msg.token);
    if (seat === undefined) throw new WsError('invalid-token', 'token 无效');
    // SessionError：game-finished / invalid-seat / not-your-turn / engine 合法性 code 透传
    const action = msg.action as Action;
    const { seq } = entry.session.submitAction(seat, action);
    broadcast(entry.room, {
      type: 'action_applied',
      protocolVersion: PROTOCOL_VERSION,
      seq,
      player: seat,
      action,
      events: entry.session.state.lastEvents,
    });
    broadcastSnapshots(entry);
    if (entry.session.finished) {
      broadcastGameOver(entry);
    }
    void driveAI(entry);
  }

  /**
   * 撤销（undo 消息）：token → seat 校验后由 session 截断重放到该座位最近回合起点，
   * 随后全房广播回归 seq 的 snapshot（client 依 seq 回退裁剪行动日志）。
   * 撤销后行动者恒为该座位本人（pending 为空），无需 driveAI。
   */
  function handleUndo(msg: { token: string }): void {
    if (typeof msg.token !== 'string') throw new WsError('bad-message', 'undo 需要 token');
    const entry = sessionByToken.get(msg.token);
    if (entry === undefined) {
      if (rooms.findByToken(msg.token) !== null) {
        throw new WsError('not-started', '对局尚未开始，不能撤销');
      }
      throw new WsError('invalid-token', 'token 不属于任何进行中对局');
    }
    const seat = entry.tokenSeats.get(msg.token);
    if (seat === undefined) throw new WsError('invalid-token', 'token 无效');
    // SessionError：game-finished / invalid-seat / nothing-to-undo / undo-unavailable 透传
    entry.session.undo(seat);
    broadcastSnapshots(entry);
  }

  /**
   * 主动退出对局/房间（leave 消息）：清 token 索引 → 处理座位 → 广播 →
   * 解绑本连接并 terminate（close 时因已解绑不再重复广播）。
   * - 对局进行中：座位标记断线（原对局继续，AI 座位由 driveAI 自动推进；
   *   真人缺位暂不托管，属已知范围）。
   * - 开局前：座位直接清空（置 null）——否则剩余玩家开局的"幽灵座位"是
   *   非 AI 真人位，token 已失效、driveAI 不推进，轮到即对局永久卡死。
   */
  function handleLeave(conn: Conn, msg: { token: string }): void {
    if (typeof msg.token !== 'string') throw new WsError('bad-message', 'leave 需要 token');
    if (conn.roomCode === null || conn.seat === null) {
      throw new WsError('not-in-room', '当前不在任何房间');
    }
    const room = rooms.getRoom(conn.roomCode);
    if (room === null) throw new WsError('room-not-found', '房间不存在');
    // 清 token 索引：被踢 token 不再能 resume/submit
    const entry = sessionByToken.get(msg.token);
    if (entry !== undefined) {
      entry.tokenSeats.delete(msg.token);
      sessionByToken.delete(msg.token);
      setSeatConnected(room, conn.seat, false);
    } else {
      rooms.dropToken(msg.token);
      // draft 阶段真人离开：中止 draft 回大厅态（AI 填充座位保留，可重新 start）
      if (room.draft !== null) rooms.abortDraft(room);
      // 开局前：清空座位（避免幽灵座位卡死后续开局）
      room.seats[conn.seat] = null;
    }
    broadcastRoomState(room);
    // 解绑后 terminate：close 事件里的 handleDisconnect 因 seat 已 null 不再广播
    conn.roomCode = null;
    conn.seat = null;
    conn.ws.terminate();
  }

  function handleResume(conn: Conn, msg: { token: string }): void {
    assertDetached(conn);
    if (typeof msg.token !== 'string') throw new WsError('bad-message', 'resume 需要 token');
    // 开局后：seats 表查 token → gameId，再对内存 session
    const persisted = findSeatByToken(db, msg.token);
    if (persisted !== null) {
      // 内存无 session（服务器重启）→ 按库重放恢复；已终局/重放失败才 session-lost
      const entry = sessionsByGameId.get(persisted.gameId) ?? restoreSessionEntry(persisted.gameId);
      if (entry === undefined) {
        throw new WsError('session-lost', '对局已结束或无法恢复');
      }
      const seat = entry.tokenSeats.get(msg.token);
      if (seat === undefined) throw new WsError('invalid-token', 'token 与对局座位不一致');
      attach(conn, entry.room, seat);
      setSeatConnected(entry.room, seat, true);
      send(conn, { type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat, token: msg.token });
      const snap = entry.session.snapshotFor(seat);
      send(conn, {
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: snap.seq,
        state: snap.state,
        legalActions: snap.legalActions,
        log: snap.log,
      });
      broadcastRoomState(entry.room);
      // resume 重触发 driveAI（幂等，守卫防重入）——对局若停在 AI 回合则被唤醒
      void driveAI(entry);
      return;
    }
    // 开局前：RoomManager 内存索引
    const found = rooms.findByToken(msg.token);
    if (found === null) throw new WsError('invalid-token', 'token 无效');
    attach(conn, found.room, found.seat.seat);
    found.seat.connected = true;
    send(conn, {
      type: 'credentials',
      protocolVersion: PROTOCOL_VERSION,
      seat: found.seat.seat,
      token: msg.token,
    });
    broadcastRoomState(found.room);
    // draft 阶段重连：补发当前选族状态；若停在 AI 行动则唤醒驱动
    if (found.room.draft !== null) {
      send(conn, {
        type: 'draft_state',
        protocolVersion: PROTOCOL_VERSION,
        draft: found.room.draft,
      });
      void driveDraftAI(found.room);
    }
  }

  /** 导出对局记录：从库读出整局行动日志（开局到当前进度），客户端下载为 JSON。 */
  function handleExportGame(conn: Conn, msg: { token: string }): void {
    if (typeof msg.token !== 'string') throw new WsError('bad-message', 'export_game 需要 token');
    const entry = sessionByToken.get(msg.token);
    if (entry === undefined) throw new WsError('invalid-token', 'token 不属于任何进行中对局');
    const game = findGameById(db, entry.session.gameId);
    if (game === null) throw new WsError('session-lost', '对局不存在');
    const record: GameRecord = {
      version: 1,
      config: game.config.game,
      actions: listActions(db, game.id).map((r) => r.action),
    };
    send(conn, { type: 'export_data', protocolVersion: PROTOCOL_VERSION, record });
  }

  /**
   * 残局开新局（branch_game）：record 为已截断的行动前缀（client 在复盘当前步截断）。
   * 先重放校验（同 import_game），再建单人+AI 房间（申请者坐 msg.seat，其余座位 AI 托管；
   * 开放真人补位后续再加），GameSession 以 record.config 创建并逐条 submitAction 落库重放。
   * 终局面不可实战（重放完成即 game-over 时拒绝）。
   */
  function handleBranchGame(conn: Conn, msg: { record: GameRecord; seat?: PlayerIndex; nickname?: string }): void {
    assertDetached(conn);
    const rec = msg.record;
    if (
      rec === null ||
      typeof rec !== 'object' ||
      rec.version !== 1 ||
      typeof rec.config !== 'object' ||
      rec.config === null ||
      !Array.isArray(rec.actions)
    ) {
      throw new WsError('bad-message', 'branch_game 记录格式非法');
    }
    const seat = msg.seat ?? 0;
    if (typeof seat !== 'number' || seat < 0 || seat >= rec.config.playerCount) {
      throw new WsError('invalid-seat', `座位 ${String(msg.seat)} 越界`);
    }
    if (rec.actions.length === 0) {
      throw new WsError('bad-message', 'branch_game 需要至少一条行动（无法从开局前分支）');
    }
    // 重放校验（不落地）
    try {
      let s = newGame(rec.config);
      for (const action of rec.actions) {
        s = applyAction(s, action);
      }
      if (s.phase === 'game-over') {
        throw new WsError('import-invalid', '终局面不可实战');
      }
    } catch (e) {
      if (e instanceof WsError) throw e;
      throw new WsError('import-invalid', `行动日志无法重放: ${(e as Error).message}`);
    }
    const nickname = typeof msg.nickname === 'string' && msg.nickname.length > 0 ? msg.nickname : '我';
    // 建房（申请者先占 seat 0，随后挪到自选座位；其余座位 AI 托管）
    const playerCount = rec.config.playerCount as 2 | 3 | 4;
    const aiSeats = Array.from({ length: playerCount - 1 }, () => ({ difficulty: 'normal' as const }));
    const { room, token: humanToken } = rooms.createRoom(
      { playerCount, lostFleet: rec.config.lostFleet ?? true, factionMode: 'random', aiSeats },
      nickname,
    );
    // 座位重排：申请者放到 msg.seat，其余座位填 AI（token 仅占位，不进 tokenIndex）
    const human = room.seats[0]!;
    room.seats.splice(
      0,
      room.seats.length,
      ...Array.from({ length: playerCount }, (_, i) =>
        i === seat
          ? { ...human, seat: i as PlayerIndex }
          : { seat: i as PlayerIndex, nickname: `AI-${i}（普通）`, token: `ai-${generateGameId()}-${i}`, connected: true, isAI: true },
      ),
    );
    room.started = true;
    const seats: SessionSeat[] = room.seats.map((s) => ({ seat: s!.seat, nickname: s!.nickname, token: s!.token, isAI: s!.isAI }));
    const session = new GameSession(db, undefined, rec.config, seats, room.code, { roomConfig: room.config });
    const entry = buildEntry(session, room);
    // 逐条落库重放（合法性由 submitAction 逐条裁决；终局已在上面拦截）
    for (const action of rec.actions) {
      const actor = actorOf(session.state);
      if (actor === null) break;
      session.submitAction(actor, action);
    }
    attach(conn, room, seat);
    send(conn, { type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat, token: humanToken });
    broadcastRoomState(room);
    broadcastSnapshots(entry);
    void driveAI(entry);
  }

  /**
   * 导入对局记录（仅复盘查看，不进房间）：内存重放校验整个行动序列
   * （newGame(config) + 逐条 applyAction），成功则回发终态 snapshot
   * （seq=行动数，legalActions 仅当 seat 恰为应行动者时非空）。
   * 不改连接的房间归属，不落库。
   */
  function handleImportGame(conn: Conn, msg: { record: GameRecord; seat?: PlayerIndex }): void {
    const rec = msg.record;
    if (
      rec === null ||
      typeof rec !== 'object' ||
      rec.version !== 1 ||
      typeof rec.config !== 'object' ||
      rec.config === null ||
      !Array.isArray(rec.actions)
    ) {
      throw new WsError('bad-message', 'import_game 记录格式非法');
    }
    const seat = msg.seat ?? 0;
    if (typeof seat !== 'number' || seat < 0 || seat >= rec.config.playerCount) {
      throw new WsError('invalid-seat', `座位 ${String(msg.seat)} 越界`);
    }
    let finalState;
    let importLog: { seq: number; player: PlayerIndex; action: Action }[];
    try {
      let s = newGame(rec.config);
      importLog = [];
      for (const action of rec.actions) {
        const a = actorOf(s);
        s = applyAction(s, action);
        importLog.push({ seq: importLog.length, player: (a ?? 0) as PlayerIndex, action });
      }
      finalState = s;
    } catch (e) {
      throw new WsError('import-invalid', `行动日志无法重放: ${(e as Error).message}`);
    }
    const actor = actorOf(finalState);
    send(conn, {
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      seq: rec.actions.length,
      state: filterStateFor(finalState),
      legalActions:
        actor !== null && actor === seat && finalState.phase !== 'game-over'
          ? enumerateActions(finalState, seat)
          : [],
      log: importLog,
    });
  }

  function routeMessage(conn: Conn, msg: ClientMessage): void {
    switch (msg.type) {
      case 'create_room':
        handleCreateRoom(conn, msg);
        break;
      case 'join_room':
        handleJoinRoom(conn, msg);
        break;
      case 'start_game':
        handleStartGame(msg);
        break;
      case 'draft_pick':
        handleDraftPick(msg);
        break;
      case 'draft_bid':
        handleDraftBid(msg);
        break;
      case 'draft_confirm':
        handleDraftConfirm(msg);
        break;
      case 'submit_action':
        handleSubmitAction(msg);
        break;
      case 'undo':
        handleUndo(msg);
        break;
      case 'resume':
        handleResume(conn, msg);
        break;
      case 'leave':
        handleLeave(conn, msg);
        break;
      case 'export_game':
        handleExportGame(conn, msg);
        break;
      case 'import_game':
        handleImportGame(conn, msg);
        break;
      case 'branch_game':
        handleBranchGame(conn, msg);
        break;
      case 'ping':
        send(conn, { type: 'pong', protocolVersion: PROTOCOL_VERSION });
        break;
      case 'list_agent_plugins':
        send(conn, { type: 'agent_plugins', protocolVersion: PROTOCOL_VERSION, plugins: listAgentPlugins(), defaultSpec: DEFAULT_SPEC });
        break;
      default:
        sendError(conn, 'unknown-message', `未知消息类型: ${String((msg as { type: unknown }).type)}`);
    }
  }

  function handleMessage(conn: Conn, data: RawData): void {
    let msg: unknown;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      sendError(conn, 'bad-message', '消息不是合法 JSON');
      return;
    }
    if (typeof msg !== 'object' || msg === null || typeof (msg as { type?: unknown }).type !== 'string') {
      sendError(conn, 'bad-message', '消息缺 type 字段');
      return;
    }
    if ((msg as { protocolVersion?: unknown }).protocolVersion !== PROTOCOL_VERSION) {
      sendError(
        conn,
        'protocol-mismatch',
        `协议版本不匹配：期望 ${PROTOCOL_VERSION}，收到 ${String((msg as { protocolVersion?: unknown }).protocolVersion)}`,
      );
      return;
    }
    try {
      routeMessage(conn, msg as ClientMessage);
    } catch (e) {
      if (e instanceof RoomError || e instanceof SessionError || e instanceof WsError || e instanceof DraftError) {
        sendError(conn, e.code, e.message);
      } else {
        console.error('[ws] 未预期错误', e);
        sendError(conn, 'internal-error', '服务器内部错误');
      }
    }
  }

  function handleDisconnect(conn: Conn): void {
    if (conn.roomCode === null || conn.seat === null) return;
    const room = rooms.getRoom(conn.roomCode);
    if (room === null) return;
    // 同座位允许多连接共存：还有其他连接绑定该座位时座位保持在线
    for (const other of conns) {
      if (other.roomCode === conn.roomCode && other.seat === conn.seat) return;
    }
    const seatObj = room.seats[conn.seat];
    if (seatObj === null || seatObj === undefined || !seatObj.connected) return;
    seatObj.connected = false;
    broadcastRoomState(room);
  }

  wss.on('connection', (ws: WebSocket) => {
    const conn: Conn = { ws, roomCode: null, seat: null, lastPongAt: Date.now() };
    conns.add(conn);
    ws.on('pong', () => {
      conn.lastPongAt = Date.now();
    });
    ws.on('message', (data: RawData) => {
      handleMessage(conn, data);
    });
    ws.on('close', () => {
      conns.delete(conn);
      handleDisconnect(conn);
    });
    ws.on('error', () => {
      // close 事件随后统一清理
    });
  });

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const conn of conns) {
      if (conn.ws.readyState !== WebSocket.OPEN) continue;
      if (now - conn.lastPongAt > heartbeatTimeoutMs) {
        conn.ws.terminate();
        continue;
      }
      conn.ws.ping();
    }
    // 心跳重触发 driveAI（幂等，守卫防重入）：兜底放弃/异常中断的驱动借此复活
    for (const entry of sessionsByGameId.values()) void driveAI(entry);
    // draft 阶段同理（AI 选族驱动中断时借心跳复活）
    for (const room of rooms.draftingRooms()) void driveDraftAI(room);
  }, heartbeatIntervalMs);
  heartbeat.unref();

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once('error', rejectListen);
    httpServer.listen(options.port, () => {
      httpServer.removeListener('error', rejectListen);
      resolveListen();
    });
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;

  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const conn of conns) conn.ws.terminate();
    await new Promise<void>((res) => {
      wss.close(() => res());
    });
    await new Promise<void>((resolveClose, rejectClose) => {
      httpServer.close((err) => (err !== undefined ? rejectClose(err) : resolveClose()));
    });
    db.$client.close();
  }

  return { port, close };
}

/** 静态文件托管：GET -only，/ 补 index.html，resolve 出根目录一律 404。 */
async function serveStatic(
  req: IncomingMessage,
  res: ServerResponse,
  staticRoot: string | null,
): Promise<void> {
  if (staticRoot === null || req.method !== 'GET') {
    res.writeHead(404).end('not found');
    return;
  }
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const filePath = resolve(staticRoot, `.${pathname}`);
  if (filePath !== staticRoot && !filePath.startsWith(staticRoot + sep)) {
    res.writeHead(404).end('not found');
    return;
  }
  try {
    const body = await readFile(filePath);
    // 缓存策略：带内容指纹的构建产物 immutable 长缓存；index.html no-cache 每次校验；
    // 其余素材 1 天缓存 + ETag。
    const isFingerprint = /\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(pathname);
    const isHtml = pathname.endsWith('.html');
    const headers: Record<string, string> = {
      'content-type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': isFingerprint
        ? 'public, max-age=31536000, immutable'
        : isHtml
          ? 'no-cache'
          : 'public, max-age=86400',
    };
    if (!isFingerprint && !isHtml) {
      const st = await stat(filePath);
      const etag = `W/"${Math.round(st.mtimeMs)}-${st.size}"`;
      headers['etag'] = etag;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, headers).end();
        return;
      }
    }
    res.writeHead(200, headers);
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}
