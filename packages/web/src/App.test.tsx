/**
 * App 路由测试（M2c）：条件渲染 大厅 ↔ 房间等待 ↔ 对局 ↔ 终局，
 * 外加"连接被另一标签页接管"画面与刷新自动 resume。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, filterStateFor } from '@gaia/protocol';
import type { ServerMessage } from '@gaia/protocol';
import { applyAction, enumerateActions } from '@gaia/engine';
import type { Action, HexKey } from '@gaia/engine';
import { App } from './App';
import type { GameStore } from './game/store';
import {
  FakeStorage,
  FakeWebSocket,
  gameFixture,
  lastWs,
  roomFixture,
  setupStore as storeSetup,
} from './test/fakes';

/** 渲染 App（useEffect 自动 connect）→ open → 入座（credentials + room_state）。 */
function renderInRoom(store: GameStore): FakeWebSocket {
  render(<App store={store} />);
  const ws = lastWs();
  act(() => {
    ws.open();
    ws.emit({ type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat: 0, token: 'tok-me' });
    ws.emit({
      type: 'room_state',
      protocolVersion: PROTOCOL_VERSION,
      room: roomFixture({ code: 'ABCD23' }),
      yourSeat: 0,
    });
  });
  return ws;
}

/** 推一个 setup 阶段快照（seat 0 为首个 setup 行动者时带 legalActions）。 */
function emitSnapshot(ws: FakeWebSocket): void {
  const game = gameFixture();
  const actor = game.setupQueue[0];
  act(() => {
    ws.emit({
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      seq: 1,
      state: filterStateFor(game),
      legalActions: actor === 0 ? enumerateActions(game, actor) : [],
    });
  });
}

