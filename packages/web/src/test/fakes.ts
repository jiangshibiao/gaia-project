/**
 * 测试共享辅助（M2c）：FakeWebSocket / FakeStorage / store 工厂与 fixtures。
 * 供 store.test / App.test / 组件测试复用（不参与覆盖率统计意义的生产代码）。
 */
import { PROTOCOL_VERSION } from '@gaia/protocol';
import type { RoomState, ServerMessage } from '@gaia/protocol';
import { newGame } from '@gaia/engine';
import { GameClient, GameStore } from '../game/store';
import type { WebSocketLike } from '../game/store';

/** 测试用假 ws：记录发送帧，手动触发 open/message/close。 */
export class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  readonly sent: string[] = [];

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  // ---- 测试驱动方法 ----
  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  emit(msg: ServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  /** 服务器侧被动断开（心跳超时 / 同 token resume 踢连接）。 */
  serverClose(): void {
    this.readyState = 3;
    this.onclose?.();
  }

  lastSent(): unknown {
    const raw = this.sent[this.sent.length - 1];
    return raw === undefined ? undefined : JSON.parse(raw);
  }
}

/** 内存版 SessionStorageLike：模拟 localStorage（key 枚举按插入序）。 */
export class FakeStorage {
  private readonly map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
}

export function setupStore(
  reconnectDelayMs = 0,
  opts: { storage?: FakeStorage; tabId?: string; download?: (filename: string, text: string) => void } = {},
): { store: GameStore; storage: FakeStorage } {
  FakeWebSocket.instances = [];
  const storage = opts.storage ?? new FakeStorage();
  const client = new GameClient('ws://test/ws', (url) => new FakeWebSocket(url));
  const store = new GameStore(client, {
    reconnectDelayMs,
    storage,
    tabId: opts.tabId ?? 'tab-A',
    ...(opts.download !== undefined ? { download: opts.download } : {}),
  });
  return { store, storage };
}

export function lastWs(): FakeWebSocket {
  const ws = FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  if (ws === undefined) throw new Error('尚未创建任何 FakeWebSocket');
  return ws;
}

export function roomFixture(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: 'ABCD',
    config: { playerCount: 4, lostFleet: true },
    customSeed: false,
    seats: [
      { seat: 0, nickname: '甲', isAI: false, connected: true },
      { seat: 1, nickname: '乙', isAI: false, connected: true },
      { seat: 2, nickname: '丙', isAI: false, connected: true },
      { seat: 3, nickname: '丁', isAI: false, connected: true },
    ],
    started: false,
    drafting: false,
    ...overrides,
  };
}

/** 测试用对局 fixture（4 族确定性开局）。 */
export function gameFixture() {
  return newGame({
    playerCount: 4,
    seed: 42,
    factions: ['terrans', 'xenos', 'geodens', 'itars'],
    lostFleet: true,
  });
}

/** 开房并入座：connect → open → credentials + room_state。 */
export function enterRoom(store: GameStore, code = 'ABCD'): FakeWebSocket {
  store.connect();
  const ws = lastWs();
  ws.open();
  ws.emit({ type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat: 0, token: 'tok-A' });
  ws.emit({
    type: 'room_state',
    protocolVersion: PROTOCOL_VERSION,
    room: { ...roomFixture(), code },
    yourSeat: 0,
  });
  return ws;
}
