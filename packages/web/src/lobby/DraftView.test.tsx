/**
 * DraftView（种族选取）渲染契约测试：
 * - 房态切换：room.drafting=true + draft_state → 种族网格（18 族图 + 中文名）；
 * - 当前行动者高亮"轮到你了"；非本人回合族格禁用；
 * - friendly：点空闲族发 draft_pick；已被锁定的族禁用并显示持有者昵称；
 * - auction：点已被持有族弹出加价输入（显示当前价）→ draft_bid；全员就绪 → draft_confirm。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@gaia/protocol';
import type { DraftState, FactionMode } from '@gaia/protocol';
import { newGame } from '@gaia/engine';
import { filterStateFor } from '@gaia/protocol';
import type { FactionId } from '@gaia/engine';
import { RoomView } from './Lobby';
import type { GameStore } from '../game/store';
import { lastWs, roomFixture, setupStore } from '../test/fakes';
import type { FakeWebSocket } from '../test/fakes';

function draftFixture(overrides: Partial<DraftState> = {}): DraftState {
  return {
    mode: 'friendly',
    turnOrder: [0, 1],
    currentActor: 0,
    picks: { 0: null, 1: null },
    available: ['terrans', 'xenos'],
    finished: false,
    ...overrides,
  };
}

/** 渲染 RoomView 并进入 draft 态（2 人房，本人座位 0）。 */
function renderInDraft(draft: DraftState, factionMode: FactionMode = 'friendly'): { store: GameStore; ws: FakeWebSocket } {
  const { store } = setupStore();
  render(<RoomView store={store} />);
  store.connect();
  const ws = lastWs();
  act(() => {
    ws.open();
    ws.emit({ type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat: 0, token: 'tok-me' });
    ws.emit({
      type: 'room_state',
      protocolVersion: PROTOCOL_VERSION,
      room: roomFixture({
        config: { playerCount: 2, lostFleet: true, factionMode },
        seats: [
          { seat: 0, nickname: '甲', isAI: false, connected: true },
          { seat: 1, nickname: '乙', isAI: false, connected: true },
        ],
        drafting: true,
      }),
      yourSeat: 0,
    });
    ws.emit({ type: 'draft_state', protocolVersion: PROTOCOL_VERSION, draft });
  });
  return { store, ws };
}

