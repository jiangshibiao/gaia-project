/**
 * FinalsProgress（终局实时进度）契约：
 * - 2 张终局板图 + 每家当前计数（引擎 finalCount 口径，与结算一致）；
 * - 领先标注：计数最高且 >0 者金色 lead；并列全部标注并带「并列」；
 * - 全员 0 分时无领先。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FINAL_SCORING, finalCount } from '@gaia/engine';
import type { GameState } from '@gaia/engine';
import { filterStateFor } from '@gaia/protocol';
import { FinalsProgress, finalCounts } from './FinalsProgress';
import { gameFixture } from '../test/fakes';

function fixture() {
  const state = filterStateFor(gameFixture());
  // 固定两张终局板（satellite = 卫星+空间站；structure = 建筑格数）
  state.board.finalScoring = ['satellite', 'structure'];
  return state;
}

describe('<FinalsProgress> 终局实时进度', () => {
  it('每张终局板渲染图 + 每家计数，计数与引擎 finalCount 一致', () => {
    const state = fixture();
    state.players[0]!.satellites = 5;
    state.players[1]!.satellites = 2;
    state.players[1]!.spaceStations = 1;
    const { getByTestId } = render(<FinalsProgress state={state} nicknames={[]} seat={0} />);
    expect(getByTestId('final-tile-satellite')).toBeInTheDocument();
    expect(getByTestId('final-tile-structure')).toBeInTheDocument();
    // 组件口径 = 引擎 finalCount（satellite: 卫星 + 空间站）
    const counts = finalCounts(state, 'satellite');
    state.players.forEach((_, i) => {
      const expected = finalCount(state as GameState, i, FINAL_SCORING.satellite.condition);
      expect(counts[i]).toBe(expected);
      expect(getByTestId(`final-count-satellite-${i}`).textContent).toContain(String(expected));
    });
    expect(counts).toEqual([5, 3, 0, 0]);
  });

  it('领先标注：唯一领先者 lead，无并列文案', () => {
    const state = fixture();
    state.players[2]!.satellites = 4;
    state.players[0]!.satellites = 2;
    const { getByTestId } = render(<FinalsProgress state={state} nicknames={[]} seat={0} />);
    expect(getByTestId('final-count-satellite-2').dataset.lead).toBe('true');
    expect(getByTestId('final-count-satellite-2').textContent).not.toContain('并列');
    expect(getByTestId('final-count-satellite-0').dataset.lead).toBeUndefined();
    expect(getByTestId('final-count-satellite-1').dataset.lead).toBeUndefined();
  });

  it('并列领先：全部标注 lead 且带「并列」', () => {
    const state = fixture();
    state.players[0]!.satellites = 3;
    state.players[3]!.satellites = 3;
    state.players[1]!.satellites = 1;
    const { getByTestId } = render(<FinalsProgress state={state} nicknames={[]} seat={0} />);
    expect(getByTestId('final-count-satellite-0').dataset.lead).toBe('true');
    expect(getByTestId('final-count-satellite-3').dataset.lead).toBe('true');
    expect(getByTestId('final-count-satellite-0').textContent).toContain('并列');
    expect(getByTestId('final-count-satellite-3').textContent).toContain('并列');
    expect(getByTestId('final-count-satellite-1').dataset.lead).toBeUndefined();
  });

  it('全员 0 分：无领先标注', () => {
    const state = fixture();
    const { container } = render(<FinalsProgress state={state} nicknames={[]} seat={0} />);
    expect(container.querySelectorAll('.final-count.lead')).toHaveLength(0);
  });
});
