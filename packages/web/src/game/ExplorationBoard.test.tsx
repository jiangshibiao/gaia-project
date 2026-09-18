/**
 * ExplorationBoard 渲染契约：
 * - lostFleet=false 时不渲染；lostFleet=true 时渲染族肖像/族名/派遣费/调整文本/穿梭机位；
 * - baltaks 派遣费 7 VP，其余 5 VP；穿梭机位 = 2 人局 2 个、3-4 人局 3 个。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newGame } from '@gaia/engine';
import type { FactionId } from '@gaia/engine';
import { filterStateFor } from '@gaia/protocol';
import type { FilteredState } from '@gaia/protocol';
import { ExplorationBoard } from './ExplorationBoard';

function fixture(factions: FactionId[], lostFleet: boolean): FilteredState {
  return filterStateFor(
    newGame({ playerCount: factions.length, seed: 42, factions, lostFleet }),
  );
}

describe('<ExplorationBoard> 渲染契约', () => {
  it('lostFleet=false 时不渲染', () => {
    const state = fixture(['terrans', 'xenos'], false);
    const { container } = render(<ExplorationBoard state={state} seat={0} />);
    expect(container.querySelector('.exploration-board')).toBeNull();
  });

  it('lostFleet=true 时渲染族名/费用/穿梭机位（terrans 5 VP，2 人局 2 个）', () => {
    const state = fixture(['terrans', 'xenos'], true);
    const { getByTestId, getAllByTestId, container } = render(<ExplorationBoard state={state} seat={0} />);
    const board = getByTestId('exploration-board-0');
    expect(board.textContent).toContain('地球人');
    expect(board.textContent).toContain('派遣穿梭机：5 VP');
    expect(getAllByTestId(/^eb-shuttle-0-/).length).toBe(2);
    expect(container.querySelectorAll('.eb-adjust').length).toBe(1);
  });

  it('baltaks 派遣费 7 VP', () => {
    const state = fixture(['baltaks', 'xenos'], true);
    const { getByTestId } = render(<ExplorationBoard state={state} seat={0} />);
    expect(getByTestId('exploration-board-0').textContent).toContain('派遣穿梭机：7 VP');
  });

  it('3-4 人局 3 个穿梭机位', () => {
    const state = fixture(['terrans', 'xenos', 'geodens'], true);
    const { getAllByTestId } = render(<ExplorationBoard state={state} seat={0} />);
    expect(getAllByTestId(/^eb-shuttle-0-/).length).toBe(3);
  });
});
