/**
 * BoostersStrip（助推器池横条）契约：
 * - 供应池各助推器图横排 + 已拿置灰；
 * - 选择态字段为 booster 时命中项可点（onPick），其余禁用。
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { filterStateFor } from '@gaia/protocol';
import { BoostersStrip } from './BoostersStrip';
import { gameFixture } from '../test/fakes';

describe('<BoostersStrip> 助推器池', () => {
  it('供应池横排 + 已拿置灰', () => {
    const state = filterStateFor(gameFixture());
    const taken = state.board.boosters[0]!;
    state.players[1]!.booster = taken;
    const { getByTestId } = render(<BoostersStrip state={state} />);
    expect(getByTestId('boosters-strip')).toBeInTheDocument();
    for (const b of state.board.boosters) {
      expect(getByTestId(`booster-${b}`)).toBeInTheDocument();
    }
    const takenTile = getByTestId(`booster-taken-${taken}`);
    expect(takenTile.className).toContain('taken');
  });

  it('booster 字段选择态：命中项可点并回传 onPick', () => {
    const state = filterStateFor(gameFixture());
    const pickable = state.board.boosters[1]!;
    const picks: [string, string][] = [];
    const { getByTestId } = render(
      <BoostersStrip
        state={state}
        activeField="booster"
        activeOptions={new Set([pickable])}
        onPick={(f, v) => picks.push([f, v])}
      />,
    );
    fireEvent.click(getByTestId(`booster-${pickable}`));
    expect(picks).toEqual([['booster', pickable]]);
    // 未命中项保持禁用
    const other = state.board.boosters.find((b) => b !== pickable)!;
    expect(getByTestId(`booster-${other}`)).toBeDisabled();
  });
});
