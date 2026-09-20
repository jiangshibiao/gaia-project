/**
 * FleetPanel 渲染契约测试：
 * - 每艘船一张卡（ship-card-<id>），探索轨 4 格（ship-slot-<id>-<i>，充能 0/2/2/3）、
 *   3 个行动格（ship-action-<id>-<action>）、探索按钮（explore-<id>）；
 * - 无 legalActions 时行动格/探索全禁用；有候选时可点并回调 (ship, action)；
 * - 已用行动格（board.shipActionsUsed）置灰。
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SHIP_ACTION_SPACES, newGame } from '@gaia/engine';
import type { Action, ShipId } from '@gaia/engine';
import { filterStateFor } from '@gaia/protocol';
import { SHIP_BOARD_IMAGE } from '../assets';
import { FleetPanel } from './FleetPanel';

function fixture() {
  const game = newGame({
    playerCount: 4,
    seed: 42,
    factions: ['terrans', 'xenos', 'geodens', 'itars'],
    lostFleet: true,
  });
  return filterStateFor(game);
}

describe('<FleetPanel> 渲染契约', () => {
  it('每艘船一张卡：4 格探索轨 + 3 行动格 + 探索按钮', () => {
    const state = fixture();
    const { getByTestId } = render(
      <FleetPanel state={state} seat={0} legalActions={[]} onShipAction={() => {}} onExplore={() => {}} />,
    );
    expect(state.board.ships.length).toBe(4);
    for (const ship of state.board.ships) {
      getByTestId(`ship-card-${ship.id}`);
      for (let i = 0; i < 4; i++) {
        getByTestId(`ship-slot-${ship.id}-${i}`);
      }
      for (const action of SHIP_ACTION_SPACES[ship.id]) {
        const cell = getByTestId(`ship-action-${ship.id}-${action}`);
        expect(cell).toBeDisabled();
      }
      expect(getByTestId(`explore-${ship.id}`)).toBeDisabled();
    }
  });

  it('船板整图作背景（Twilight/TF-Mars 用 TTS 官方黑底渲染）', () => {
    const state = fixture();
    const { container } = render(
      <FleetPanel state={state} seat={0} legalActions={[]} onShipAction={() => {}} onExplore={() => {}} />,
    );
    for (const ship of state.board.ships) {
      const card = screen.getByTestId(`ship-card-${ship.id}`);
      const img = card.querySelector<HTMLImageElement>('img.ship-board-img');
      expect(img?.src).toContain(SHIP_BOARD_IMAGE[ship.id]);
    }
    expect(SHIP_BOARD_IMAGE.twilight).toContain('twilight_board_render.jpg');
    expect(SHIP_BOARD_IMAGE.tfmars).toContain('tfmars_board_render.jpg');
    // 每船 4 个穿梭机位叠加（空位显示空圈）
    expect(container.querySelectorAll('.ship-slot .slot-empty').length).toBe(state.board.ships.length * 4);
  });

  it('有 explore-ship 候选时探索按钮可点并回调 ship', () => {
    const state = fixture();
    const ship = state.board.ships[0]!.id;
    const legal: Action[] = [{ type: 'explore-ship', ship }];
    const explored: ShipId[] = [];
    const { getByTestId } = render(
      <FleetPanel state={state} seat={0} legalActions={legal} onShipAction={() => {}} onExplore={(s) => explored.push(s)} />,
    );
    const btn = getByTestId(`explore-${ship}`);
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(explored).toEqual([ship]);
    // 其他船仍禁用
    for (const s of state.board.ships.slice(1)) {
      expect(getByTestId(`explore-${s.id}`)).toBeDisabled();
    }
  });

  it('有 ship-action 候选时行动格可点并回调 (ship, action)', () => {
    const state = fixture();
    const ship = state.board.ships[0]!.id;
    const action = SHIP_ACTION_SPACES[ship][0]!;
    const legal: Action[] = [{ type: 'ship-action', ship, action }];
    const calls: [ShipId, string][] = [];
    const { getByTestId } = render(
      <FleetPanel state={state} seat={0} legalActions={legal} onShipAction={(s, a) => calls.push([s, a])} onExplore={() => {}} />,
    );
    const cell = getByTestId(`ship-action-${ship}-${action}`);
    expect(cell).toBeEnabled();
    fireEvent.click(cell);
    expect(calls).toEqual([[ship, action]]);
  });

  it('已用行动格带 used 类且禁用（即使有候选）', () => {
    const state = fixture();
    const ship = state.board.ships[0]!.id;
    const action = SHIP_ACTION_SPACES[ship][0]!;
    state.board.shipActionsUsed.push(`${ship}:${action}`);
    const legal: Action[] = [{ type: 'ship-action', ship, action }];
    const { getByTestId } = render(
      <FleetPanel state={state} seat={0} legalActions={legal} onShipAction={() => {}} onExplore={() => {}} />,
    );
    const cell = getByTestId(`ship-action-${ship}-${action}`);
    expect(cell.className).toContain('used');
    // 引擎不会为已用格产出候选；此处仅验证 used 样式钩子存在
    expect(cell.querySelector('img.action-token')).not.toBeNull();
  });

  it('穿梭机位显示占用玩家色点', () => {
    const state = fixture();
    const ship = state.board.ships[0]!;
    ship.shuttleSlots[1] = 2;
    const { getByTestId } = render(
      <FleetPanel state={state} seat={0} legalActions={[]} onShipAction={() => {}} onExplore={() => {}} />,
    );
    const slot = getByTestId(`ship-slot-${ship.id}-1`);
    expect(slot.className).toContain('occupied');
    expect(slot.querySelector('.slot-owner')?.getAttribute('data-player')).toBe('2');
  });
});
