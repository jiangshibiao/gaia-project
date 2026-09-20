/**
 * ship-calibration 结构契约：
 * - 4 船齐全；shuttleSlots 恰 4 格、actionSpaces 恰 3 格；
 * - 所有相对坐标在 0..1 内；各尺寸为正且 < 1；
 * - Twilight 无科技槽但有 4 个神器位；其余船有科技槽、无神器位。
 */
import { describe, expect, it } from 'vitest';
import type { ShipId } from '@gaia/engine';
import { SHIP_CALIBRATION } from './ship-calibration';
import type { RelPoint } from './ship-calibration';

const SHIPS: readonly ShipId[] = ['twilight', 'rebellion', 'tfmars', 'eclipse'];

function expectPoint(p: RelPoint): void {
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.x).toBeLessThanOrEqual(1);
  expect(p.y).toBeGreaterThanOrEqual(0);
  expect(p.y).toBeLessThanOrEqual(1);
}

describe('ship-calibration 结构', () => {
  it('4 船齐全，每船 4 穿梭机位 + 3 行动格，坐标均在 0..1', () => {
    for (const id of SHIPS) {
      const cal = SHIP_CALIBRATION[id];
      expect(cal, id).toBeDefined();
      expect(cal.shuttleSlots, id).toHaveLength(4);
      expect(cal.actionSpaces, id).toHaveLength(3);
      for (const p of cal.shuttleSlots) expectPoint(p);
      for (const p of cal.actionSpaces) expectPoint(p);
      expectPoint(cal.fedToken);
      for (const key of ['shuttleSize', 'actionSize', 'actionTokenSize', 'techWidth', 'artifactWidth'] as const) {
        expect(cal[key], `${id}.${key}`).toBeGreaterThan(0);
        expect(cal[key], `${id}.${key}`).toBeLessThan(1);
      }
    }
  });

  it('Twilight 无科技槽、4 神器位；其余船有科技槽、无神器位', () => {
    expect(SHIP_CALIBRATION.twilight.techSlot).toBeNull();
    expect(SHIP_CALIBRATION.twilight.artifacts).toHaveLength(4);
    for (const p of SHIP_CALIBRATION.twilight.artifacts!) expectPoint(p);
    for (const id of ['rebellion', 'tfmars', 'eclipse'] as const) {
      expect(SHIP_CALIBRATION[id].techSlot, id).not.toBeNull();
      expectPoint(SHIP_CALIBRATION[id].techSlot!);
      expect(SHIP_CALIBRATION[id].artifacts, id).toBeNull();
    }
  });

  it('穿梭机位 4 格互不相同（避免叠点标错）', () => {
    for (const id of SHIPS) {
      const keys = SHIP_CALIBRATION[id].shuttleSlots.map((p) => `${p.x},${p.y}`);
      expect(new Set(keys).size, id).toBe(4);
    }
  });

  it('tfmars 按 TTS 官方渲染（3411×1050）标定：左列 4 穿梭机位 + 中上 3 行动格 + 右侧科技槽/中下徽章', () => {
    const cal = SHIP_CALIBRATION.tfmars;
    expect(cal.width).toBe(3411);
    expect(cal.height).toBe(1050);
    // 探索轨：左竖列自上而下（x≈0.22 恒定，y 递增）
    for (const p of cal.shuttleSlots) expect(p.x).toBeCloseTo(0.22, 2);
    expect(cal.shuttleSlots.map((p) => p.y)).toEqual([
      expect.closeTo(0.244, 2),
      expect.closeTo(0.455, 2),
      expect.closeTo(0.633, 2),
      expect.closeTo(0.82, 2),
    ]);
    // 3 个六边形行动格：中上部左→右（绿/粉/黄）
    expect(cal.actionSpaces[0]).toEqual({ x: expect.closeTo(0.3725, 2), y: expect.closeTo(0.398, 2) });
    expect(cal.actionSpaces[1]).toEqual({ x: expect.closeTo(0.4875, 2), y: expect.closeTo(0.39, 2) });
    expect(cal.actionSpaces[2]).toEqual({ x: expect.closeTo(0.605, 2), y: expect.closeTo(0.382, 2) });
    // 科技板槽在右侧屏幕面板，联邦标记槽盖在中下印刷的徽章上
    expect(cal.techSlot).toEqual({ x: expect.closeTo(0.852, 2), y: expect.closeTo(0.454, 2) });
    expect(cal.fedToken).toEqual({ x: expect.closeTo(0.685, 2), y: expect.closeTo(0.755, 2) });
  });
});
