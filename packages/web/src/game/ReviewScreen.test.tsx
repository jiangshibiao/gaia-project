/**
 * ReviewScreen（复盘回放）契约：
 * - 回放控制条代替行动栏：⏮ 开头 / ◀ 上一步 / 播放暂停 / ▶ 下一步 / ⏭ 结尾
 *   / 速度 1×2×4× / 可拖进度条 + 步数 / 退出复盘；对局行动按钮全部消失；
 * - 只读复用对局部件（棋盘/族板/研究板/计分区），不接选择机；
 * - 每步显示该步行动描述（describeAction）与当前行动者；
 * - 步进 / 拖进度条跳转 / 连播（到结尾自动停）/ 退出回大厅；
 * - 记录无法本地重放 → 显示错误并停止。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, actorOf, filterStateFor } from '@gaia/protocol';
import type { GameRecord } from '@gaia/protocol';
import { applyAction, enumerateActions, newGame } from '@gaia/engine';
import type { Action, GameConfig } from '@gaia/engine';
import { App } from '../App';
import { describeAction } from './display';
import type { GameStore } from './store';
import { lastWs, setupStore } from '../test/fakes';

/** 真实记录 fixture：engine 逐条取首个合法行动（setup 起），保证可重放。 */
function recordFixture(steps = 6): GameRecord {
  const config: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'xenos'], lostFleet: true };
  let state = newGame(config);
  const actions: Action[] = [];
  for (let i = 0; i < steps; i++) {
    const actor = actorOf(state);
    if (actor === null) break;
    const legal = enumerateActions(state, actor);
    const a = legal[0];
    if (a === undefined) break;
    actions.push(a);
    state = applyAction(state, a);
  }
  return { version: 1, config, actions };
}