describe('<App> 路由', () => {
  it('无房间：显示大厅（创建/加入表单）', () => {
    const { store } = storeSetup();
    render(<App store={store} />);
    expect(screen.getByTestId('create-form')).toBeInTheDocument();
    expect(screen.getByTestId('join-form')).toBeInTheDocument();
  });

  it('大厅创建表单：人数/lostFleet/AI/种族选取方案选项与提交', () => {
    const { store } = storeSetup();
    render(<App store={store} />);
    const ws = lastWs();
    act(() => ws.open());
    fireEvent.change(screen.getByTestId('create-nickname'), { target: { value: '甲' } });
    fireEvent.change(screen.getByTestId('create-player-count'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('create-ai-count'), { target: { value: '1' } });
    fireEvent.click(screen.getByTestId('create-lost-fleet')); // 关掉 lostFleet
    fireEvent.change(screen.getByTestId('create-faction-mode'), { target: { value: 'auction' } });
    fireEvent.click(screen.getByTestId('create-submit'));
    expect(ws.lastSent()).toEqual({
      type: 'create_room',
      protocolVersion: PROTOCOL_VERSION,
      nickname: '甲',
      config: { playerCount: 2, lostFleet: false, aiSeats: [{ difficulty: 'normal' }], factionMode: 'auction' },
    });
  });

  it('有房间无快照：显示房间等待视图（房间码 + 座位列表 + 开始按钮）', () => {
    const { store } = storeSetup();
    renderInRoom(store);
    expect(screen.getByTestId('room-code')).toHaveTextContent('ABCD23');
    expect(screen.getByTestId('seat-0')).toHaveTextContent('甲');
    expect(screen.getByTestId('start-game')).toBeEnabled();
  });

  it('有快照：进入对局画面（棋盘 + 研究板 + 行动栏 + 玩家面板）', () => {
    const { store } = storeSetup();
    const ws = renderInRoom(store);
    emitSnapshot(ws);
    expect(screen.getByTestId('game-screen')).toBeInTheDocument();
    expect(screen.getByTestId('research-board')).toBeInTheDocument();
    expect(screen.getByTestId('action-bar')).toBeInTheDocument();
    expect(screen.getByTestId('player-mat-0')).toBeInTheDocument();
    // setup 阶段无文字横幅（放置引导仅靠棋盘 hex 高亮）
    expect(screen.queryByTestId('setup-banner')).not.toBeInTheDocument();
    // 大厅已卸载
    expect(screen.queryByTestId('create-form')).not.toBeInTheDocument();
  });

  it('setup 阶段：起始矿类别按钮 → 棋盘高亮 → 点选即直接提交（无确认条/暂结闸）', () => {
    const { store } = storeSetup();
    const ws = renderInRoom(store);
    const game = gameFixture();
    // 强制 seat 0 为首个 setup 行动者
    expect(game.setupQueue[0]).toBe(0);
    const legal = enumerateActions(game, game.setupQueue[0]!);
    act(() => {
      ws.emit({
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: 1,
        state: filterStateFor(game),
        legalActions: legal, // setupQueue[0] === 0（turnOrder 即座位序），seat 0 为首个行动者
      });
    });
    fireEvent.click(screen.getByTestId('action-setup-mine'));
    // 棋盘出现高亮热区
    const clickable = document.querySelectorAll('polygon.hex-hit.clickable');
    expect(clickable.length).toBeGreaterThan(0);
    fireEvent.click(clickable[0]!);
    // 点选目的地即直接提交服务器：无确认条、无暂结条（撤销条兜底）
    expect(screen.queryByTestId('confirm-bar')).toBeNull();
    expect(screen.queryByTestId('pending-commit-bar')).toBeNull();
    const sent = ws.lastSent() as { type: string; action?: { type: string } };
    expect(sent.type).toBe('submit_action');
    expect(sent.action?.type).toBe('place-initial-mine');
  });

  it('行动红框：服务器回播 action_applied 即标出（地图 hex + 版图解锁槽）；AI 爬轨行动到达格标红', () => {
    const { store } = storeSetup();
    const ws = renderInRoom(store);
    const game = gameFixture();
    expect(game.setupQueue[0]).toBe(0);
    act(() => {
      ws.emit({
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: 1,
        state: filterStateFor(game),
        legalActions: enumerateActions(game, game.setupQueue[0]!),
      });
    });
    fireEvent.click(screen.getByTestId('action-setup-mine'));
    fireEvent.click(document.querySelectorAll('polygon.hex-hit.clickable')[0]!);
    // 已直提；取回提交的 hex 构造服务器回播
    const sent = ws.lastSent() as { type: string; action?: { type: string; hex?: string } };
    expect(sent.action?.type).toBe('place-initial-mine');
    const placed: Action = { type: 'place-initial-mine', hex: sent.action!.hex! as HexKey };
    const after = applyAction(game, placed, { assumeLegal: true });
    act(() => {
      ws.emit({
        type: 'action_applied',
        protocolVersion: PROTOCOL_VERSION,
        seq: 1,
        player: 0,
        action: placed,
        events: [],
      });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 2, state: filterStateFor(after), legalActions: [] });
    });
    // 回播即标：地图 hex 红框 + 版图解锁槽红框（全员可见）
    expect(document.querySelector('polygon.hex-flash')).not.toBeNull();
    expect(screen.getByTestId('mat-flash-slot-0')).toBeInTheDocument();
    // AI 爬轨行动：action_applied 日志 + 快照 → 轨道到达格红框
    const s2 = filterStateFor(after);
    s2.players[1]!.research.terra = 1;
    act(() => {
      ws.emit({
        type: 'action_applied',
        protocolVersion: PROTOCOL_VERSION,
        seq: 2,
        player: 1,
        action: { type: 'research', track: 'terra' },
        events: [],
      });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 3, state: s2, legalActions: [] });
    });
    expect(screen.getByTestId('rb-flash-terra')).toBeInTheDocument();
  });

  it('被动充能响应不走确认闸门：直接提交，无暂结条', () => {
    const { store } = storeSetup();
    const ws = renderInRoom(store);
    const game = gameFixture();
    const s = filterStateFor(game);
    s.pending = { kind: 'charge', queue: [{ player: 0, amount: 2, vpCost: 1 }] };
    act(() => {
      ws.emit({
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: 1,
        state: s,
        legalActions: [{ type: 'charge', amount: 2 }, { type: 'decline-charge' }],
      });
    });
    fireEvent.click(screen.getByTestId('charge-accept'));
    // 直接提交服务器，无确认闸门条
    const sent = ws.lastSent() as { type: string; action?: { type: string } };
    expect(sent.type).toBe('submit_action');
    expect(sent.action?.type).toBe('charge');
    expect(screen.queryByTestId('pending-commit-bar')).toBeNull();
  });

  it('免费兑换/烧脑不走确认闸门：直接提交，无暂结条（后悔走整回合撤销）', () => {
    const { store } = storeSetup();
    const ws = renderInRoom(store);
    const game = gameFixture();
    const s = filterStateFor(game);
    // 主阶段轮到我（setup 态无兑换：直接改阶段字段，legalActions 塞兑换项）
    s.phase = 'action';
    s.setupQueue = [];
    s.currentPlayerIdx = 0;
    act(() => {
      ws.emit({
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: 1,
        state: s,
        legalActions: [{ type: 'free-conversion', conversion: 'pw1-c' }, { type: 'pass', booster: 'booster1' }],
      });
    });
    fireEvent.click(screen.getByTestId('convert-toggle'));
    fireEvent.click(screen.getByTestId('convert-pw1-c'));
    // 直接提交服务器，无确认闸门条
    const sent = ws.lastSent() as { type: string; action?: { type: string; conversion?: string } };
    expect(sent.type).toBe('submit_action');
    expect(sent.action?.type).toBe('free-conversion');
    expect(sent.action?.conversion).toBe('pw1-c');
    expect(screen.queryByTestId('pending-commit-bar')).toBeNull();
  });

  it('主阶段建矿：点选棋盘即直接提交（无确认条/暂结闸）', () => {
    const { store } = storeSetup();
    const ws = renderInRoom(store);
    const game = gameFixture();
    const s = filterStateFor(game);
    s.phase = 'action';
    s.setupQueue = [];
    s.currentPlayerIdx = 0;
    const hexes = Object.keys(s.map).slice(0, 3);
    act(() => {
      ws.emit({
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: 1,
        state: s,
        legalActions: hexes.map((hex) => ({ type: 'build-mine', hex: hex as HexKey })),
      });
    });
    fireEvent.click(screen.getByTestId('action-mine'));
    const clickable = document.querySelectorAll('polygon.hex-hit.clickable');
    expect(clickable.length).toBeGreaterThan(0);
    fireEvent.click(clickable[0]!);
    // 点选目的地即直接提交服务器：无确认条、无暂结条（撤销条兜底）
    expect(screen.queryByTestId('confirm-bar')).toBeNull();
    expect(screen.queryByTestId('pending-commit-bar')).toBeNull();
    const sent = ws.lastSent() as { type: string; action?: { type: string } };
    expect(sent.type).toBe('submit_action');
    expect(sent.action?.type).toBe('build-mine');
  });

  it('终局：保留对局界面，结算弹窗显示胜者；离开对局清空 token 回大厅', () => {
    const { store, storage } = storeSetup();
    const ws = renderInRoom(store);
    expect(storage.getItem('gaia:token:ABCD23')).toBe('tok-me');
    emitSnapshot(ws);
    act(() => {
      ws.emit({
        type: 'game_over',
        protocolVersion: PROTOCOL_VERSION,
        winner: [1],
        finalScores: [80, 95, 70, 60],
      } satisfies ServerMessage);
    });
    expect(screen.getByTestId('game-screen')).toBeInTheDocument();
    expect(screen.getByTestId('winner-line')).toHaveTextContent('乙');
    fireEvent.click(screen.getByTestId('leave-after-game'));
    expect(screen.getByTestId('create-form')).toBeInTheDocument();
    expect(storage.getItem('gaia:token:ABCD23')).toBeNull();
    expect(store.getState().gameOver).toBeNull();
  });

  it('同座位多连接共存：被动断开后自动重连并 resume（无接管画面）', async () => {
    const storage = new FakeStorage();
    const { store } = storeSetup(0, { storage });
    const ws = renderInRoom(store);
    // 另一标签页同 token 连上（服务端不再踢人）：本连接被断也直接自动重连
    act(() => ws.serverClose());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const ws2 = lastWs();
    expect(ws2).not.toBe(ws);
    act(() => ws2.open());
    expect(ws2.lastSent()).toEqual({
      type: 'resume',
      protocolVersion: PROTOCOL_VERSION,
      token: 'tok-me',
    });
    // 仍在房间内（无接管提示画面）
    expect(screen.queryByTestId('create-form')).not.toBeInTheDocument();
  });

  it('刷新恢复：storage 有 token 时渲染即自动 connect + resume', () => {
    const storage = new FakeStorage();
    storage.setItem('gaia:token:WXYZ99', 'tok-saved');
    const { store } = storeSetup(0, { storage });
    render(<App store={store} />);
    const ws = lastWs();
    act(() => ws.open());
    expect(ws.lastSent()).toEqual({
      type: 'resume',
      protocolVersion: PROTOCOL_VERSION,
      token: 'tok-saved',
    });
  });
});
