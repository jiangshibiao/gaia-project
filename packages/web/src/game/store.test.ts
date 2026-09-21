/**
 * GameClient / GameStore 单测（M2c）：FakeWebSocket 注入替代原生 ws——
 * 连接/建房/收快照/提交行动/断线重连自动 resume/token 持久化/同座位多连接共存。
 */
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, filterStateFor } from '@gaia/protocol';
import { newGame } from '@gaia/engine';
import type { GameRecord } from '@gaia/protocol';
import { GameClient, GameStore, useGameStore } from './store';
import {
  FakeStorage,
  FakeWebSocket,
  enterRoom,
  gameFixture,
  lastWs,
  roomFixture,
  setupStore as setup,
} from '../test/fakes';

/** 等一个 macrotask，让 reconnectDelayMs=0 的重连定时器先跑完。 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe('GameStore 状态迁移', () => {
  it('初始为 disconnected，各字段为空', () => {
    const { store } = setup();
    const s = store.getState();
    expect(s.connection).toBe('disconnected');
    expect(s.room).toBeNull();
    expect(s.seat).toBeNull();
    expect(s.token).toBeNull();
    expect(s.snapshot).toBeNull();
    expect(s.legalActions).toEqual([]);
    expect(s.seq).toBe(0);
    expect(s.log).toEqual([]);
    expect(s.gameOver).toBeNull();
  });

  it('connect → connecting；ws open → connected', () => {
    const { store } = setup();
    store.connect();
    expect(store.getState().connection).toBe('connecting');
    lastWs().open();
    expect(store.getState().connection).toBe('connected');
  });

  it('room_state 更新 room 与 yourSeat', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    ws.emit({
      type: 'room_state',
      protocolVersion: PROTOCOL_VERSION,
      room: roomFixture(),
      yourSeat: 2,
    });
    const s = store.getState();
    expect(s.room?.code).toBe('ABCD');
    expect(s.seat).toBe(2);
  });

  it('credentials 记录 token 与 seat', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    ws.emit({ type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat: 1, token: 'tok-1' });
    expect(store.getState().token).toBe('tok-1');
    expect(store.getState().seat).toBe(1);
  });

  it('snapshot 更新 snapshot/legalActions/seq', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    const filtered = filterStateFor(gameFixture());
    const legalActions = [{ type: 'burn' as const }];
    ws.emit({
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      seq: 7,
      state: filtered,
      legalActions,
    });
    const s = store.getState();
    // 消息经 JSON 序列化往返，按值比较而非引用
    expect(s.snapshot).toStrictEqual(filtered);
    expect(s.legalActions).toEqual(legalActions);
    expect(s.seq).toBe(7);
  });

  it('action_applied 追加日志：全量保留（事件日志完整历史，不再环形截断）', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    for (let i = 0; i < 205; i++) {
      ws.emit({
        type: 'action_applied',
        protocolVersion: PROTOCOL_VERSION,
        seq: i,
        player: i % 4,
        action: { type: 'pass', booster: null },
        events: [],
      });
    }
    const log = store.getState().log;
    expect(log).toHaveLength(205);
    expect(log[0]?.seq).toBe(0);
    expect(log[204]?.seq).toBe(204);
  });

  it('snapshot 带全量 log 时直接采用（重连/undo 后与服务器一致）', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    const game = newGame({ playerCount: 2, seed: 1, factions: ['terrans', 'xenos'], lostFleet: true });
    ws.emit({
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      seq: 2,
      state: filterStateFor(game),
      legalActions: [],
      log: [
        { seq: 0, player: 0, action: { type: 'place-initial-mine', hex: '0,0' } },
        { seq: 1, player: 1, action: { type: 'place-initial-mine', hex: '1,0' } },
      ],
    });
    const log = store.getState().log;
    expect(log).toHaveLength(2);
    expect(log[0]?.player).toBe(0);
    expect(log[1]?.action.type).toBe('place-initial-mine');
  });

  it('game_over 记录 winner 与 finalScores；error 记录 lastError', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    ws.emit({ type: 'error', protocolVersion: PROTOCOL_VERSION, code: 'not-your-turn', message: '没轮到你' });
    expect(store.getState().lastError).toEqual({ code: 'not-your-turn', message: '没轮到你' });
    ws.emit({ type: 'game_over', protocolVersion: PROTOCOL_VERSION, winner: [1], finalScores: [80, 95, 70, 60] });
    expect(store.getState().gameOver).toEqual({ winner: [1], finalScores: [80, 95, 70, 60] });
  });

  it('终局快照（phase=game-over）从状态推导 gameOver', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    const game = gameFixture();
    const filtered = { ...filterStateFor(game), phase: 'game-over' as const, winner: [2] };
    ws.emit({
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      seq: 9,
      state: filtered,
      legalActions: [],
    });
    expect(store.getState().gameOver).toEqual({
      winner: [2],
      finalScores: filtered.players.map((p) => p.vp),
    });
  });

  it('非法 JSON 帧被忽略，不影响后续消息', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    ws.onmessage?.({ data: '{not-json' });
    ws.emit({ type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat: 0, token: 't' });
    expect(store.getState().token).toBe('t');
  });

  it('ai_thinking 维护 thinkingSeats（幂等加入/移除）', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    ws.emit({ type: 'ai_thinking', protocolVersion: PROTOCOL_VERSION, seat: 1, thinking: true });
    ws.emit({ type: 'ai_thinking', protocolVersion: PROTOCOL_VERSION, seat: 1, thinking: true });
    expect(store.getState().thinkingSeats).toEqual([1]);
    ws.emit({ type: 'ai_thinking', protocolVersion: PROTOCOL_VERSION, seat: 1, thinking: false });
    expect(store.getState().thinkingSeats).toEqual([]);
  });
});

describe('GameStore 上行消息', () => {
  it('createRoom / joinRoom 发送带版本号的上行帧', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    store.createRoom('甲', { playerCount: 4, lostFleet: true, aiSeats: [{ difficulty: 'normal' }] });
    expect(ws.lastSent()).toEqual({
      type: 'create_room',
      protocolVersion: PROTOCOL_VERSION,
      nickname: '甲',
      config: { playerCount: 4, lostFleet: true, aiSeats: [{ difficulty: 'normal' }] },
    });
    store.joinRoom('ABCD', '乙');
    expect(ws.lastSent()).toEqual({
      type: 'join_room',
      protocolVersion: PROTOCOL_VERSION,
      code: 'ABCD',
      nickname: '乙',
    });
  });

  it('startGame / submitAction 自动带 token', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    ws.emit({ type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat: 0, token: 'tok-9' });
    store.startGame();
    expect(ws.lastSent()).toEqual({ type: 'start_game', protocolVersion: PROTOCOL_VERSION, token: 'tok-9' });
    store.submitAction({ type: 'pass', booster: 'booster1' });
    expect(ws.lastSent()).toEqual({
      type: 'submit_action',
      protocolVersion: PROTOCOL_VERSION,
      token: 'tok-9',
      action: { type: 'pass', booster: 'booster1' },
    });
  });

  it('未持 token 时 startGame / submitAction 抛错且不发帧', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    expect(() => store.startGame()).toThrow(/token/);
    expect(() => store.submitAction({ type: 'burn' })).toThrow(/token/);
    expect(ws.sent).toHaveLength(0);
  });

  it('draftPick / draftBid / draftConfirm 自动带 token', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    ws.emit({ type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat: 0, token: 'tok-9' });
    store.draftPick('terrans');
    expect(ws.lastSent()).toEqual({ type: 'draft_pick', protocolVersion: PROTOCOL_VERSION, token: 'tok-9', faction: 'terrans' });
    store.draftBid('xenos', 3);
    expect(ws.lastSent()).toEqual({ type: 'draft_bid', protocolVersion: PROTOCOL_VERSION, token: 'tok-9', faction: 'xenos', bid: 3 });
    store.draftConfirm();
    expect(ws.lastSent()).toEqual({ type: 'draft_confirm', protocolVersion: PROTOCOL_VERSION, token: 'tok-9' });
  });
});

describe('GameStore draft（种族选取）状态', () => {
  const DRAFT = {
    mode: 'friendly' as const,
    turnOrder: [0, 1],
    currentActor: 0,
    picks: { 0: null, 1: null },
    available: ['terrans', 'xenos'] as ('terrans' | 'xenos')[],
    finished: false,
  };

  it('draft_state 更新 draft；room_state drafting=false 时清空', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    expect(store.getState().draft).toBeNull();
    ws.emit({ type: 'draft_state', protocolVersion: PROTOCOL_VERSION, draft: DRAFT });
    expect(store.getState().draft).toEqual(DRAFT);
    // draft 中的 room_state（drafting=true）保留 draft 态
    ws.emit({
      type: 'room_state',
      protocolVersion: PROTOCOL_VERSION,
      room: roomFixture({ drafting: true }),
      yourSeat: 0,
    });
    expect(store.getState().draft).toEqual(DRAFT);
    // drafting=false（confirm 开局 / 中止）→ 清空
    ws.emit({
      type: 'room_state',
      protocolVersion: PROTOCOL_VERSION,
      room: roomFixture({ drafting: false }),
      yourSeat: 0,
    });
    expect(store.getState().draft).toBeNull();
  });

  it('snapshot（对局开始）清空 draft', () => {
    const { store } = setup();
    store.connect();
    const ws = lastWs();
    ws.open();
    ws.emit({ type: 'draft_state', protocolVersion: PROTOCOL_VERSION, draft: DRAFT });
    expect(store.getState().draft).not.toBeNull();
    const game = gameFixture();
    ws.emit({
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      seq: 0,
      state: filterStateFor(game),
      legalActions: [],
    });
    expect(store.getState().draft).toBeNull();
  });
});

describe('GameStore 断线与重连', () => {
  it('被动 close → disconnected，随后自动重连', async () => {
    const { store } = setup();
    store.connect();
    lastWs().open();
    expect(store.getState().connection).toBe('connected');
    lastWs().serverClose();
    expect(store.getState().connection).toBe('disconnected');
    await tick();
    expect(store.getState().connection).toBe('connecting');
    expect(FakeWebSocket.instances).toHaveLength(2);
    lastWs().open();
    expect(store.getState().connection).toBe('connected');
  });

  it('持 token 重连成功后自动发 resume（容忍同 token 被踢的被动 close）', async () => {
    const { store } = setup();
    store.connect();
    const ws1 = lastWs();
    ws1.open();
    ws1.emit({ type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat: 1, token: 'tok-kick' });
    // 另一标签页用同 token resume → 服务器踢掉本连接（无 connected=false 广播）
    ws1.serverClose();
    await tick();
    const ws2 = lastWs();
    expect(ws2).not.toBe(ws1);
    ws2.open();
    expect(ws2.lastSent()).toEqual({ type: 'resume', protocolVersion: PROTOCOL_VERSION, token: 'tok-kick' });
  });

  it('disconnect 为主动关闭：不触发自动重连', async () => {
    const { store } = setup();
    store.connect();
    lastWs().open();
    store.disconnect();
    expect(store.getState().connection).toBe('disconnected');
    await tick();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('disconnect 取消等待中的重连定时器', async () => {
    const { store } = setup(10_000);
    store.connect();
    lastWs().open();
    lastWs().serverClose();
    store.disconnect();
    await tick();
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(store.getState().connection).toBe('disconnected');
  });
});

describe('GameClient', () => {
  it('未 open 时 send 抛错', () => {
    FakeWebSocket.instances = [];
    const client = new GameClient('ws://test/ws', (url) => new FakeWebSocket(url));
    client.connect();
    expect(() => client.send({ type: 'ping', protocolVersion: PROTOCOL_VERSION })).toThrow(/未连接/);
  });

  it('重复 connect 不重复建连（connecting/open 幂等）', () => {
    FakeWebSocket.instances = [];
    const client = new GameClient('ws://test/ws', (url) => new FakeWebSocket(url));
    client.connect();
    client.connect();
    lastWs().open();
    client.connect();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});

describe('useGameStore', () => {
  it('组件读到最新状态并随消息更新', () => {
    const { store } = setup();
    const { result } = renderHook(() => useGameStore(store));
    expect(result.current.connection).toBe('disconnected');
    act(() => {
      store.connect();
      lastWs().open();
      lastWs().emit({
        type: 'credentials',
        protocolVersion: PROTOCOL_VERSION,
        seat: 3,
        token: 'tok-hook',
      });
    });
    expect(result.current.connection).toBe('connected');
    expect(result.current.seat).toBe(3);
  });
});

describe('GameStore token 持久化与恢复', () => {
  it('credentials + room_state 后 token 按房间号持久化到 storage', () => {
    const { store, storage } = setup();
    enterRoom(store);
    expect(storage.getItem('gaia:token:ABCD')).toBe('tok-A');
  });

  it('restoreSession 读到已存 token：connect 后自动 resume 抢回座位', () => {
    const storage = new FakeStorage();
    storage.setItem('gaia:token:WXYZ23', 'tok-old');
    const { store } = setup(0, { storage });
    expect(store.restoreSession()).toBe(true);
    expect(store.getState().token).toBe('tok-old');
    store.connect();
    const ws = lastWs();
    ws.open();
    expect(ws.lastSent()).toEqual({
      type: 'resume',
      protocolVersion: PROTOCOL_VERSION,
      token: 'tok-old',
    });
  });

  it('无已存 token 时 restoreSession 返回 false，connect 后不自动发 resume', () => {
    const { store } = setup();
    expect(store.restoreSession()).toBe(false);
    store.connect();
    const ws = lastWs();
    ws.open();
    expect(ws.sent).toHaveLength(0);
  });

  it('resume 失败（invalid-token / session-lost）→ 清 token 与持久化、回大厅态', () => {
    const storage = new FakeStorage();
    storage.setItem('gaia:token:WXYZ23', 'tok-dead');
    const { store } = setup(0, { storage });
    store.restoreSession();
    store.connect();
    const ws = lastWs();
    ws.open();
    ws.emit({
      type: 'error',
      protocolVersion: PROTOCOL_VERSION,
      code: 'session-lost',
      message: '对局已随服务器重启丢失',
    });
    const s = store.getState();
    expect(s.token).toBeNull();
    expect(s.room).toBeNull();
    expect(s.seat).toBeNull();
    expect(s.lastError?.code).toBe('session-lost');
    expect(storage.getItem('gaia:token:WXYZ23')).toBeNull();
  });
});

describe('GameStore 同座位多连接共存', () => {
  it('被动 close 一律自动重连（无接管态；重连后 open 自动 resume）', async () => {
    const storage = new FakeStorage();
    const { store } = setup(0, { storage });
    const ws = enterRoom(store);
    // 另一标签页用同 token 连上（服务端不再踢人）：本连接被服务端断开也直接重连
    ws.serverClose();
    await tick();
    expect(FakeWebSocket.instances).toHaveLength(2); // 已自动重连（connecting 中）
    const ws2 = lastWs();
    ws2.open();
    expect(ws2.lastSent()).toEqual({
      type: 'resume',
      protocolVersion: PROTOCOL_VERSION,
      token: 'tok-A',
    });
  });
});

describe('GameStore leaveRoom（返回大厅）', () => {
  it('清空持久化 token、重置状态、并以干净身份重连', () => {
    const storage = new FakeStorage();
    const { store } = setup(0, { storage });
    enterRoom(store);
    expect(storage.getItem('gaia:token:ABCD')).toBe('tok-A');
    store.leaveRoom();
    expect(storage.getItem('gaia:token:ABCD')).toBeNull();
    const s = store.getState();
    expect(s.token).toBeNull();
    expect(s.room).toBeNull();
    expect(s.seat).toBeNull();
    expect(s.snapshot).toBeNull();
    expect(s.gameOver).toBeNull();
    // 干净身份重连：新 ws，open 后不发 resume
    const ws = lastWs();
    ws.open();
    expect(ws.sent).toHaveLength(0);
    expect(store.getState().connection).toBe('connected');
  });
});

// ---------------------------------------------------------------------------
// 导入/导出 + 复盘回放状态机
// ---------------------------------------------------------------------------

/** 最小合法记录 fixture（store 层只做透传/状态迁移，不重放校验）。 */
function recordFixture(actions: unknown[] = []): GameRecord {
  return {
    version: 1,
    config: { playerCount: 2, seed: 7, factions: ['terrans', 'xenos'], lostFleet: true },
    actions: actions as GameRecord['actions'],
  };
}

