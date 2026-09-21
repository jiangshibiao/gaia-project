/**
 * GameScreen v7 布局契约测试：
 * - 顶栏（行动按钮组在顶栏）+ 左栏两块（我的版图+科技/推进横条 / 对手版图 TAB）
 *   + 中央星图 + 右研究/计分栏；
 * - 右栏计分区：ScoreboardBoard 实图计分板（当前轮金框高亮）+ LF 第 7 高级板槽
 *   + 绿轨终局计数点 + 计分表弹层；
 * - 中央底部：左助推器池 + 右舰队 2×2（v7 舰队右移）；
 * - 旧底部栏（「研究 · 舰队」tab / 时代标记条）整体移除；
 * - 计分表并入右栏计分区（弹层）；事件日志为地图左下角可折叠浮层；
 * - 点面板"详情"弹完整详情 modal。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, filterStateFor } from '@gaia/protocol';
import { enumerateActions, mapNeighbors, newGame } from '@gaia/engine';
import type { HexKey } from '@gaia/engine';
import { App } from '../App';
import type { GameStore } from './store';
import { gameFixture, lastWs, roomFixture, setupStore } from '../test/fakes';
import type { FakeWebSocket } from '../test/fakes';

/** 渲染 App 并入座 + 推一个 setup 快照。 */
function renderInGame(store: GameStore, room?: Parameters<typeof roomFixture>[0]): FakeWebSocket {
  render(<App store={store} />);
  const ws = lastWs();
  act(() => {
    ws.open();
    ws.emit({ type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat: 0, token: 'tok-me' });
    ws.emit({
      type: 'room_state',
      protocolVersion: PROTOCOL_VERSION,
      room: roomFixture({ code: 'ABCD23', ...room }),
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
    expect(railR.querySelector('[data-testid="scoreboard-board"]')).not.toBeNull();
    expect(railR.querySelector('[data-testid="finals-progress"]')).not.toBeNull();
    // LF 第 7 高级板槽在计分区扩展条（不在研究板上）；回合/先手信息已下线
    expect(scoreboard?.querySelector('[data-testid="adv-extension"]')).not.toBeNull();
    expect(scoreboard?.querySelector('[data-testid="adv-slot-6"]')).not.toBeNull();
    expect(railR.querySelector('[data-testid="research-board"] [data-testid="adv-slot-6"]')).toBeNull();
    expect(railR.querySelector('[data-testid="scoring-round-info"]')).toBeNull();
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

  it('我的版图下方：科技/联邦片实图小横条（含高级板覆盖叠放）；推进片在右侧竖列', () => {
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
    // 未被覆盖的 tech2 + 高级板叠放（tech5 置灰垫下）；推进片在版图右侧竖列
    expect(strip?.querySelectorAll('img').length).toBeGreaterThanOrEqual(3);
    expect(strip?.querySelector('.tech-stack .covered')).not.toBeNull();
    expect(strip?.querySelector('.tech-stack .adv-top')).not.toBeNull();
    expect(mine.querySelector('[data-testid="side-booster-0"]')).not.toBeNull();
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

  it('ScoreboardBoard 当前轮高亮（进入第 1 轮后 tile-1 金框）', () => {
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
  });

  it('行动确认/撤销条：提交后浮出（增量实时计算），撤销发 undo，完成暂时收起', () => {
    const { store } = setupStore();
    const ws = renderInGame(store);
    // setup 快照（seq 1）已设回合检查点（actor=seat 0）
    expect(screen.queryByTestId('undo-bar')).toBeNull();
    // 推 seq 2：我的资源/VP 已变化、行动权交给 seat 1 → 浮条出现
    const game = gameFixture();
    const s2 = filterStateFor(game);
    s2.players[0]!.resources.ore -= 2;
    s2.players[0]!.vp += 5;
    s2.setupQueue = [1, 0, 1, 0, 1, 1, 1];
    act(() => {
      ws.emit({ type: 'action_applied', protocolVersion: PROTOCOL_VERSION, seq: 1, player: 0, action: { type: 'place-initial-mine', hex: '0,0' }, events: [] });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 2, state: s2, legalActions: [] });
    });
    const bar = screen.getByTestId('undo-bar');
    expect(bar).toBeInTheDocument();
    expect(screen.getByTestId('undo-delta').textContent).toContain('矿-2');
    expect(screen.getByTestId('undo-delta').textContent).toContain('VP+5');
    // 撤销 → 发送 undo
    fireEvent.click(screen.getByTestId('undo-turn'));
    expect(ws.lastSent()).toEqual({ type: 'undo', protocolVersion: PROTOCOL_VERSION, token: 'tok-me' });
    // 完成 → 收起；推 seq 3 再次提交 → 重新出现
    fireEvent.click(screen.getByTestId('undo-dismiss'));
    expect(screen.queryByTestId('undo-bar')).toBeNull();
    const s3 = filterStateFor(game);
    s3.players[0]!.resources.credits -= 1;
    s3.setupQueue = [1, 0, 1, 0, 1, 1, 1];
    act(() => {
      ws.emit({ type: 'action_applied', protocolVersion: PROTOCOL_VERSION, seq: 2, player: 0, action: { type: 'free-conversion', conversion: 'pw1-c' }, events: [] });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 3, state: s3, legalActions: [] });
    });
    expect(screen.getByTestId('undo-bar')).toBeInTheDocument();
  });

  it('撤销条：真人对手行动后消失（server 必拒不误导）；AI 对手行动不挡', () => {
    // 全真人房间：seat 0 行动 → 条显示；seat 1（真人）行动 → 条消失
    const { store } = setupStore();
    const ws = renderInGame(store);
    const game = gameFixture();
    const s2 = filterStateFor(game);
    s2.setupQueue = [1, 0, 1, 0, 1, 1, 1];
    act(() => {
      ws.emit({ type: 'action_applied', protocolVersion: PROTOCOL_VERSION, seq: 1, player: 0, action: { type: 'place-initial-mine', hex: '0,0' }, events: [] });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 2, state: s2, legalActions: [] });
    });
    expect(screen.getByTestId('undo-bar')).toBeInTheDocument();
    const s3 = filterStateFor(game);
    s3.setupQueue = [0, 1, 0, 1, 1, 1];
    act(() => {
      ws.emit({ type: 'action_applied', protocolVersion: PROTOCOL_VERSION, seq: 2, player: 1, action: { type: 'place-initial-mine', hex: '1,0' }, events: [] });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 3, state: s3, legalActions: [] });
    });
    expect(screen.queryByTestId('undo-bar')).toBeNull();
  });

  it('撤销条：AI 对手行动不挡（可一并回退，撤销仍可用）', () => {
    const { store } = setupStore();
    const ws = renderInGame(store, {
      seats: [
        { seat: 0, nickname: '甲', isAI: false, connected: true },
        { seat: 1, nickname: 'AI-1', isAI: true, connected: true },
        { seat: 2, nickname: 'AI-2', isAI: true, connected: true },
        { seat: 3, nickname: 'AI-3', isAI: true, connected: true },
      ],
    });
    const game = gameFixture();
    const s2 = filterStateFor(game);
    s2.setupQueue = [1, 0, 1, 0, 1, 1, 1];
    act(() => {
      ws.emit({ type: 'action_applied', protocolVersion: PROTOCOL_VERSION, seq: 1, player: 0, action: { type: 'place-initial-mine', hex: '0,0' }, events: [] });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 2, state: s2, legalActions: [] });
    });
    expect(screen.getByTestId('undo-bar')).toBeInTheDocument();
    const s3 = filterStateFor(game);
    s3.setupQueue = [0, 1, 0, 1, 1, 1];
    act(() => {
      ws.emit({ type: 'action_applied', protocolVersion: PROTOCOL_VERSION, seq: 2, player: 1, action: { type: 'place-initial-mine', hex: '1,0' }, events: [] });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 3, state: s3, legalActions: [] });
    });
    // AI 行动后撤销条仍在（server 允许回退 AI 行动）
    expect(screen.getByTestId('undo-bar')).toBeInTheDocument();
  });

  it('撤销条：被动充能响应不触发（充能不可撤销，不弹条骚扰）', () => {
    const { store } = setupStore();
    const ws = renderInGame(store);
    const game = gameFixture();
    const s2 = filterStateFor(game);
    s2.setupQueue = [1, 0, 1, 0, 1, 1, 1];
    act(() => {
      ws.emit({ type: 'action_applied', protocolVersion: PROTOCOL_VERSION, seq: 1, player: 0, action: { type: 'place-initial-mine', hex: '0,0' }, events: [] });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 2, state: s2, legalActions: [] });
    });
    expect(screen.getByTestId('undo-bar')).toBeInTheDocument();
    // 完成收起 → 对面回合我点充能 → 条不再弹出
    fireEvent.click(screen.getByTestId('undo-dismiss'));
    expect(screen.queryByTestId('undo-bar')).toBeNull();
    const s3 = filterStateFor(game);
    s3.setupQueue = [1, 0, 1, 0, 1, 1, 1];
    s3.pending = { kind: 'charge', queue: [{ player: 0, amount: 2, vpCost: 1 }] };
    act(() => {
      ws.emit({ type: 'action_applied', protocolVersion: PROTOCOL_VERSION, seq: 2, player: 0, action: { type: 'charge' }, events: [] });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 3, state: s3, legalActions: [] });
    });
    expect(screen.queryByTestId('undo-bar')).toBeNull();
  });

  it('撤销条：新一轮开始（round 前进）后自动隐藏——上轮行动后收入阶段不再挂条', () => {
    const { store } = setupStore();
    const ws = renderInGame(store);
    const game = gameFixture();
    const s2 = filterStateFor(game);
    s2.setupQueue = [1, 0, 1, 0, 1, 1, 1];
    act(() => {
      ws.emit({ type: 'action_applied', protocolVersion: PROTOCOL_VERSION, seq: 1, player: 0, action: { type: 'place-initial-mine', hex: '0,0' }, events: [] });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 2, state: s2, legalActions: [] });
    });
    expect(screen.getByTestId('undo-bar')).toBeInTheDocument();
    // 新一轮（收入结算完成，round 前进）→ 上轮撤销条自动隐藏
    const s3 = filterStateFor(game);
    s3.phase = 'action';
    s3.setupQueue = [];
    s3.currentPlayerIdx = 0;
    s3.round = s3.round + 1;
    act(() => {
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 3, state: s3, legalActions: [] });
    });
    expect(screen.queryByTestId('undo-bar')).toBeNull();
  });

  it('撤销条：轮初决策响应（terrans-gaia-done/盖亚兑换）不触发', () => {
    const { store } = setupStore();
    const ws = renderInGame(store);
    const game = gameFixture();
    const s2 = filterStateFor(game);
    s2.pending = { kind: 'terrans-gaia', player: 0 };
    act(() => {
      ws.emit({ type: 'action_applied', protocolVersion: PROTOCOL_VERSION, seq: 1, player: 0, action: { type: 'terrans-gaia-done' }, events: [] });
      ws.emit({ type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 2, state: s2, legalActions: [] });
    });
    expect(screen.queryByTestId('undo-bar')).toBeNull();
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

  it('计分表常驻挂在右栏计分区（无展开/收起交互）', () => {
    const { store } = setupStore();
    renderInGame(store);
    const scoreboard = screen.getByTestId('scoreboard');
    expect(scoreboard.querySelector('[data-testid="score-table"]')).not.toBeNull();
    expect(screen.queryByTestId('score-toggle')).toBeNull();
    expect(screen.queryByTestId('score-pop')).toBeNull();
  });

  it('组建联邦两步交互：点卫星格 → 确认 → 选项/供应区联邦片提交', () => {
    const { store } = setupStore();
    const ws = renderInGame(store);
    const game = gameFixture();
    const s = filterStateFor(game);
    s.phase = 'action';
    s.setupQueue = [];
    s.currentPlayerIdx = 0;
    const keys = Object.keys(s.map) as HexKey[];
    const empty = keys.filter((k) => s.map[k]!.planet === 'empty');
    const sat = empty[0]!;
    const hexes = [keys[1]!, keys[2]!, keys[3]!].sort();
    act(() => {
      ws.emit({
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: 2,
        state: s,
        legalActions: [
          { type: 'form-federation', hexes, satellites: [sat], token: 'fed2' },
          { type: 'form-federation', hexes, satellites: [sat], token: 'fed3' },
        ],
      });
    });
    // 点「组建联邦」→ 卫星选择条；0 颗且无 0 卫星候选 → 确认禁用
    fireEvent.click(screen.getByTestId('action-federation'));
    expect(screen.getByTestId('fed-sat-bar')).toBeInTheDocument();
    expect(screen.getByTestId('fed-sat-confirm')).toBeDisabled();
    // 棋盘高亮 = 候选卫星格（仅 1 格）；点击选中 → 已选 1 颗
    const clickable = document.querySelectorAll('polygon.hex-hit.clickable');
    expect(clickable.length).toBe(1);
    fireEvent.click(clickable[0]!);
    expect(screen.getByTestId('fed-sat-text').textContent).toContain('已选 1 颗');
    // 确认 → 星球组合唯一 → 直接进联邦片选择（选项按钮 + 供应区片均可点）
    fireEvent.click(screen.getByTestId('fed-sat-confirm'));
    expect(screen.getByTestId('fed-token-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('fed-token-fed2')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('fed-supply-fed3'));
    const sent = ws.lastSent() as { type: string; action?: { type: string; token?: string; satellites?: string[] } };
    expect(sent.type).toBe('submit_action');
    expect(sent.action?.type).toBe('form-federation');
    expect(sent.action?.token).toBe('fed3');
    expect(sent.action?.satellites).toEqual([sat]);
    // 提交后退出联邦交互态
    expect(screen.queryByTestId('fed-token-dialog')).toBeNull();
  });

  it('组建联邦：最少卫星快捷按钮（数量并列选邻接未殖民星球最少的）', () => {
    const { store } = setupStore();
    const ws = renderInGame(store);
    const game = gameFixture();
    const s = filterStateFor(game);
    s.phase = 'action';
    s.setupQueue = [];
    s.currentPlayerIdx = 0;
    const keys = Object.keys(s.map) as HexKey[];
    const adjPlanets = (k: HexKey): number =>
      mapNeighbors(s.map, k).filter((nb) => s.map[nb]!.planet !== 'empty').length;
    const emptyKeys = keys.filter((k) => s.map[k]!.planet === 'empty');
    const satY = emptyKeys.find((k) => adjPlanets(k) === 0) ?? emptyKeys[0]!;
    const satX = emptyKeys.find((k) => k !== satY && adjPlanets(k) >= 2) ?? emptyKeys.find((k) => k !== satY)!;
    const hexes = [keys[1]!, keys[2]!, keys[3]!].sort();
    act(() => {
      ws.emit({
        type: 'snapshot',
        protocolVersion: PROTOCOL_VERSION,
        seq: 2,
        state: s,
        legalActions: [
          { type: 'form-federation', hexes, satellites: [satX], token: 'fed2' },
          { type: 'form-federation', hexes, satellites: [satY], token: 'fed2' },
          { type: 'form-federation', hexes, satellites: [satX, satY].sort(), token: 'fed2' },
        ],
      });
    });
    fireEvent.click(screen.getByTestId('action-federation'));
    // 快捷按钮：最少卫星 1 颗；点击自动放置邻接星球最少的 satY
    const btn = screen.getByTestId('fed-best-sat');
    expect(btn.textContent).toContain('最少卫星（1）');
    fireEvent.click(btn);
    expect(screen.getByTestId('fed-sat-text').textContent).toContain('已选 1 颗');
    // 确认 → 匹配 [satY] 形状 → token 步提交后 satellites 恰为 [satY]
    fireEvent.click(screen.getByTestId('fed-sat-confirm'));
    fireEvent.click(screen.getByTestId('fed-token-fed2'));
    const sent = ws.lastSent() as { type: string; action?: { type: string; satellites?: string[] } };
    expect(sent.action?.type).toBe('form-federation');
    expect(sent.action?.satellites).toEqual([satY]);
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
