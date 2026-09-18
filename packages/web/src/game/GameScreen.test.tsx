/**
 * GameScreen v7 布局契约测试：
 * - 顶栏（行动按钮组在顶栏）+ 左栏两块（我的版图+科技/推进横条 / 对手版图 TAB）
 *   + 中央星图 + 右研究/计分栏；
 * - 右栏计分区：RoundArc（当前轮金框高亮）+ AdvExtension（LF 第 7 高级板槽）
 *   + FinalsProgress + 回合/先手一行；
 * - 中央底部：左助推器池 + 右舰队 2×2（v7 舰队右移）；
 * - 旧底部栏（「研究 · 舰队」tab / 时代标记条）整体移除；
 * - 计分表并入右栏计分区（弹层）；事件日志为地图左下角可折叠浮层；
 * - 点面板"详情"弹完整详情 modal。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, filterStateFor } from '@gaia/protocol';
import { enumerateActions, newGame } from '@gaia/engine';
import { App } from '../App';
import type { GameStore } from './store';
import { gameFixture, lastWs, roomFixture, setupStore } from '../test/fakes';
import type { FakeWebSocket } from '../test/fakes';

/** 渲染 App 并入座 + 推一个 setup 快照。 */
function renderInGame(store: GameStore): FakeWebSocket {
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
  const game = gameFixture();
  act(() => {
    ws.emit({
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      seq: 1,
      state: filterStateFor(game),
      legalActions: game.setupQueue[0] === 0 ? enumerateActions(game, 0) : [],
    });
  });
  return ws;
}