describe('GameStore 导出对局（export_game → export_data 下载）', () => {
  it('exportGame 发送 export_game（带 token）', () => {
    const { store } = setup();
    const ws = enterRoom(store);
    store.exportGame();
    expect(ws.lastSent()).toEqual({ type: 'export_game', protocolVersion: PROTOCOL_VERSION, token: 'tok-A' });
  });

  it('export_data 应答触发下载：gaia-<房码>-<N>steps.json + 记录 JSON', () => {
    const downloads: { filename: string; text: string }[] = [];
    const { store } = setup(0, {
      download: (filename, text) => downloads.push({ filename, text }),
    });
    const ws = enterRoom(store);
    const record = recordFixture([{ type: 'pass', booster: null }, { type: 'burn' }, { type: 'pass', booster: null }]);
    ws.emit({ type: 'export_data', protocolVersion: PROTOCOL_VERSION, record });
    expect(downloads).toHaveLength(1);
    expect(downloads[0]?.filename).toBe('gaia-ABCD-3steps.json');
    expect(JSON.parse(downloads[0]?.text ?? '')).toEqual(record);
  });
});

describe('GameStore 导入复盘（import_game → 复盘模式）', () => {
  /** 大厅态（无房间）连接并发 import_game。 */
  function importFromLobby(store: GameStore, record: GameRecord): FakeWebSocket {
    store.connect();
    const ws = lastWs();
    ws.open();
    store.importGame(record);
    return ws;
  }

  it('importGame 发送 import_game（带记录，无需 token）', () => {
    const { store } = setup();
    const record = recordFixture();
    const ws = importFromLobby(store, record);
    expect(ws.lastSent()).toEqual({ type: 'import_game', protocolVersion: PROTOCOL_VERSION, record });
  });

  it('校验通过（snapshot 应答）→ 进入复盘模式，不落对局 snapshot', () => {
    const { store } = setup();
    const record = recordFixture([{ type: 'pass', booster: null }]);
    const ws = importFromLobby(store, record);
    ws.emit({
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      seq: 1,
      state: filterStateFor(gameFixture()),
      legalActions: [],
    });
    const s = store.getState();
    expect(s.review).toEqual({ record, step: 0, playing: false, speed: 1, viewSeat: 0 });
    expect(s.snapshot).toBeNull();
    expect(s.legalActions).toEqual([]);
    expect(s.lastError).toBeNull();
  });

  it('校验失败（error 应答）→ 停留大厅，lastError 展示', () => {
    const { store } = setup();
    const ws = importFromLobby(store, recordFixture());
    ws.emit({ type: 'error', protocolVersion: PROTOCOL_VERSION, code: 'import-invalid', message: '行动日志无法重放: boom' });
    const s = store.getState();
    expect(s.review).toBeNull();
    expect(s.lastError).toEqual({ code: 'import-invalid', message: '行动日志无法重放: boom' });
    // 失败后再来的 snapshot 按普通对局快照处理（不再被拦截）
    ws.emit({
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      seq: 1,
      state: filterStateFor(gameFixture()),
      legalActions: [],
    });
    expect(store.getState().review).toBeNull();
    expect(store.getState().snapshot).not.toBeNull();
  });
});

