/**
 * RoundArc（回合弧）渲染契约 + computeArcLayout 几何契约：
 * - 6 张回合计分图分布在宽扁半圆外环（180°→0°，左右对称；rx ≈ 容器宽 44%、
 *   ry ≈ 容器高 80%，环心在容器底部中央）；
 * - 数字圆在内环同角度（半径小于外环）；中央装饰星球在环心；
 * - 按容器实测尺寸排布：最低点（端点图下缘 / 星球底边）恰好 = 容器底边，
 *   最高图顶边不越容器顶，端点图不溢出左右；
 * - 当前轮金框高亮（cur）、过往轮置灰（past）、未来轮两者皆无；
 * - 终局后全部置灰、无当前轮。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { filterStateFor } from '@gaia/protocol';
import { RoundArc, computeArcLayout } from './RoundArc';
import { gameFixture } from '../test/fakes';

function fixture(round: number, phase?: 'game-over') {
  const state = filterStateFor(gameFixture());
  state.round = round;
  if (phase !== undefined) state.phase = phase;
  return state;
}

describe('computeArcLayout 几何（圆环排布，按容器实测尺寸）', () => {
  it('环心在底部中央：端点图下缘贴底；最高图不越顶；端点图不溢出左右；图之间不重叠', () => {
    for (const [w, h] of [
      [420, 200], // 2.1 宽高比（默认）
      [420, 120], // 更矮的容器（真实对局情形）
      [300, 300], // 更高的容器
    ] as const) {
      const n = 6;
      const L = computeArcLayout(w, h, n);
      const maxSin = Math.max(...Array.from({ length: n }, (_, i) => Math.sin(Math.PI * (1 - i / (n - 1)))));
      // 环心 x = 容器中央；最低点（端点图下缘 / 星球底边）不越容器底（整体上移 6%）
      expect(L.cx).toBeCloseTo(w / 2, 6);
      expect(L.cy + L.tileHeight / 2).toBeLessThanOrEqual(h + 1e-6);
      expect(L.cy + L.planetD / 2).toBeLessThanOrEqual(h + 1e-6);
      expect(Math.max(L.cy + L.tileHeight / 2, L.cy + L.planetD / 2)).toBeCloseTo(h * 0.94, 6);
      // 端点图不溢出左右
      expect(L.cx - L.radius - L.tileWidth / 2).toBeGreaterThanOrEqual(-1e-6);
      expect(L.cx + L.radius + L.tileWidth / 2).toBeLessThanOrEqual(w + 1e-6);
      // 最高图（sin=maxSin）：顶边不越容器顶
      expect(L.cy - L.radius * maxSin - L.tileHeight / 2).toBeGreaterThanOrEqual(-1e-6);
      // 相邻图几乎贴住：弦长 ≥ 图宽 × 0.95
      const chord = 2 * L.radius * Math.sin(Math.PI / (n - 1) / 2);
      expect(chord).toBeGreaterThanOrEqual(L.tileWidth * 0.95 - 1e-6);
      // 装饰星球在环内侧且完整在容器内
      expect(L.planetD).toBeLessThanOrEqual(2 * (L.radius - L.tileHeight / 2) + 1e-6);
      expect(L.cy + L.planetD / 2).toBeLessThanOrEqual(h + 1e-6);
      // 数字圆：端点下缘不超底、最高者不越顶
      expect(L.cy + L.numD / 2).toBeLessThanOrEqual(h + 1e-6);
      expect(L.cy - L.numRadius * maxSin - L.numD / 2).toBeGreaterThanOrEqual(-1e-6);
    }
  });

  it('数字圆在环内侧（内环半径小于外环）', () => {
    const L = computeArcLayout(420, 200);
    expect(L.numRadius).toBeLessThan(L.radius);
  });

  it('计分图按径向旋转（左逆右顺、顶部近正立）；母星环 7 种各一', () => {
    const { getByTestId, container } = render(<RoundArc state={fixture(3)} />);
    // 径向旋转：第 1 张逆时针大角度、第 6 张顺时针大角度、第 3/4 张近正立
    const t1 = getByTestId('round-arc-tile-1').style.transform;
    const t6 = getByTestId('round-arc-tile-6').style.transform;
    const t3 = getByTestId('round-arc-tile-3').style.transform;
    expect(t1).toContain('rotate(-90.0deg)');
    expect(t6).toContain('rotate(90.0deg)');
    expect(t3).toContain('rotate(-18.0deg)');
    // 母星环：7 种母星各一
    expect(container.querySelectorAll('.round-arc-home')).toHaveLength(7);
  });
});

describe('<RoundArc> 回合弧', () => {
  it('6 张计分图 + 6 个数字圆，半圆两端对称排布', () => {
    const state = fixture(3);
    const { getByTestId, container } = render(<RoundArc state={state} />);
    expect(getByTestId('round-arc')).toBeInTheDocument();
    expect(container.querySelectorAll('.round-arc-tile')).toHaveLength(6);
    expect(container.querySelectorAll('.round-arc-num')).toHaveLength(6);
    // 180°→0° 半圆：第 1/6 张左右对称（x 镜像、y 相同）
    const first = getByTestId('round-arc-tile-1');
    const last = getByTestId('round-arc-tile-6');
    expect(first.style.top).toBe(last.style.top);
    const x1 = parseFloat(first.style.left);
    const x6 = parseFloat(last.style.left);
    expect(x1 + x6).toBeCloseTo(210, 1); // 回退布局 210×100：x 关于 cx=105 镜像
  });

  it('当前轮 cur 高亮、过往轮 past 置灰、未来轮无标记', () => {
    const { getByTestId } = render(<RoundArc state={fixture(3)} />);
    for (let i = 1; i <= 6; i++) {
      const cls = getByTestId(`round-arc-tile-${i}`).className;
      if (i < 3) {
        expect(cls).toContain('past');
        expect(cls).not.toContain('cur');
      } else if (i === 3) {
        expect(cls).toContain('cur');
        expect(cls).not.toContain('past');
      } else {
        expect(cls).not.toContain('cur');
        expect(cls).not.toContain('past');
      }
    }
    expect(getByTestId('round-arc-num-3').className).toContain('cur');
  });

  it('终局后：全部置灰、无当前轮', () => {
    const { container } = render(<RoundArc state={fixture(6, 'game-over')} />);
    expect(container.querySelectorAll('.round-arc-tile.cur')).toHaveLength(0);
    expect(container.querySelectorAll('.round-arc-tile.past')).toHaveLength(6);
  });

  it('回退布局（jsdom 无 ResizeObserver）：最低点（端点图下缘 / 星球底边）贴容器底边', () => {
    const { container, getByTestId } = render(<RoundArc state={fixture(3)} />);
    const L = computeArcLayout(210, 100, 6);
    for (const i of [1, 6]) {
      const tile = getByTestId(`round-arc-tile-${i}`);
      const centerY = parseFloat(tile.style.top);
      // 图下缘不越容器底（最低点为图/星球较大者贴底，图可能略浮）
      expect(centerY + L.tileHeight / 2).toBeLessThanOrEqual(100 + 1e-6);
    }
    // 中央装饰星球：中心 = 环心（底部中央）；最低点（图/星球较大者）上移后 = 容器底的 94%
    const planet = container.querySelector<HTMLElement>('.round-arc-planet');
    expect(parseFloat(planet?.style.top ?? '')).toBeCloseTo(L.cy, 1);
    expect(Math.max(L.cy + L.tileHeight / 2, L.cy + L.planetD / 2)).toBeCloseTo(100 * 0.94, 1);
    // 最高图（6 张时第 3/4 张，sin=sin108°）顶边不越容器顶
    const mid = getByTestId('round-arc-tile-3');
    const midTop = parseFloat(mid.style.top) - L.tileHeight / 2;
    expect(midTop).toBeGreaterThanOrEqual(-0.01);
  });
});
