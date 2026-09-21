/**
 * research-calibration 结构契约：
 * - 6 轨列中心单调递增且在 0..1；等级格 y 覆盖 L0..L5 且 L5 在最上；
 * - 9 个标准科技板位、6+1 高级板槽、7 power + 3 qic 行动格坐标合法；
 * - techTileSlot 对 9 位均给出 0..1 坐标。
 */
import { describe, expect, it } from 'vitest';
import type { BoardActionId, TechTilePosition } from '@gaia/engine';
import {
  ADV_TECH_Y,
  BOARD_ACTION_SLOTS,
  FREE_TECH_SLOTS,
  POWER_ACTION_SLOTS,
  QIC_ACTION_SLOTS,
  TECH_STACK_OFFSET_PCT,
  TECH_TILE_ASPECT,
  TRACK_COLUMN_X,
  TRACK_LEVEL_Y,
  techTileSlot,
} from './research-calibration';
import { TRACK_ORDER } from './PlayerMat';

function expect01(v: number, label: string): void {
  expect(v, label).toBeGreaterThanOrEqual(0);
  expect(v, label).toBeLessThanOrEqual(1);
}

describe('research-calibration 结构', () => {
  it('6 轨列中心覆盖 TRACK_ORDER 且单调递增', () => {
    const xs = TRACK_ORDER.map((t) => TRACK_COLUMN_X[t]);
    expect(xs).toHaveLength(6);
    for (let i = 0; i < xs.length; i++) {
      expect01(xs[i]!, `col ${TRACK_ORDER[i]}`);
      if (i > 0) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    }
  });

  it('等级格 y：L0..L5 共 6 级，L5 最上 L0 最下', () => {
    expect(TRACK_LEVEL_Y).toHaveLength(6);
    for (const y of TRACK_LEVEL_Y) expect01(y, 'level y');
    expect(TRACK_LEVEL_Y[5]!).toBeLessThan(TRACK_LEVEL_Y[0]!);
  });

  it('9 个标准科技板位坐标均在 0..1', () => {
    const positions: readonly TechTilePosition[] = ['terra', 'nav', 'int', 'gaia', 'eco', 'sci', 'free1', 'free2', 'free3'];
    expect(FREE_TECH_SLOTS).toHaveLength(3);
    for (const pos of positions) {
      const p = techTileSlot(pos);
      expect01(p.x, `${pos}.x`);
      expect01(p.y, `${pos}.y`);
    }
    expect01(ADV_TECH_Y, 'adv y');
  });

  it('堆叠常量合法：顶片满宽、偏移步长适中（4 层左下偏移不越界）、宽高比 > 1', () => {
    expect(TECH_TILE_ASPECT).toBeGreaterThan(1);
    expect(TECH_STACK_OFFSET_PCT).toBeGreaterThan(0);
    // 4 层堆叠：3 层偏移 ≤ 槽宽 1/3（顶片满宽居中，下层仅露边缘）
    expect(3 * TECH_STACK_OFFSET_PCT).toBeLessThanOrEqual(34);
  });

  it('7 power + 3 qic 行动格坐标均在 0..1 且左→右递增', () => {
    expect(POWER_ACTION_SLOTS).toHaveLength(7);
    expect(QIC_ACTION_SLOTS).toHaveLength(3);
    const ids: readonly BoardActionId[] = ['power1', 'power2', 'power3', 'power4', 'power5', 'power6', 'power7', 'qic1', 'qic2', 'qic3'];
    let prevX = -1;
    for (const id of ids) {
      const p = BOARD_ACTION_SLOTS[id];
      expect01(p.x, `${id}.x`);
      expect01(p.y, `${id}.y`);
      expect(p.x, id).toBeGreaterThan(prevX);
      prevX = p.x;
    }
  });
});