describe('GameStore 复盘回放状态机', () => {
  /** 进入复盘模式（3 步记录）。 */
  function enterReview(store: GameStore): GameRecord {
    const record = recordFixture([{ type: 'a' }, { type: 'b' }, { type: 'c' }]);
    store.connect();
    const ws = lastWs();
    ws.open();
    store.importGame(record);
    ws.emit({
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      seq: 3,
      state: filterStateFor(gameFixture()),
      legalActions: [],
    });
    return record;
  }

  it('setReviewStep 步进/跳转并 clamp 到 [0, 行动数]，且暂停连播', () => {
    const { store } = setup();
    enterReview(store);
    store.setReviewStep(2);
    expect(store.getState().review?.step).toBe(2);
    store.setReviewStep(99);
    expect(store.getState().review?.step).toBe(3);
    store.setReviewStep(-5);
    expect(store.getState().review?.step).toBe(0);
    store.reviewTogglePlay();
    expect(store.getState().review?.playing).toBe(true);
    store.setReviewStep(1);
    expect(store.getState().review?.playing).toBe(false);
  });

  it('reviewTogglePlay 播放/暂停；reviewTick 逐步推进，到结尾自动停播', () => {
    const { store } = setup();
    enterReview(store);
    store.reviewTogglePlay();
    expect(store.getState().review?.playing).toBe(true);
    store.reviewTick();
    store.reviewTick();
    expect(store.getState().review).toMatchObject({ step: 2, playing: true });
    store.reviewTick();
    expect(store.getState().review).toMatchObject({ step: 3, playing: false });
    // 停播后 tick 空转
    store.reviewTick();
    expect(store.getState().review?.step).toBe(3);
    // 暂停
    store.setReviewStep(1);
    store.reviewTogglePlay();
    store.reviewTogglePlay();
    expect(store.getState().review?.playing).toBe(false);
  });

  it('结尾再次播放 → 从头开始连播', () => {
    const { store } = setup();
    enterReview(store);
    store.setReviewStep(3);
    store.reviewTogglePlay();
    expect(store.getState().review).toMatchObject({ step: 0, playing: true });
  });

  it('setReviewSpeed 设置倍速；exitReview 退出复盘回大厅态', () => {
    const { store } = setup();
    enterReview(store);
    store.setReviewSpeed(4);
    expect(store.getState().review?.speed).toBe(4);
    store.exitReview();
    expect(store.getState().review).toBeNull();
    // 退出后回放操作安全空转
    store.setReviewStep(1);
    store.reviewTogglePlay();
    store.reviewTick();
    expect(store.getState().review).toBeNull();
  });
});
