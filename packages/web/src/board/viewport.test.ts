/**
 * viewport 纯函数契约：
 * - parse/format 互逆；
 * - zoomViewBox 以指定点为中心缩放（该点视口位置不变），scale>1 视野变小；
 * - clampZoom 限制在 0.3–4；panViewBox 平移不改尺寸；
 * - rotatedViewBox 给出绕中心旋转后的轴对齐外接矩形（中心不变）；
 * - bestHorizontalRotation 任意角度扫描，选出"旋转后包围盒宽度最大"的水平取向
 *   （LF 2/3/4 人与基础布局下默认视图最宽轴严格水平）。
 */
import { describe, expect, it } from 'vitest';
import { newGame, parseHexKey } from '@gaia/engine';
import type { HexKey } from '@gaia/engine';
import {
  ZOOM_MAX,
  ZOOM_MIN,
  bestHorizontalRotation,
  clampZoom,
  formatViewBox,
  panViewBox,
  parseViewBox,
  rotatedViewBox,
  zoomViewBox,
} from './viewport';
import { hexToPixel } from './BoardSvg';

/** 点集绕 (cx,cy) 旋转 deg 后的包围盒宽/高（与 bestHorizontalRotation 同一约定）。 */
function rotatedExtent(
  points: readonly { x: number; y: number }[],
  cx: number,
  cy: number,
  deg: number,
): { w: number; h: number } {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const vx = dx * c - dy * s;
    const vy = dx * s + dy * c;
    minX = Math.min(minX, vx);
    maxX = Math.max(maxX, vx);
    minY = Math.min(minY, vy);
    maxY = Math.max(maxY, vy);
  }
  return { w: maxX - minX, h: maxY - minY };
}

describe('viewport', () => {
  it('parse/format 互逆', () => {
    const v = { x: -10.5, y: 20.25, w: 300, h: 400 };
    const round = parseViewBox(formatViewBox(v));
    expect(round.x).toBeCloseTo(v.x);
    expect(round.y).toBeCloseTo(v.y);
    expect(round.w).toBeCloseTo(v.w);
    expect(round.h).toBeCloseTo(v.h);
  });

  it('zoomViewBox 保持中心点不动（放大 2 倍）', () => {
    const v = { x: 0, y: 0, w: 100, h: 100 };
    const center = { x: 30, y: 40 };
    const z = zoomViewBox(v, center, 2);
    expect(z.w).toBeCloseTo(50);
    expect(z.h).toBeCloseTo(50);
    // 中心点在新视口中的相对位置不变：(c - x) / w 相等
    expect((center.x - z.x) / z.w).toBeCloseTo((center.x - v.x) / v.w);
    expect((center.y - z.y) / z.h).toBeCloseTo((center.y - v.y) / v.h);
  });

  it('zoomViewBox 缩小（scale<1）视野变大', () => {
    const v = { x: 10, y: 10, w: 50, h: 50 };
    const z = zoomViewBox(v, { x: 35, y: 35 }, 0.5);
    expect(z.w).toBeCloseTo(100);
  });

  it('clampZoom 限制范围', () => {
    expect(clampZoom(0.1)).toBe(ZOOM_MIN);
    expect(clampZoom(10)).toBe(ZOOM_MAX);
    expect(clampZoom(1.5)).toBe(1.5);
    expect(ZOOM_MIN).toBeCloseTo(0.3);
    expect(ZOOM_MAX).toBe(4);
  });

  it('panViewBox 平移不改宽高', () => {
    const v = { x: 0, y: 0, w: 100, h: 80 };
    const p = panViewBox(v, 5, -7);
    expect(p).toEqual({ x: 5, y: -7, w: 100, h: 80 });
  });

  it('rotatedViewBox：0° 恒等，90° 宽高互换且中心不变', () => {
    const v = { x: 10, y: 20, w: 100, h: 60 };
    const id = rotatedViewBox(v, 0);
    expect(id.w).toBeCloseTo(v.w);
    expect(id.h).toBeCloseTo(v.h);
    expect(id.x).toBeCloseTo(v.x);
    expect(id.y).toBeCloseTo(v.y);
    const r90 = rotatedViewBox(v, 90);
    expect(r90.w).toBeCloseTo(v.h);
    expect(r90.h).toBeCloseTo(v.w);
    expect(r90.x + r90.w / 2).toBeCloseTo(v.x + v.w / 2);
    expect(r90.y + r90.h / 2).toBeCloseTo(v.y + v.h / 2);
  });

  it('bestHorizontalRotation：水平点集 → 0；垂直 → ±90；斜 30° → ≈−30', () => {
    const horiz = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }];
    expect(bestHorizontalRotation(horiz, 10, 0)).toBe(0);
    const vert = [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: 20 }];
    expect(Math.abs(bestHorizontalRotation(vert, 0, 10))).toBe(90);
    // 沿 30° 方向的点集：旋转 −30° 后严格水平（宽度最大）
    const diag = [0, 1, 2, 3].map((k) => ({ x: k * Math.cos(Math.PI / 6), y: k * Math.sin(Math.PI / 6) }));
    const deg = bestHorizontalRotation(diag, 1, 0.5);
    expect(deg).toBeCloseTo(-30, 0);
    const at = rotatedExtent(diag, 1, 0.5, deg);
    expect(at.w).toBeGreaterThan(at.h);
  });

  it('bestHorizontalRotation：LF 2/3/4 人与基础布局默认视图最宽轴严格水平', () => {
    const factions = ['terrans', 'xenos', 'geodens', 'itars'] as const;
    for (const lostFleet of [true, false]) {
      for (const playerCount of [2, 3, 4]) {
        const game = newGame({
          playerCount,
          seed: 42,
          factions: [...factions.slice(0, playerCount)],
          lostFleet,
        });
        const points = (Object.keys(game.map) as HexKey[]).map((key) => {
          const { q, r } = parseHexKey(key);
          return hexToPixel(q, r);
        });
        const xs = points.map((p) => p.x);
        const ys = points.map((p) => p.y);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
        const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
        const deg = bestHorizontalRotation(points, cx, cy);
        const at = rotatedExtent(points, cx, cy, deg);
        // 最宽轴严格水平：旋转后宽 ≥ 高，且宽度为局部最大（±2° 内不更大）
        expect(at.w).toBeGreaterThanOrEqual(at.h);
        for (const delta of [-2, -1, -0.5, 0.5, 1, 2]) {
          const other = rotatedExtent(points, cx, cy, deg + delta);
          expect(at.w).toBeGreaterThanOrEqual(other.w - 1e-6);
        }
      }
    }
  });
});
