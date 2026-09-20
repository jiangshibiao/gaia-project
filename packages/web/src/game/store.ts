/**
 * 对局状态 store（M2c）：ws 薄封装 GameClient + 手写 store（useSyncExternalStore，
 * 不引 redux/zustand）。架构照 Brass web 按盖亚协议适配：
 * - 盖亚无隐藏信息：snapshot 直接是全量 FilteredState；无选牌/暂存/回合扣留机制；
 * - 断线语义（对齐 server）：同 token resume 会踢掉旧连接——被动 close 一律视为
 *   可恢复断线：延时重连，持 token 时连上自动发 resume；
 * - token 持久化 localStorage（`gaia:token:<code>`），刷新后 restoreSession() 读回，
 *   connect 即自动 resume；双标签页用 owner 标记（`gaia:owner:<code>`）判定接管，
 *   避免两标签互踢；resume 被拒（invalid-token / session-lost）→ 清 session 回大厅。
 *
 * 日志：action_applied 流环形缓冲，保留最新 LOG_CAPACITY 条；
 * ai_thinking 维护 thinkingSeats；AI 行动的 reason/degraded 进 LogEntry。
 *
 * 导入/导出与复盘：
 * - exportGame() → 服务器回 export_data（整局 GameRecord），经 download 钩子下载 JSON；
 * - importGame(record) → 服务器重放校验，通过后的 snapshot 应答被拦截进入复盘模式
 *   （state.review），失败走 lastError 停留大厅；复盘回放由 ReviewScreen 本地逐步
 *   newGame + applyAction 重放，不占 snapshot/房间态。
 */
import { useSyncExternalStore } from 'react';
import { PROTOCOL_VERSION } from '@gaia/protocol';
import type {
  AgentPluginMeta,
  ClientMessage,
  DraftState,
  FilteredState,
  GameRecord,
  RoomConfig,
  RoomState,
  ServerMessage,
} from '@gaia/protocol';
import type { Action, FactionId, PlayerIndex } from '@gaia/engine';

// WebSocket.readyState 数值常量（CONNECTING/OPEN），避免依赖全局 WebSocket。
const WS_CONNECTING = 0;
const WS_OPEN = 1;

/** 可注入的 ws 最小接口：原生 WebSocket 结构兼容（默认工厂处强转）。 */
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export type WebSocketFactory = (url: string) => WebSocketLike;

/** localStorage 最小接口（key 枚举用于扫描已存房间 token）；测试注入内存版。 */
export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

/** localStorage key 前缀：`gaia:token:<房间号>` / `gaia:owner:<房间号>`。 */
export const TOKEN_KEY_PREFIX = 'gaia:token:';
export const OWNER_KEY_PREFIX = 'gaia:owner:';
/** owner 标记新鲜窗口：被动 close 时他 tab 在此窗口内抢座才判为"被接管"。 */
export const TAKEOVER_WINDOW_MS = 10_000;