describe('<DraftView>', () => {
  it('draft 态渲染种族网格（18 族）与"轮到你了"提示', () => {
    renderInDraft(draftFixture());
    expect(screen.getByTestId('draft-view')).toBeInTheDocument();
    expect(screen.getByTestId('draft-turn-hint')).toHaveTextContent('轮到你了');
    // 18 族格（lostFleet=true）
    expect(screen.getByTestId('draft-faction-terrans')).toBeInTheDocument();
    expect(screen.getByTestId('draft-faction-space-giants')).toBeInTheDocument();
    expect(screen.getByTestId('draft-faction-terrans')).toHaveTextContent('人类');
    // 等待大厅的座位面板不再显示
    expect(screen.queryByTestId('start-game')).not.toBeInTheDocument();
  });

  it('setup 信息区：顺位（先手标注）/ 回合计分 / 终局条件 / 地图预览', () => {
    const preview = filterStateFor(
      newGame({ playerCount: 2, seed: 42, factions: ['terrans', 'lantids'], lostFleet: true }),
    );
    renderInDraft(draftFixture({ turnOrder: [1, 0], currentActor: 1, preview }));
    const info = screen.getByTestId('draft-info');
    expect(info).toBeInTheDocument();
    // 顺位：乙先手（座位 1 在首位，带「先手」标注）
    const order = screen.getByTestId('draft-turn-order');
    expect(order).toHaveTextContent('1. 乙（先手）');
    expect(order).toHaveTextContent('2. 甲');
    // 计分片：6 回合 + 2 终局 = 8 张图
    expect(screen.getByTestId('draft-scoring').querySelectorAll('img.draft-scoring-img')).toHaveLength(8);
    // 地图预览容器渲染（BoardSvg）
    expect(screen.getByTestId('draft-map').querySelector('svg')).not.toBeNull();
  });

  it('friendly：点空闲族发 draft_pick；被锁定族禁用并显示持有者', () => {
    const { ws } = renderInDraft(
      draftFixture({ picks: { 0: { faction: 'terrans', bid: 0 }, 1: null }, currentActor: 0 }),
    );
    // terrans 已被座位 0 持有：显示持有者昵称，且（friendly）不可再点
    // （aria-disabled 禁用态——不用 disabled 属性以保留悬浮预览）
    expect(screen.getByTestId('draft-holder-terrans')).toHaveTextContent('甲');
    expect(screen.getByTestId('draft-faction-terrans')).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByTestId('draft-faction-xenos'));
    expect(ws.lastSent()).toEqual({
      type: 'draft_pick',
      protocolVersion: PROTOCOL_VERSION,
      token: 'tok-me',
      faction: 'xenos',
    });
  });

  it('非本人回合：所有族格禁用，提示等待对方', () => {
    renderInDraft(draftFixture({ currentActor: 1 }));
    expect(screen.getByTestId('draft-turn-hint')).toHaveTextContent('等待 乙 选族');
    expect(screen.getByTestId('draft-faction-xenos')).toHaveAttribute('aria-disabled', 'true');
  });

  it('auction：点已被持有族弹出加价输入（显示当前价），提交发 draft_bid', () => {
    const { ws } = renderInDraft(
      draftFixture({
        mode: 'auction',
        picks: { 0: null, 1: { faction: 'terrans', bid: 2 } },
        available: ['xenos'],
        currentActor: 0,
      }),
      'auction',
    );
    // 持有者行显示当前出价
    expect(screen.getByTestId('draft-holder-terrans')).toHaveTextContent('乙 · 出价 2');
    // 被持有族在 auction 下可点（打开加价输入）
    fireEvent.click(screen.getByTestId('draft-faction-terrans'));
    expect(screen.getByTestId('draft-bid-form')).toHaveTextContent('当前价 2，可出 3–11');
    fireEvent.change(screen.getByTestId('draft-bid-input'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('draft-bid-submit'));
    expect(ws.lastSent()).toEqual({
      type: 'draft_bid',
      protocolVersion: PROTOCOL_VERSION,
      token: 'tok-me',
      faction: 'terrans',
      bid: 4,
    });
  });

  it('auction：自己的族被挤后提示重新选择；点空闲族出价 0 持有', () => {
    const { ws } = renderInDraft(
      draftFixture({
        mode: 'auction',
        picks: { 0: null, 1: { faction: 'terrans', bid: 1 } },
        available: ['xenos'],
        currentActor: 0,
      }),
      'auction',
    );
    expect(screen.getByTestId('draft-outbid')).toHaveTextContent('你的种族被出价挤掉了');
    fireEvent.click(screen.getByTestId('draft-faction-xenos'));
    expect(ws.lastSent()).toEqual({
      type: 'draft_pick',
      protocolVersion: PROTOCOL_VERSION,
      token: 'tok-me',
      faction: 'xenos',
    });
  });

  it('全员就绪：显示确认按钮与各座位结果，点击发 draft_confirm', () => {
    const { ws } = renderInDraft(
      draftFixture({
        picks: { 0: { faction: 'terrans', bid: 0 }, 1: { faction: 'xenos', bid: 0 } },
        available: [],
        currentActor: null,
        finished: true,
      }),
    );
    expect(screen.getByTestId('draft-turn-hint')).toHaveTextContent('全员就绪');
    expect(screen.getByTestId('draft-pick-0')).toHaveTextContent('甲：人类');
    expect(screen.getByTestId('draft-pick-1')).toHaveTextContent('乙：异空族');
    fireEvent.click(screen.getByTestId('draft-confirm'));
    expect(ws.lastSent()).toEqual({ type: 'draft_confirm', protocolVersion: PROTOCOL_VERSION, token: 'tok-me' });
  });

  it('auction 就绪摘要显示起始 VP（10 − 出价）', () => {
    renderInDraft(
      draftFixture({
        mode: 'auction',
        picks: { 0: { faction: 'terrans' as FactionId, bid: 3 }, 1: { faction: 'xenos' as FactionId, bid: 0 } },
        available: [],
        currentActor: null,
        finished: true,
      }),
      'auction',
    );
    expect(screen.getByTestId('draft-pick-0')).toHaveTextContent('起始 VP 7');
    expect(screen.getByTestId('draft-pick-1')).toHaveTextContent('起始 VP 10');
  });
});
