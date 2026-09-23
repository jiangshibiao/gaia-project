/**
 * 扇区大板块边界（sectorOutlineSegments）几何测试：
 * - 19 格标准扇区（边长 3 的六边形簇）边界线段数 = 6×(2×3−1) = 30；
 * - 每格只画单描边（BoardSvg 每格一个 .hex-edge，无双层）由组件渲染测试覆盖在
 *   GameScreen/App 层，这里只锁几何口径；
 * - 边界线段端点不落在扇区内部（抽样：线段两端点到扇区中心距离 > 内格中心最远距离）。
 */
import { describe, expect, it } from 'vitest';
import { newGame, type HexKey } from '@gaia/engine';
import { computePlacements } from './placements';
import { HEX_SIZE, hexToPixel, sectorOutlineSegments } from './BoardSvg';

describe('sectorOutlineSegments（扇区大板块边界）', () => {
  const state = newGame({ playerCount: 2, seed: 42, factions: ['terrans', 'xenos'], lostFleet: true });
  const placements = computePlacements(state.map);

  it('每个 19 格标准扇区边界 = 30 条线段（6 边 × (2×3−1)）', () => {
    expect(placements.sectors.length).toBeGreaterThan(0);
    for (const p of placements.sectors) {
      const cells = (Object.keys(state.map) as HexKey[]).filter((k) => state.map[k]!.sector === p.id);
      expect(cells, `sector ${p.id} 格数`).toHaveLength(19);
      const segs = sectorOutlineSegments(state.map, p.id);
      expect(segs, `sector ${p.id} 边界线段数`).toHaveLength(30);
    }
  });

  it('边界线段在扇区外缘（端点到扇区中心距离 > 任一格中心距离）', () => {
    for (const p of placements.sectors) {
      const c = hexToPixel(p.center.q, p.center.r);
      let maxCellDist = 0;
      for (const k of Object.keys(state.map) as HexKey[]) {
        if (state.map[k]!.sector !== p.id) continue;
        const { q, r } = ((): { q: number; r: number } => {
          const [a, b] = k.split(',').map(Number);
          return { q: a!, r: b! };
        })();
        const pt = hexToPixel(q, r);
        maxCellDist = Math.max(maxCellDist, Math.hypot(pt.x - c.x, pt.y - c.y));
      }
      for (const [x1, y1, x2, y2] of sectorOutlineSegments(state.map, p.id)) {
        // 边界端点距中心应大于最远格中心（在格外缘）
        expect(Math.hypot(x1 - c.x, y1 - c.y)).toBeGreaterThan(maxCellDist);
        expect(Math.hypot(x2 - c.x, y2 - c.y)).toBeGreaterThan(maxCellDist);
        // 且不超过最远格中心 + 格外接圆半径（贴合边界而非漂在外太空）
        expect(Math.hypot(x1 - c.x, y1 - c.y)).toBeLessThanOrEqual(maxCellDist + HEX_SIZE * 1.01);
      }
    }
  });
});