/** 浏览器环境取 localStorage；隐私模式/非浏览器降级为 null（不持久化）。 */
function defaultStorage(): SessionStorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function randomTabId(): string {
  return `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

const defaultFactory: WebSocketFactory = (url) =>
  new WebSocket(url) as unknown as WebSocketLike;

/**
 * 浏览器 ws 薄封装。构造传 url + 可选 WebSocketFactory（测试注入 fake）。
 * 事件走 onMessage/onOpen/onClose 订阅（返回退订函数）；消息帧 JSON 解析失败即丢弃。
 */
export class GameClient {
  private ws: WebSocketLike | null = null;
  private readonly messageHandlers = new Set<(msg: ServerMessage) => void>();
  private readonly openHandlers = new Set<() => void>();
  private readonly closeHandlers = new Set<() => void>();

  constructor(
    private readonly url: string,
    private readonly factory: WebSocketFactory = defaultFactory,
  ) {}

  /** 建连；已 connecting/open 时幂等。 */
  connect(): void {
    if (
      this.ws !== null &&
      (this.ws.readyState === WS_CONNECTING || this.ws.readyState === WS_OPEN)
    ) {
      return;
    }
    const ws = this.factory(this.url);
    this.ws = ws;
    ws.onopen = () => {
      for (const cb of this.openHandlers) cb();
    };
    ws.onclose = () => {
      for (const cb of this.closeHandlers) cb();
    };
    ws.onerror = () => {
      // close 事件随后统一处理
    };
    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(event.data)) as ServerMessage;
      } catch {
        return; // 非法帧丢弃
      }
      for (const cb of this.messageHandlers) cb(msg);
    };
  }

  /** 未 open 时抛错（调用方应等 connected 后再发）。 */
  send(msg: ClientMessage): void {
    if (this.ws === null || this.ws.readyState !== WS_OPEN) {
      throw new Error('WebSocket 未连接');
    }
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    this.ws?.close();
  }

  onMessage(cb: (msg: ServerMessage) => void): () => void {
    this.messageHandlers.add(cb);
    return () => {
      this.messageHandlers.delete(cb);
    };
  }

  onOpen(cb: () => void): () => void {
    this.openHandlers.add(cb);
    return () => {
      this.openHandlers.delete(cb);
    };
  }

  onClose(cb: () => void): () => void {
    this.closeHandlers.add(cb);
    return () => {
      this.closeHandlers.delete(cb);
    };
  }
}

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

/** action_applied 日志条目（events 原样保留，面板层可自行展开）。 */
export interface LogEntry {
  seq: number;
  player: PlayerIndex;
  action: Action;
  events: unknown[];
  /** AI 决策理由（真人行动无此字段）。 */
  reason?: string;
  /** true：该 AI 行动走了非 LLM 降级路径（启发式/兜底）。 */
  degraded?: boolean;
}

export interface GameOverInfo {
  winner: PlayerIndex[];
  finalScores: number[];
}

/** 回放速度倍率（1×/2×/4×）。 */
export type ReviewSpeed = 1 | 2 | 4;

/**
 * 复盘回放状态（导入对局记录后进入）：record 为校验通过的整局记录，
 * step 为当前已重放的行动数（0 = 开局），回放状态由 ReviewScreen 本地
 * newGame(config) + 前 step 条 applyAction 重放得出（不落 store.snapshot）。
 */
export interface ReviewState {
  record: GameRecord;
  step: number;
  playing: boolean;
  speed: ReviewSpeed;
  /** 第一视角座位（上方个人版图所属玩家；「此处开始对局」也以该座位入座）。 */
  viewSeat: PlayerIndex;
}

/** 文件下载钩子（导出对局记录）：默认浏览器 Blob 下载，测试注入 spy。 */
export type DownloadFn = (filename: string, text: string) => void;

/** 浏览器默认下载：Blob + a[download] 点击；非浏览器环境空操作。 */
function defaultDownload(filename: string, text: string): void {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export interface GameStoreState {
  connection: ConnectionStatus;
  room: RoomState | null;
  /** 本人座位（room_state.yourSeat / credentials.seat）。 */
  seat: PlayerIndex | null;
  /** draft（种族选取）阶段状态；非 draft 阶段为 null。 */
  draft: DraftState | null;
  /** credentials 下发的 token；断线重连后自动 resume 的凭据。 */
  token: string | null;
  snapshot: FilteredState | null;
  legalActions: Action[];
  /** 最近一次 snapshot 的 seq。 */
  seq: number;
  log: LogEntry[];
  /** 正在决策中的 AI 座位（ai_thinking true 加入、false 移除）。 */
  thinkingSeats: PlayerIndex[];
  gameOver: GameOverInfo | null;
  lastError: { code: string; message: string } | null;
  /** 连接被另一标签页（同 token）接管：停止自动重连，等用户 reclaim/leaveRoom。 */
  takenOver: boolean;
  /** 可用 AI 插件清单（list_agent_plugins 拉取；大厅 AI 席位下拉用）。 */
  agentPlugins: AgentPluginMeta[];
  /** 服务器默认 AI spec（agent_plugins 应答携带）。 */
  defaultAISpec: string | null;
  /** 复盘回放状态（非 null = 复盘模式，App 路由到 ReviewScreen）。 */
  review: ReviewState | null;
}

export const LOG_CAPACITY = 200;

const INITIAL_STATE: GameStoreState = {
  connection: 'disconnected',
  room: null,
  seat: null,
  draft: null,
  token: null,
  snapshot: null,
  legalActions: [],
  seq: 0,
  log: [],
  thinkingSeats: [],
  gameOver: null,
  lastError: null,
  takenOver: false,
  agentPlugins: [],
  defaultAISpec: null,
  review: null,
};

export interface GameStoreOptions {
  /** 被动断线后的重连延时，默认 1000ms（测试传 0）。 */
  reconnectDelayMs?: number;
  /** token/owner 持久化存储，默认 localStorage；传 null 关闭持久化。 */
  storage?: SessionStorageLike | null;
  /** 本标签页 id（owner 标记用），默认随机生成。 */
  tabId?: string;
  /** 接管判定窗口，默认 TAKEOVER_WINDOW_MS。 */
  takeoverWindowMs?: number;
  /** 导出记录下载钩子，默认浏览器 Blob 下载（测试注入 spy）。 */
  download?: DownloadFn;
}

export class GameStore {
  private state: GameStoreState = INITIAL_STATE;
  private readonly listeners = new Set<() => void>();
  private intentionalClose = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reconnectDelayMs: number;
  private readonly storage: SessionStorageLike | null;
  private readonly tabId: string;
  private readonly takeoverWindowMs: number;
  private readonly download: DownloadFn;
  /** import_game 已发出、等待服务器重放校验应答的记录（snapshot=通过 / error=失败）。 */
  private pendingImport: GameRecord | null = null;
  /** restoreSession 读到的房间号（room_state 未达前 room 为 null，用它定位持久化 key）。 */
  private persistedCode: string | null = null;

  constructor(
    private readonly client: GameClient,
    options: GameStoreOptions = {},
  ) {
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1000;
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    this.tabId = options.tabId ?? randomTabId();
    this.takeoverWindowMs = options.takeoverWindowMs ?? TAKEOVER_WINDOW_MS;
    this.download = options.download ?? defaultDownload;
    client.onMessage((msg) => this.handleMessage(msg));
    client.onOpen(() => this.handleOpen());
    client.onClose(() => this.handleClose());
  }

  getState = (): GameStoreState => this.state;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  /** 主动建连（也用于自动重连）。已连接时为空操作（重复调用不打断现有连接）。 */
  connect(): void {
    if (this.state.connection === 'connected') return;
    this.intentionalClose = false;
    this.clearReconnectTimer();
    this.patch({ connection: 'connecting' });
    this.client.connect();
  }

  /** 主动断开：不自动重连。 */
  disconnect(): void {
    this.intentionalClose = true;
    this.clearReconnectTimer();
    this.client.close();
    this.patch({ connection: 'disconnected' });
  }

  createRoom(nickname: string, config: RoomConfig): void {
    this.send({ type: 'create_room', protocolVersion: PROTOCOL_VERSION, nickname, config });
  }

  /** 拉取可用 AI 插件清单（大厅 AI 席位下拉用；应答进 state.agentPlugins）。 */
  listAgentPlugins(): void {
    this.send({ type: 'list_agent_plugins', protocolVersion: PROTOCOL_VERSION });
  }

  joinRoom(code: string, nickname: string): void {
    this.send({ type: 'join_room', protocolVersion: PROTOCOL_VERSION, code, nickname });
  }

  startGame(): void {
    this.send({
      type: 'start_game',
      protocolVersion: PROTOCOL_VERSION,
      token: this.requireToken(),
    });
  }

  /** draft：选一个无人持有的族（friendly 锁定 / auction 出价 0 持有）。 */
  draftPick(faction: FactionId): void {
    this.send({ type: 'draft_pick', protocolVersion: PROTOCOL_VERSION, token: this.requireToken(), faction });
  }

  /** draft（auction）：对已被持有的族出更高价。 */
  draftBid(faction: FactionId, bid: number): void {
    this.send({ type: 'draft_bid', protocolVersion: PROTOCOL_VERSION, token: this.requireToken(), faction, bid });
  }

  /** draft 全员就绪后确认开局。 */
  draftConfirm(): void {
    this.send({ type: 'draft_confirm', protocolVersion: PROTOCOL_VERSION, token: this.requireToken() });
  }

  submitAction(action: Action): void {
    this.send({
      type: 'submit_action',
      protocolVersion: PROTOCOL_VERSION,
      token: this.requireToken(),
      action,
    });
  }

  /** 撤销自己最近的回合（服务端截断重放；snapshot 以更小 seq 回归时行动日志同步裁剪）。 */
  undo(): void {
    this.send({ type: 'undo', protocolVersion: PROTOCOL_VERSION, token: this.requireToken() });
  }

  /** 导出当前对局记录：应答 export_data 到达后触发下载（gaia-<房码>-<N>steps.json）。 */
  exportGame(): void {
    this.send({ type: 'export_game', protocolVersion: PROTOCOL_VERSION, token: this.requireToken() });
  }

  /**
   * 导入对局记录（大厅复盘入口）：发 import_game 由服务器重放校验；
   * 校验通过的 snapshot 应答被拦截并进入复盘模式（见 handleMessage），
   * 失败（bad-message/import-invalid 等）走 lastError 展示，停留大厅。
   */
  importGame(record: GameRecord): void {
    this.pendingImport = record;
    this.patch({ lastError: null });
    this.send({ type: 'import_game', protocolVersion: PROTOCOL_VERSION, record });
  }

  /** 复盘：跳到指定步（clamp 到 [0, 行动数]；拖动/步进时暂停连播）。 */
  setReviewStep(step: number): void {
    const review = this.state.review;
    if (review === null) return;
    const total = review.record.actions.length;
    const clamped = Math.max(0, Math.min(total, Math.round(step)));
    this.patch({ review: { ...review, step: clamped, playing: false } });
  }

  /** 复盘：播放/暂停切换；已在结尾时再次播放从头开始。 */
  reviewTogglePlay(): void {
    const review = this.state.review;
    if (review === null) return;
    if (review.playing) {
      this.patch({ review: { ...review, playing: false } });
      return;
    }
    const total = review.record.actions.length;
    const step = review.step >= total ? 0 : review.step;
    this.patch({ review: { ...review, step, playing: true } });
  }

  /** 复盘：连播走一步（ReviewScreen 定时器驱动）；到结尾自动停播。 */
  reviewTick(): void {
    const review = this.state.review;
    if (review === null || !review.playing) return;
    const total = review.record.actions.length;
    const step = review.step + 1;
    this.patch({ review: { ...review, step, playing: step < total } });
  }

  /** 复盘：设置连播速度。 */
  setReviewSpeed(speed: ReviewSpeed): void {
    const review = this.state.review;
    if (review === null) return;
    this.patch({ review: { ...review, speed } });
  }

  /** 复盘：切换第一视角座位（上方个人版图所属玩家）。 */
  setReviewViewSeat(seat: PlayerIndex): void {
    const review = this.state.review;
    if (review === null) return;
    this.patch({ review: { ...review, viewSeat: seat } });
  }

  /** 复盘：从当前步进入真实对局（残局开新房间，其余座位 AI 托管）。 */
  startFromReview(): void {
    const review = this.state.review;
    if (review === null) return;
    const record: GameRecord = { ...review.record, actions: review.record.actions.slice(0, review.step) };
    this.patch({ review: null });
    this.send({ type: 'branch_game', protocolVersion: PROTOCOL_VERSION, record, seat: review.viewSeat, nickname: '我' });
  }

  /** 退出复盘回大厅（导入不进房间，无需通知服务器）。 */
  exitReview(): void {
    if (this.state.review === null) return;
    this.patch({ review: null });
  }

  /** 清除服务器错误提示（error-toast 点击关闭）。 */
  clearError(): void {
    this.patch({ lastError: null });
  }

  /**
   * 刷新恢复：扫描 storage 里的 `gaia:token:*`，取到即置 token（之后 connect
   * 会自动 resume）。返回是否找到。多房间 token 并存时取先扫到的（单房间足够）。
   */
  restoreSession(): boolean {
    if (this.storage === null) return false;
    for (let i = 0; i < this.storage.length; i++) {
      const key = this.storage.key(i);
      if (key === null || !key.startsWith(TOKEN_KEY_PREFIX)) continue;
      const token = this.storage.getItem(key);
      if (token === null) continue;
      this.persistedCode = key.slice(TOKEN_KEY_PREFIX.length);
      this.patch({ token });
      return true;
    }
    return false;
  }

  /** 被接管后手动抢回座位：清标记态并重连（连上自动 resume，他 tab 将被踢）。 */
  reclaim(): void {
    if (!this.state.takenOver) return;
    this.patch({ takenOver: false });
    this.connect();
  }

  /**
   * 返回大厅：主动离开。已入房/入对局时先发 leave（服务端清 token 索引、
   * 座位标断线、广播、断开本连接），再清持久化会话、以无 token 干净身份重连。
   */
  leaveRoom(): void {
    if (this.state.token !== null && this.state.connection === 'connected') {
      try {
        this.send({ type: 'leave', protocolVersion: PROTOCOL_VERSION, token: this.state.token });
      } catch {
        // 连接已坏：直接本地清理即可（服务端断线处理等价）
      }
    }
    this.disconnect();
    this.clearSession();
    this.patch({ log: [], thinkingSeats: [], lastError: null });
    this.connect();
  }

  /** 清 token 与持久化并回大厅态（不清 log/lastError——resume 失败时由调用方补写）。 */
  private clearSession(): void {
    const code = this.roomCode();
    if (this.storage !== null && code !== null) {
      this.storage.removeItem(TOKEN_KEY_PREFIX + code);
      this.storage.removeItem(OWNER_KEY_PREFIX + code);
    }
    this.persistedCode = null;
    this.patch({
      token: null,
      room: null,
      seat: null,
      draft: null,
      snapshot: null,
      legalActions: [],
      seq: 0,
      gameOver: null,
      takenOver: false,
    });
  }

  /** 当前房间号：room_state 已知用 room.code，否则用 restoreSession 读到的。 */
  private roomCode(): string | null {
    return this.state.room?.code ?? this.persistedCode;
  }

  /** 持 token 且已知房间号 → 持久化（刷新后 restoreSession 可找回）。 */
  private persistSession(): void {
    const code = this.roomCode();
    if (this.storage === null || code === null || this.state.token === null) return;
    this.storage.setItem(TOKEN_KEY_PREFIX + code, this.state.token);
  }

  /** 抢座/入座前标记"本 tab 持有该房间座位"，供他 tab 判定接管。 */
  private writeOwnerMarker(): void {
    const code = this.roomCode();
    if (this.storage === null || code === null) return;
    this.storage.setItem(
      OWNER_KEY_PREFIX + code,
      JSON.stringify({ tabId: this.tabId, at: Date.now() }),
    );
  }

  /** 被动 close 时判定：他 tab 在窗口期内抢座（owner 标记新鲜且非本 tab）。 */
  private foreignFreshOwner(): boolean {
    const code = this.roomCode();
    if (this.storage === null || code === null) return false;
    const raw = this.storage.getItem(OWNER_KEY_PREFIX + code);
    if (raw === null) return false;
    try {
      const marker = JSON.parse(raw) as { tabId?: unknown; at?: unknown };
      return (
        typeof marker.tabId === 'string' &&
        marker.tabId !== this.tabId &&
        typeof marker.at === 'number' &&
        Date.now() - marker.at < this.takeoverWindowMs
      );
    } catch {
      return false;
    }
  }

  private requireToken(): string {
    if (this.state.token === null) {
      throw new Error('尚无 credentials token——先 create/join/resume');
    }
    return this.state.token;
  }

  private send(msg: ClientMessage): void {
    this.client.send(msg);
  }

  /** 连上：若持 token（曾入房/入过对局）自动 resume 抢回座位（先写 owner 标记）。 */
  private handleOpen(): void {
    this.patch({ connection: 'connected' });
    if (this.state.token !== null) {
      this.writeOwnerMarker();
      this.client.send({
        type: 'resume',
        protocolVersion: PROTOCOL_VERSION,
        token: this.state.token,
      });
    }
  }

  /**
   * 被动 close：他 tab 新鲜抢座 → takenOver（停自动重连，避免两标签互踢）；
   * 否则一律安排自动重连。
   */
  private handleClose(): void {
    if (this.intentionalClose) return;
    if (this.state.token !== null && this.foreignFreshOwner()) {
      this.patch({ connection: 'disconnected', takenOver: true });
      return;
    }
    this.patch({ connection: 'disconnected' });
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelayMs);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'room_state':
        // drafting=false 的 room_state（confirm 开局 / 离开中止 draft）同步清掉 draft 态
        this.patch({ room: msg.room, seat: msg.yourSeat, draft: msg.room.drafting ? this.state.draft : null });
        this.persistSession();
        break;
      case 'draft_state':
        this.patch({ draft: msg.draft });
        break;
      case 'credentials':
        this.patch({ token: msg.token, seat: msg.seat });
        this.persistSession();
        break;
      case 'snapshot':
        // 导入校验通过的应答：拦截进入复盘模式（本地重放），不落对局 snapshot
        if (this.pendingImport !== null) {
          const record = this.pendingImport;
          this.pendingImport = null;
          this.patch({
            review: { record, step: 0, playing: false, speed: 1, viewSeat: 0 },
            lastError: null,
          });
          break;
        }
        this.patch({
          snapshot: msg.state,
          legalActions: msg.legalActions,
          seq: msg.seq,
          // 对局开始（draft_confirm / random 直开）后不再处于 draft 阶段
          draft: null,
          // 撤销回归（undo 后 seq 变小）：行动日志同步裁剪，被回退的行动不再展示
          log: msg.seq < this.state.seq ? this.state.log.filter((e) => e.seq < msg.seq) : this.state.log,
          // 终局快照（resume 已终局对局/重启恢复）：从状态推导 gameOver，
          // 否则只靠 game_over 消息，刷新后胜者横幅会丢
          gameOver:
            msg.state.phase === 'game-over'
              ? {
                  winner: msg.state.winner ?? [],
                  finalScores: msg.state.players.map((p) => p.vp),
                }
              : this.state.gameOver,
        });
        break;
      case 'action_applied': {
        const entry: LogEntry = {
          seq: msg.seq,
          player: msg.player,
          action: msg.action,
          events: msg.events,
          ...(msg.reason !== undefined ? { reason: msg.reason } : {}),
          ...(msg.degraded !== undefined ? { degraded: msg.degraded } : {}),
        };
        this.patch({ log: [...this.state.log, entry].slice(-LOG_CAPACITY) });
        break;
      }
      case 'ai_thinking': {
        // true 加入（幂等）/ false 移除；两个分支都先 includes 判断——座位本就不在
        // 列表时复用原数组，避免 filter 产出语义等价的新引用触发无谓 patch
        const next = msg.thinking
          ? this.state.thinkingSeats.includes(msg.seat)
            ? this.state.thinkingSeats
            : [...this.state.thinkingSeats, msg.seat]
          : this.state.thinkingSeats.includes(msg.seat)
            ? this.state.thinkingSeats.filter((s) => s !== msg.seat)
            : this.state.thinkingSeats;
        if (next !== this.state.thinkingSeats) this.patch({ thinkingSeats: next });
        break;
      }
      case 'game_over':
        this.patch({ gameOver: { winner: msg.winner, finalScores: msg.finalScores } });
        break;
      case 'error':
        // 导入校验失败（bad-message/import-invalid 等）：清挂起，停留大厅展示错误
        this.pendingImport = null;
        // resume 被拒（token 失效/对局丢失）：清 session 回大厅态，避免每次重连空转 resume
        if (msg.code === 'invalid-token' || msg.code === 'session-lost') {
          this.clearSession();
        }
        this.patch({ lastError: { code: msg.code, message: msg.message } });
        break;
      case 'export_data': {
        const code = this.roomCode() ?? 'record';
        this.download(
          `gaia-${code}-${msg.record.actions.length}steps.json`,
          JSON.stringify(msg.record, null, 2),
        );
        break;
      }
      case 'pong':
        break;
      case 'agent_plugins':
        this.patch({ agentPlugins: msg.plugins, defaultAISpec: msg.defaultSpec });
        break;
    }
  }

  /** 不可变更新：每次产生新 state 对象，useSyncExternalStore 靠引用比较触发渲染。 */
  private patch(partial: Partial<GameStoreState>): void {
    this.state = { ...this.state, ...partial };
    for (const cb of this.listeners) cb();
  }
}

/** React 绑定：订阅整个 store 状态。 */
export function useGameStore(store: GameStore): GameStoreState {
  return useSyncExternalStore(store.subscribe, store.getState);
}
