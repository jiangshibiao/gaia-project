/**
 * AdvExtension（LF 计分板扩展条）渲染契约：
 * - 仅 LF（advTechTiles.length > 6）渲染，否则不输出；
 * - 解锁条件指示图（vp/ships 面，读 board.scoringExtension）+ 第 7 高级板槽；
 * - 已拿走的槽显示「已拿」置灰；
 * - 选择态命中 advTechTile 字段时对应槽可点击（onPick），未命中禁用。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newGame } from '@gaia/engine';
import { filterStateFor } from '@gaia/protocol';
import { advConditionImage } from '../assets';
import { AdvExtension } from './AdvExtension';

function fixture(lostFleet: boolean) {
  const game = newGame({
    playerCount: 4,
    seed: 42,
    factions: ['terrans', 'xenos', 'geodens', 'itars'],
    lostFleet,
  });
  return filterStateFor(game);
}

describe('<AdvExtension> LF 计分板扩展条', () => {
  it('LF：解锁条件图 + 第 7 高级板槽；非 LF：不渲染', () => {
    const lf = fixture(true);
    expect(lf.board.advTechTiles).toHaveLength(7);
    const { getByTestId, unmount } = render(<AdvExtension state={lf} />);
    const ext = getByTestId('adv-extension');
    const cond = ext.querySelector<HTMLImageElement>('img.advcond-img');
    expect(cond?.src).toContain(advConditionImage(lf.board.scoringExtension ?? 'vp'));
    const slot = getByTestId('adv-slot-6');
    expect(slot.getAttribute('data-tile')).toBe(lf.board.advTechTiles[6]);
    unmount();

    const base = fixture(false);
    expect(base.board.advTechTiles).toHaveLength(6);
    const { container } = render(<AdvExtension state={base} />);
    expect(container.firstChild).toBeNull();
  });

  it('ships 面解锁条件：条件图与提示文案随 scoringExtension 切换', () => {
    const state = fixture(true);
    state.board.scoringExtension = 'ships';
    const { getByTestId } = render(<AdvExtension state={state} />);
    const cond = getByTestId('adv-extension').querySelector<HTMLImageElement>('img.advcond-img');
    expect(cond?.src).toContain(advConditionImage('ships'));
    expect(cond?.title).toContain('探索 3 艘飞船');
  });

  it('已拿走的槽显示「已拿」置灰', () => {
    const state = fixture(true);
    state.board.advTechTiles[6] = null;
    const { getByTestId } = render(<AdvExtension state={state} />);
    const slot = getByTestId('adv-slot-6');
    expect(slot.className).toContain('empty');
    expect(slot.textContent).toContain('已拿');
  });

  it('选择态命中 advTechTile 可点击回调；未命中禁用', () => {
    const state = fixture(true);
    const tile = state.board.advTechTiles[6]!;
    const picks: [string, string][] = [];
    const { getByTestId, unmount } = render(
      <AdvExtension
        state={state}
        activeField="advTechTile"
        activeOptions={new Set([tile])}
        onPick={(f, v) => picks.push([f, v])}
      />,
    );
    const slot = getByTestId('adv-slot-6');
    expect(slot).toBeEnabled();
    expect(slot.className).toContain('pickable');
    slot.click();
    expect(picks).toEqual([['advTechTile', tile]]);
    unmount();

    // 非选择态：禁用
    const { getByTestId: g2 } = render(<AdvExtension state={fixture(true)} />);
    expect(g2('adv-slot-6')).toBeDisabled();
  });
});
