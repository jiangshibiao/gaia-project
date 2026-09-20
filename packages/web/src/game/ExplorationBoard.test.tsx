/**
 * ExplorationBoard 渲染契约（实图版种族飞船面板）：
 * - lostFleet=false 时不渲染；lostFleet=true 时渲染面板整图（factions/panels/<id>.png）；
 * - 派遣费以 data-cost 暴露（baltaks 7，其余 5）；穿梭机位 = 2 人局 2 个、3-4 人局 3 个；
 * - 已派遣的穿梭机位留空（used），未派遣显示穿梭机图。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newGame } from '@gaia/engine';
import type { FactionId } from '@gaia/engine';
import { filterStateFor } from '@gaia/protocol';
import type { FilteredState } from '@gaia/protocol';
import { factionPanelImage } from '../assets';
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

  it('lostFleet=true 时渲染面板整图 + 穿梭机位（2 人局 2 个）', () => {
    const state = fixture(['terrans', 'xenos'], true);
    const { getByTestId, getAllByTestId } = render(<ExplorationBoard state={state} seat={0} />);
    const board = getByTestId('exploration-board-0');
    expect(board.getAttribute('data-cost')).toBe('5');
    const img = board.querySelector<HTMLImageElement>('img.eb-panel-img');
    expect(img?.src).toContain(factionPanelImage('terrans'));
    expect(getAllByTestId(/^eb-shuttle-0-/).length).toBe(2);
  });

  it('baltaks 派遣费 7（data-cost）', () => {
    const state = fixture(['baltaks', 'xenos'], true);
    const { getByTestId } = render(<ExplorationBoard state={state} seat={0} />);
    expect(getByTestId('exploration-board-0').getAttribute('data-cost')).toBe('7');
  });

  it('3-4 人局 3 个穿梭机位；已派遣的留空（used）', () => {
    const state = fixture(['terrans', 'xenos', 'geodens'], true);
    state.players[0]!.shuttles.push({ ship: 'twilight', slot: 0 });
    const { getAllByTestId, getByTestId } = render(<ExplorationBoard state={state} seat={0} />);
    expect(getAllByTestId(/^eb-shuttle-0-/).length).toBe(3);
    expect(getByTestId('eb-shuttle-0-0').className).toContain('used');
    expect(getByTestId('eb-shuttle-0-0').querySelector('img')).toBeNull();
    expect(getByTestId('eb-shuttle-0-1').querySelector('img')).not.toBeNull();
  });
});