describe('<GameScreen> v6 布局契约', () => {
  it('三栏存在：左栏两块（我的版图 + 对手版图 TAB）+ 中央星图 + 右研究/计分栏', () => {
    const { store } = setupStore();
    renderInGame(store);
    const railL = screen.getByTestId('rail-l');
    // 上块：我的版图（seat 0）
    const mine = screen.getByTestId('rail-mine');
    expect(mine.querySelector('[data-testid="player-mat-0"]')).not.toBeNull();
    // 下块：默认选中第一个对手（玩家 1），其余对手在 TAB 后隐藏
    const opponents = screen.getByTestId('rail-opponents');
    expect(opponents.querySelector('[data-testid="player-mat-1"]')).not.toBeNull();
    expect(railL.querySelector('[data-testid="player-mat-2"]')).toBeNull();
    expect(railL.querySelector('[data-testid="player-mat-3"]')).toBeNull();
    // TAB 细条：3 个对手各一个 tab
    const tabs = screen.getByTestId('opp-tabs');
    for (const i of [1, 2, 3]) {
      expect(tabs.querySelector(`[data-testid="opp-tab-${i}"]`)).not.toBeNull();
    }
    expect(screen.getByTestId('board-wrap')).toBeInTheDocument();
    const railR = screen.getByTestId('rail-r');
    expect(railR.querySelector('[data-testid="research-board"]')).not.toBeNull();
    const scoreboard = railR.querySelector('[data-testid="scoreboard"]');
    expect(scoreboard).not.toBeNull();
    expect(railR.querySelector('[data-testid="round-arc"]')).not.toBeNull();
    expect(railR.querySelector('[data-testid="finals-progress"]')).not.toBeNull();
    // LF 第 7 高级板槽在计分区扩展条（不在研究板上）
    expect(scoreboard?.querySelector('[data-testid="adv-extension"]')).not.toBeNull();
    expect(scoreboard?.querySelector('[data-testid="adv-slot-6"]')).not.toBeNull();
    expect(railR.querySelector('[data-testid="research-board"] [data-testid="adv-slot-6"]')).toBeNull();
    expect(railR.querySelector('[data-testid="scoring-round-info"]')?.textContent).toContain('/6');
  });

  it('对手 TAB 点击切换版图，当前行动者 tab 带指示点', () => {
    const { store } = setupStore();
    renderInGame(store);
    const railL = screen.getByTestId('rail-l');
    // setup 阶段当前行动者 = 玩家 0（我自己），对手 tab 无指示点
    expect(screen.queryByTestId('opp-tab-actor-1')).toBeNull();
    // 切到玩家 3 → 显示玩家 3 版图，玩家 1 版图消失
    fireEvent.click(screen.getByTestId('opp-tab-3'));
    expect(screen.getByTestId('opp-tab-3').getAttribute('aria-selected')).toBe('true');
    expect(railL.querySelector('[data-testid="player-mat-3"]')).not.toBeNull();
    expect(railL.querySelector('[data-testid="player-mat-1"]')).toBeNull();
    // 我的版图不受切换影响
    expect(screen.getByTestId('rail-mine').querySelector('[data-testid="player-mat-0"]')).not.toBeNull();
    // 切回玩家 2
    fireEvent.click(screen.getByTestId('opp-tab-2'));
    expect(railL.querySelector('[data-testid="player-mat-2"]')).not.toBeNull();
    expect(railL.querySelector('[data-testid="player-mat-3"]')).toBeNull();
  });

  it('2 人局：唯一对手直接显示，无 TAB 条', () => {
    const { store } = setupStore();
    render(<App store={store} />);
    const ws = lastWs();
    act(() => {
      ws.open();
      ws.emit({ type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat: 0, token: 'tok-me' });
      ws.emit({
        type: 'room_state',
        protocolVersion: PROTOCOL_VERSION,
        room: roomFixture({
          config: { playerCount: 2, lostFleet: true },
          seats: [
            { seat: 0, nickname: '甲', isAI: false, connected: true },
            { seat: 1, nickname: '乙', isAI: false, connected: true },
          ],
        }),
        yourSeat: 0,
      });
    });
    const game = newGame({ playerCount: 2, seed: 42, factions: ['terrans', 'xenos'], lostFleet: true });
    act(() => {
      ws.emit({
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: 1,
        state: filterStateFor(game),
        legalActions: [],
      });
    });
    const railL = screen.getByTestId('rail-l');
    expect(screen.queryByTestId('opp-tabs')).toBeNull();
    expect(railL.querySelector('[data-testid="player-mat-0"]')).not.toBeNull();
    expect(railL.querySelector('[data-testid="player-mat-1"]')).not.toBeNull();
  });

  it('我的版图下方：科技板/推进片实图小横条（含高级板覆盖叠放）', () => {
    const { store } = setupStore();
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
    const game = gameFixture();
    const state = filterStateFor(game);
    state.players[0]!.techTiles = ['tech2', 'tech5'];
    state.players[0]!.advTechTiles = [{ id: 'advtech3', covers: 'tech5' }];
    state.players[0]!.booster = 'booster4';
    act(() => {
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 1, state, legalActions: [] });
    });
    const mine = screen.getByTestId('rail-mine');
    const strip = mine.querySelector('[data-testid="tech-booster-strip-0"]');
    expect(strip).not.toBeNull();
    // 未被覆盖的 tech2 + 高级板叠放（tech5 置灰垫下）+ 推进片
    expect(strip?.querySelectorAll('img').length).toBeGreaterThanOrEqual(4);
    expect(strip?.querySelector('.tech-stack .covered')).not.toBeNull();
    expect(strip?.querySelector('.tech-stack .adv-top')).not.toBeNull();
    // 对手块不渲染该横条
    expect(screen.getByTestId('rail-opponents').querySelector('.tech-booster-strip')).toBeNull();
  });

  it('行动按钮在顶栏（主九个常驻，setup 类别可用时高亮）', () => {
    const { store } = setupStore();
    renderInGame(store);
    const topbar = screen.getByTestId('top-action-bar');
    for (const id of ['mine', 'gaia-project', 'upgrade', 'research', 'federation', 'explore', 'power', 'special', 'pass']) {
      expect(topbar.querySelector(`[data-testid="action-${id}"]`)).not.toBeNull();
    }
    // setup 阶段：放起始矿可用（高亮可点），主行动不可用（置灰禁用）
    expect(screen.getByTestId('action-setup-mine')).toBeEnabled();
    expect(screen.getByTestId('action-mine')).toBeDisabled();
    expect(screen.getByTestId('leave-game')).toBeInTheDocument();
  });

  it('RoundArc 当前轮高亮（进入第 1 轮后 tile-1 金框）', () => {
    const { store } = setupStore();
    const ws = renderInGame(store);
    // setup（round=0）：无当前轮、无置灰
    expect(screen.getByTestId('round-arc-tile-1').className).not.toContain('cur');
    // 推一个 round=1 的快照：tile-1 高亮、后续轮不置灰
    const game = gameFixture();
    const state = filterStateFor(game);
    state.round = 1;
    act(() => {
      ws.emit({
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: 2,
        state,
        legalActions: [],
      });
    });
    expect(screen.getByTestId('round-arc-tile-1').className).toContain('cur');
    expect(screen.getByTestId('round-arc-tile-2').className).not.toContain('past');
    expect(screen.getByTestId('round-arc-num-1')).toHaveTextContent('1');
  });

  it('旧底部栏整体移除（无 tab / 合并面板 / 时代标记条）', () => {
    const { store } = setupStore();
    renderInGame(store);
    expect(screen.queryByTestId('tab-research-fleet')).toBeNull();
    expect(screen.queryByTestId('tab-scoring')).toBeNull();
    expect(screen.queryByTestId('research-fleet-panel')).toBeNull();
    expect(screen.queryByTestId('scoring-panel')).toBeNull();
    expect(screen.queryByTestId('bottom-collapse')).toBeNull();
  });

  it('中央底部：舰队面板 + 助推器池横条', () => {
    const { store } = setupStore();
    renderInGame(store);
    expect(screen.getByTestId('fleet-panel')).toBeInTheDocument();
    expect(screen.getByTestId('ship-card-twilight')).toBeInTheDocument();
    expect(screen.getByTestId('boosters-strip')).toBeInTheDocument();
  });

  it('计分表并入右栏计分区：toggle 打开/关闭弹层', () => {
    const { store } = setupStore();
    renderInGame(store);
    expect(screen.queryByTestId('score-pop')).toBeNull();
    fireEvent.click(screen.getByTestId('score-toggle'));
    expect(screen.getByTestId('score-pop')).toBeInTheDocument();
    expect(screen.getByTestId('score-table')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('score-toggle'));
    expect(screen.queryByTestId('score-pop')).toBeNull();
  });

  it('事件日志为地图内可折叠浮层', () => {
    const { store } = setupStore();
    renderInGame(store);
    const mapArea = document.querySelector('.map-area');
    expect(mapArea?.querySelector('.log-panel')).not.toBeNull();
    expect(screen.queryByTestId('log-list')).toBeNull();
    fireEvent.click(screen.getByTestId('log-toggle'));
    expect(screen.getByTestId('log-list')).toBeInTheDocument();
  });

  it('点面板"详情"弹完整详情 modal（含爬轨 mini 条），可关闭', () => {
    const { store } = setupStore();
    renderInGame(store);
    fireEvent.click(screen.getByTestId('mat-detail-1'));
    expect(screen.getByTestId('player-detail')).toBeInTheDocument();
    // 资源行内科技轨道高度（右对齐，两模式都显示）
    expect(document.querySelectorAll('.mat-research-inline').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId('close-player-detail'));
    expect(screen.queryByTestId('player-detail')).toBeNull();
  });

  it('面板矿 pointerdown 发起拖拽：ghost 出现 + 合法落点高亮；松手（无 CTM 吸附失败）弹回', () => {
    const { store } = setupStore();
    renderInGame(store);
    const mine = document.querySelector<HTMLElement>('.rail-l .mat-bld[data-b="mine"]');
    expect(mine).not.toBeNull();
    expect(mine?.className).toContain('draggable');
    expect(document.querySelectorAll('.hex-highlight')).toHaveLength(0);
    fireEvent.pointerDown(mine!, { clientX: 100, clientY: 100 });
    // ghost 跟随光标 + 起始矿合法落点高亮（setup 阶段 seed42 共 6 格）
    expect(screen.getByTestId('bld-drag-ghost')).toBeInTheDocument();
    expect(document.querySelectorAll('.hex-highlight').length).toBeGreaterThan(0);
    // jsdom 无 getScreenCTM → 吸附失败 → 松手弹回，不产生选择
    fireEvent.pointerUp(window, { clientX: 200, clientY: 200 });
    expect(screen.queryByTestId('bld-drag-ghost')).toBeNull();
    expect(document.querySelectorAll('.hex-highlight')).toHaveLength(0);
    expect(screen.queryByTestId('selection-dialog')).toBeNull();
  });

  it('power 行动格直点（未在选择态）→ 开选择并预填行动格', () => {
    const { store } = setupStore();
    const ws = renderInGame(store);
    // 推一个含 power-action 的快照（setup 态 actor=0，仅验证直点通路）
    const game = gameFixture();
    act(() => {
      ws.emit({
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: 2,
        state: filterStateFor(game),
        legalActions: [{ type: 'power-action', action: 'power1' }],
      });
    });
    const cell = screen.getByTestId('board-action-power1');
    expect(cell.className).toContain('direct');
    expect(cell).toBeEnabled();
    fireEvent.click(cell);
    // 单候选 → 直接进确认条
    expect(screen.getByTestId('confirm-bar')).toBeInTheDocument();
    // 未在 legalActions 的格保持禁用
    expect(screen.getByTestId('board-action-power2')).toBeDisabled();
  });
});