/** 大厅连接 → importGame → 服务器校验通过（snapshot 应答）→ App 进入复盘模式。 */
function renderReview(store: GameStore, record: GameRecord): void {
  render(<App store={store} />);
  const ws = lastWs();
  act(() => {
    ws.open();
    store.importGame(record);
  });
  act(() => {
    ws.emit({
      type: 'snapshot',
      protocolVersion: PROTOCOL_VERSION,
      seq: record.actions.length,
      state: filterStateFor(newGame(record.config)),
      legalActions: [],
    });
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe('<ReviewScreen> 复盘回放', () => {
  it('回放控制条代替行动栏：控件齐全，无对局行动按钮，只读部件在', () => {
    const { store } = setupStore();
    renderReview(store, recordFixture());
    expect(screen.getByTestId('review-screen')).toBeInTheDocument();
    expect(screen.getByTestId('review-controls')).toBeInTheDocument();
    for (const id of ['review-first', 'review-prev', 'review-play', 'review-next', 'review-last', 'review-scrub', 'review-progress', 'review-exit']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
    for (const sp of [1, 2, 4]) {
      expect(screen.getByTestId(`review-speed-${sp}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId('review-progress').textContent).toBe('0/6');
    // 行动栏/操作按钮全部消失
    expect(screen.queryByTestId('top-action-bar')).toBeNull();
    expect(screen.queryByTestId('action-mine')).toBeNull();
    expect(screen.queryByTestId('convert-toggle')).toBeNull();
    // 只读部件复用：棋盘 / 族板 / 研究板 / 计分区
    expect(screen.getByTestId('board-wrap')).toBeInTheDocument();
    expect(screen.getByTestId('rail-l').querySelector('[data-testid="player-mat-0"]')).not.toBeNull();
    expect(screen.getByTestId('rail-r').querySelector('[data-testid="research-board"]')).not.toBeNull();
    expect(screen.getByTestId('scoreboard')).toBeInTheDocument();
    // 开局步描述
    expect(screen.getByTestId('review-step-desc').textContent).toContain('开局');
  });

  it('下一步/上一步：步数变化并显示该步行动描述与当前行动者', () => {
    const { store } = setupStore();
    const record = recordFixture();
    renderReview(store, record);
    fireEvent.click(screen.getByTestId('review-next'));
    expect(screen.getByTestId('review-progress').textContent).toBe('1/6');
    expect(screen.getByTestId('review-step-desc').textContent).toContain(`#1`);
    expect(screen.getByTestId('review-step-desc').textContent).toContain(describeAction(record.actions[0]!));
    expect(screen.getByTestId('review-actor').textContent).toContain('轮到：');
    fireEvent.click(screen.getByTestId('review-last'));
    expect(screen.getByTestId('review-progress').textContent).toBe('6/6');
    fireEvent.click(screen.getByTestId('review-prev'));
    expect(screen.getByTestId('review-progress').textContent).toBe('5/6');
    fireEvent.click(screen.getByTestId('review-first'));
    expect(screen.getByTestId('review-progress').textContent).toBe('0/6');
  });

  it('进度条可拖动到任意步', () => {
    const { store } = setupStore();
    renderReview(store, recordFixture());
    fireEvent.change(screen.getByTestId('review-scrub'), { target: { value: '4' } });
    expect(screen.getByTestId('review-progress').textContent).toBe('4/6');
    expect(screen.getByTestId('review-step-desc').textContent).toContain('#4');
  });

  it('播放连播：定时推进，到结尾自动停播；结尾再播放从头开始', () => {
    vi.useFakeTimers();
    const { store } = setupStore();
    renderReview(store, recordFixture());
    fireEvent.click(screen.getByTestId('review-play'));
    expect(store.getState().review?.playing).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(store.getState().review?.step).toBe(1);
    act(() => {
      vi.advanceTimersByTime(1200 * 10);
    });
    // 到结尾（6 步）自动停播
    expect(store.getState().review).toMatchObject({ step: 6, playing: false });
    fireEvent.click(screen.getByTestId('review-play'));
    expect(store.getState().review).toMatchObject({ step: 0, playing: true });
    act(() => {
      vi.advanceTimersByTime(1200);
    });
    expect(store.getState().review?.step).toBe(1);
    // 暂停
    fireEvent.click(screen.getByTestId('review-play'));
    expect(store.getState().review?.playing).toBe(false);
  });

  it('速度切换：4× 下连播间隔缩短', () => {
    vi.useFakeTimers();
    const { store } = setupStore();
    renderReview(store, recordFixture());
    fireEvent.click(screen.getByTestId('review-speed-4'));
    expect(store.getState().review?.speed).toBe(4);
    fireEvent.click(screen.getByTestId('review-play'));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(store.getState().review?.step).toBe(1);
  });

  it('左栏与对局同构：视角座位版图在上 + 对手 TAB 在下，「视角⇄」轮换第一视角', () => {
    const { store } = setupStore();
    renderReview(store, recordFixture());
    // 上块 = 视角座位（默认 0）版图；下块 = 对手 TAB
    expect(screen.getByTestId('rail-mine').querySelector('[data-testid="player-mat-0"]')).not.toBeNull();
    expect(screen.getByTestId('rail-opponents').querySelector('[data-testid="player-mat-1"]')).not.toBeNull();
    // 切换第一视角 → 上块换成玩家 1
    fireEvent.click(screen.getByTestId('cycle-view-seat-0'));
    expect(store.getState().review?.viewSeat).toBe(1);
    expect(screen.getByTestId('rail-mine').querySelector('[data-testid="player-mat-1"]')).not.toBeNull();
    expect(screen.getByTestId('rail-opponents').querySelector('[data-testid="player-mat-0"]')).not.toBeNull();
    // 再切回玩家 0
    fireEvent.click(screen.getByTestId('cycle-view-seat-1'));
    expect(store.getState().review?.viewSeat).toBe(0);
  });

  it('「此处开始对局」：把 record 截断到当前步发 branch_game 并退出复盘', () => {
    const { store } = setupStore();
    const record = recordFixture();
    renderReview(store, record);
    const ws = lastWs();
    // 前进到第 3 步
    fireEvent.click(screen.getByTestId('review-next'));
    fireEvent.click(screen.getByTestId('review-next'));
    fireEvent.click(screen.getByTestId('review-next'));
    fireEvent.click(screen.getByTestId('review-start-here'));
    expect(store.getState().review).toBeNull();
    const sent = ws.lastSent() as { type: string; record?: { actions: unknown[] }; seat?: number };
    expect(sent.type).toBe('branch_game');
    expect(sent.record?.actions).toHaveLength(3);
    expect(sent.seat).toBe(0);
  });

  it('退出复盘回大厅', () => {
    const { store } = setupStore();
    renderReview(store, recordFixture());
    fireEvent.click(screen.getByTestId('review-exit'));
    expect(store.getState().review).toBeNull();
    expect(screen.getByTestId('create-form')).toBeInTheDocument();
  });

  it('记录无法本地重放 → 显示错误并停止', () => {
    const { store } = setupStore();
    // setup 阶段塞一个主阶段行动：重放必失败
    const bad: GameRecord = {
      version: 1,
      config: { playerCount: 2, seed: 42, factions: ['terrans', 'xenos'], lostFleet: true },
      actions: [{ type: 'pass', booster: null }],
    };
    renderReview(store, bad);
    // 第 0 步（开局）可渲染；走到第 1 步触发重放错误
    fireEvent.click(screen.getByTestId('review-next'));
    expect(screen.getByTestId('review-replay-error').textContent).toContain('第 1 步行动无法重放');
    fireEvent.click(screen.getByTestId('review-exit'));
    expect(store.getState().review).toBeNull();
  });
});
