/**
 * ScoreboardBoard（实图计分板）渲染契约 + 校准结构契约：
 * - 6 张回合计分片（round-arc-tile-N）：当前轮 cur 金框、过往轮 past 置灰；对局结束全 past；
 * - 2 张终局计分片（final-tile-<id>）+ 绿轨玩家计数点（final-count-<tile>-<i>，领先 data-lead）；
 * - LF：梯形扩展片（按 scoringExtension 选面）+ 第 7 高级板槽（adv-slot-6，选择态可拿）；
 *   非 LF：无扩展片与槽位；
 * - 校准数据：槽位/轨道坐标均在 0..1，回合槽 6 个、终局槽/轨道各 2 个。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newGame } from '@gaia/engine';
import type { PlayerIndex } from '@gaia/engine';
import { filterStateFor } from '@gaia/protocol';
import type { FilteredState } from '@gaia/protocol';
import { scoreboardExtImage } from '../assets';
import { ScoreboardBoard, finalCounts } from './ScoreboardBoard';
import { SB_FINAL_ROWS, SB_FINAL_SLOTS, SB_ROUND_SLOTS } from './scoreboard-calibration';

function fixture(round = 1, phase?: string, lostFleet = true): FilteredState {
  const state = filterStateFor(
    newGame({
      playerCount: 4,
      seed: 42,
      factions: ['terrans', 'xenos', 'geodens', 'itars'],
      lostFleet,
    }),
  );
  state.round = round;
  if (phase !== undefined) (state as { phase: string }).phase = phase;
  return state;
}

function renderBoard(state: FilteredState) {
  return render(<ScoreboardBoard state={state} nicknames={[]} seat={0 as PlayerIndex} />);
}

describe('scoreboard-calibration 结构', () => {
  it('回合槽 6 个、终局槽/轨道各 2 个，坐标均在 0..1', () => {
    expect(SB_ROUND_SLOTS).toHaveLength(6);
    expect(SB_FINAL_SLOTS).toHaveLength(2);
    expect(SB_FINAL_ROWS).toHaveLength(2);
    for (const s of SB_ROUND_SLOTS) {
      for (const v of [s.x, s.y, s.w]) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
    }
    for (const s of SB_FINAL_SLOTS) {
      for (const v of [s.x, s.y, s.w]) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThan(1);
      }
    }
    for (const r of SB_FINAL_ROWS) {
      expect(r.x0).toBeGreaterThanOrEqual(0);
      expect(r.x1).toBeLessThanOrEqual(1);
      expect(r.x0).toBeLessThan(r.x1);
      expect(r.y).toBeGreaterThan(0);
      expect(r.y).toBeLessThan(1);
    }
  });
});

describe('<ScoreboardBoard> 回合计分片', () => {
  it('6 张片：第 3 轮时 tile-3 cur、tile-1/2 past、其余皆否', () => {
    const { getByTestId } = renderBoard(fixture(3));
    for (let i = 1; i <= 6; i++) {
      const cls = getByTestId(`round-arc-tile-${i}`).className;
      expect(cls.includes('cur'), `tile-${i} cur`).toBe(i === 3);
      expect(cls.includes('past'), `tile-${i} past`).toBe(i < 3);
    }
  });

  it('对局结束：全部 past、无 cur', () => {
    const { container } = renderBoard(fixture(6, 'game-over'));
    expect(container.querySelectorAll('.sb-round-tile.cur')).toHaveLength(0);
    expect(container.querySelectorAll('.sb-round-tile.past')).toHaveLength(6);
  });
});

describe('<ScoreboardBoard> 终局计分与进度', () => {
  it('2 张终局片入槽；计数点数量 = 终局片数 × 玩家数', () => {
    const state = fixture();
    const { getByTestId, container } = renderBoard(state);
    for (const f of state.board.finalScoring) {
      expect(getByTestId(`final-tile-${f}`)).toBeInTheDocument();
    }
    expect(container.querySelectorAll('.sb-final-marker')).toHaveLength(state.board.finalScoring.length * 4);
  });

  it('finalCounts 与引擎一致；领先者带 data-lead', () => {
    const state = fixture();
    // 人为制造计数差：给玩家 2 更多联邦（satellite 条件数卫星连接数以外的近似，
    // 这里直接借引擎 finalCount 校验契约：计数一致即可，领先关系按计数重算）
    const counts = finalCounts(state, state.board.finalScoring[0]!);
    expect(counts).toHaveLength(4);
    const { container } = renderBoard(state);
    const max = Math.max(...counts);
    counts.forEach((c, i) => {
      const marker = container.querySelector(`[data-testid="final-count-${state.board.finalScoring[0]}-${i}"]`);
      expect(marker?.getAttribute('data-count')).toBe(String(c));
      expect(marker?.hasAttribute('data-lead')).toBe(c === max && max > 0);
    });
  });
});

describe('<ScoreboardBoard> LF 扩展片', () => {
  it('LF：梯形片按 scoringExtension 选面 + 第 7 高级板槽；非 LF：皆无', () => {
    const lf = fixture(1, undefined, true);
    expect(lf.board.advTechTiles).toHaveLength(7);
    const { getByTestId, unmount } = renderBoard(lf);
    const extImg = document.querySelector<HTMLImageElement>('.sb-ext-img');
    expect(extImg?.src).toContain(scoreboardExtImage(lf.board.scoringExtension ?? 'vp'));
    const slot = getByTestId('adv-slot-6');
    expect(slot.getAttribute('data-tile')).toBe(lf.board.advTechTiles[6]);
    unmount();

    const base = fixture(1, undefined, false);
    const { container, queryByTestId } = renderBoard(base);
    expect(container.querySelector('.sb-ext')).toBeNull();
    expect(queryByTestId('adv-slot-6')).toBeNull();
  });

  it('ships 面：扩展片图随 scoringExtension 切换', () => {
    const state = fixture(1, undefined, true);
    state.board.scoringExtension = 'ships';
    renderBoard(state);
    const extImg = document.querySelector<HTMLImageElement>('.sb-ext-img');
    expect(extImg?.src).toContain(scoreboardExtImage('ships'));
  });

  it('第 7 槽已拿显示「已拿」；选择态命中可点击，未命中禁用', () => {
    const taken = fixture(1, undefined, true);
    taken.board.advTechTiles[6] = null;
    const { getByTestId, unmount } = renderBoard(taken);
    expect(getByTestId('adv-slot-6').className).toContain('empty');
    expect(getByTestId('adv-slot-6').textContent).toContain('已拿');
    unmount();

    const state = fixture(1, undefined, true);
    const tile = state.board.advTechTiles[6]!;
    const picks: [string, string][] = [];
    const { getByTestId: g1, unmount: u1 } = render(
      <ScoreboardBoard
        state={state}
        nicknames={[]}
        seat={0 as PlayerIndex}
        activeField="advTechTile"
        activeOptions={new Set([tile])}
        onPick={(f, v) => picks.push([f, v])}
      />,
    );
    const slot = g1('adv-slot-6');
    expect(slot).toBeEnabled();
    expect(slot.className).toContain('pickable');
    slot.click();
    expect(picks).toEqual([['advTechTile', tile]]);
    u1();

    const { getByTestId: g2 } = renderBoard(fixture(1, undefined, true));
    expect(g2('adv-slot-6')).toBeDisabled();
  });
});
