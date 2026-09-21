/**
 * faction-calibration 结构契约：
 * - 18 个 FactionId 均有校准条目，且全部有高清图（moweyds 于 2026-09 补齐）；
 * - hi 文件名映射正确（BalTaks/Firak/HadschHallas 拼写；LF 照片板为 .png）；
 * - 全部叠加坐标在 0..1；槽位数：矿 8 / TS 4 / 实验室 3 / gaiaformer 3；
 * - 槽位 x 左→右递增（取用顺序）；bescods PI/学院左右互换；
 * - darkanians/space-giants 用 LF 开箱正面照单独标定（2870×1851）；
 * - moweyds 用 wellplayed 官方渲染图（990×641，布局与模板逐点吻合）。
 */
import { describe, expect, it } from 'vitest';
import type { FactionId } from '@gaia/engine';
import { FACTIONS } from '@gaia/engine';
import { factionBoardImage } from '../assets';
import { BUILDING_SPRITE, factionCalibration } from './faction-calibration';
import type { RelPoint } from './research-calibration';

const ALL_FACTIONS = Object.keys(FACTIONS) as FactionId[];

function expect01(p: RelPoint, label: string): void {
  expect(p.x, `${label}.x`).toBeGreaterThanOrEqual(0);
  expect(p.x, `${label}.x`).toBeLessThanOrEqual(1);
  expect(p.y, `${label}.y`).toBeGreaterThanOrEqual(0);
  expect(p.y, `${label}.y`).toBeLessThanOrEqual(1);
}

describe('faction-calibration 结构', () => {
  it('18 族均有条目且全部有高清图', () => {
    expect(ALL_FACTIONS).toHaveLength(18);
    for (const f of ALL_FACTIONS) {
      const cal = factionCalibration(f);
      expect(cal.aspect).toBeGreaterThan(1);
      expect(cal.image, f).toMatch(/^\/assets\/factions\/hi\/.+\.(jpg|png)$/);
    }
  });

  it('hi 文件名映射（BalTaks/Firak/HadschHallas/LF 板）', () => {
    expect(factionBoardImage('baltaks')).toBe('/assets/factions/hi/BalTaks.jpg');
    expect(factionBoardImage('firaks')).toBe('/assets/factions/hi/Firak.jpg');
    expect(factionBoardImage('hadsch-hallas')).toBe('/assets/factions/hi/HadschHallas.jpg');
    expect(factionBoardImage('space-giants')).toBe('/assets/factions/hi/space-giants_board_bgg9503663.png');
    expect(factionBoardImage('tinkeroids')).toBe('/assets/factions/hi/tinkeroids_board_feuerland.jpg');
    expect(factionBoardImage('darkanians')).toBe('/assets/factions/hi/darkanians_board_bgg9503663.png');
    expect(factionBoardImage('moweyds')).toBe('/assets/factions/hi/moweyds_board_wellplayed.jpg');
  });

  it('全部叠加坐标在 0..1，槽位数正确', () => {
    for (const f of ALL_FACTIONS) {
      const cal = factionCalibration(f);
      for (const bowl of ['bowl1', 'bowl2', 'bowl3', 'gaia'] as const) {
        expect01(cal.power[bowl], `${f}.power.${bowl}`);
      }
      expect(cal.mineSlots, f).toHaveLength(8);
      expect(cal.tsSlots, f).toHaveLength(4);
      expect(cal.labSlots, f).toHaveLength(3);
      expect(cal.gaiaformerSlots, f).toHaveLength(3);
      for (const [i, s] of cal.mineSlots.entries()) expect01(s, `${f}.mine[${i}]`);
      for (const [i, s] of cal.tsSlots.entries()) expect01(s, `${f}.ts[${i}]`);
      for (const [i, s] of cal.labSlots.entries()) expect01(s, `${f}.lab[${i}]`);
      for (const [i, s] of cal.gaiaformerSlots.entries()) expect01(s, `${f}.gf[${i}]`);
      expect01(cal.piSlot, `${f}.pi`);
      expect01(cal.ac1Slot, `${f}.ac1`);
      expect01(cal.ac2Slot, `${f}.ac2`);
    }
  });

  it('收入轨槽位 x 左→右递增（模板族）', () => {
    const cal = factionCalibration('terrans');
    const xs = (slots: readonly RelPoint[]) => slots.map((s) => s.x);
    for (const slots of [cal.mineSlots, cal.tsSlots, cal.labSlots, cal.gaiaformerSlots]) {
      const list = xs(slots);
      for (let i = 1; i < list.length; i++) {
        expect(list[i]!).toBeGreaterThan(list[i - 1]!);
      }
    }
  });

  it('bescods：PI 与学院位置左右互换', () => {
    const t = factionCalibration('terrans');
    // 模板：PI 在左，学院在右
    expect(t.piSlot.x).toBeLessThan(t.ac1Slot.x);
    expect(t.ac1Slot.x).toBeLessThan(t.ac2Slot.x);
    const b = factionCalibration('bescods');
    // bescods：学院在左，PI 在右
    expect(b.ac1Slot.x).toBeLessThan(b.ac2Slot.x);
    expect(b.ac2Slot.x).toBeLessThan(b.piSlot.x);
    expect(b.ac1Slot.x).toBeLessThan(0.2);
    expect(b.piSlot.x).toBeGreaterThan(0.4);
  });

  it('gleens：专属联邦片槽在 PI 右侧徽章位（不遮挡 PI 棋子）；其他族无此槽', () => {
    const g = factionCalibration('gleens');
    expect(g.gleensFedSlot).toBeDefined();
    expect01(g.gleensFedSlot!, 'gleens.fed');
    expect(g.gleensFedSlot!.x).toBeGreaterThan(g.piSlot.x);
    expect(factionCalibration('terrans').gleensFedSlot).toBeUndefined();
  });

  it('darkanians/space-giants：LF 正面照标定坐标合法且保留槽位顺序', () => {
    for (const f of ['darkanians', 'space-giants'] as const) {
      const cal = factionCalibration(f);
      expect(cal.aspect).toBeCloseTo(2870 / 1851, 5);
      const xs = cal.mineSlots.map((s) => s.x);
      for (let i = 1; i < xs.length; i++) {
        expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
      }
    }
  });
});

/** clip inset(top right bottom left) → 可见内容宽占比。 */
function visibleWidthFrac(clip: string | null): number {
  if (clip === null) return 1;
  const m = clip.match(/inset\(([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\s+([\d.]+)%\)/);
  if (m === null) throw new Error(`非法 clip: ${clip}`);
  return 1 - (Number(m[2]) + Number(m[4])) / 100;
}

describe('BUILDING_SPRITE 收入轨建筑尺寸', () => {
  it('五种规格齐全；图宽合法；仅 PI 不裁剪', () => {
    for (const k of ['mine', 'ts', 'lab', 'pi', 'academy'] as const) {
      const s = BUILDING_SPRITE[k];
      expect(s.width, k).toBeGreaterThan(0.03);
      expect(s.width, k).toBeLessThan(0.15);
    }
    expect(BUILDING_SPRITE.pi.clip).toBeNull();
    for (const k of ['mine', 'ts', 'lab', 'academy'] as const) {
      expect(BUILDING_SPRITE[k].clip, k).toMatch(/^inset\(/);
    }
  });

  it('内容宽度比例 = 实物：矿 < TS < 实验室 < 学院 < PI', () => {
    const content = (k: keyof typeof BUILDING_SPRITE): number =>
      BUILDING_SPRITE[k].width * visibleWidthFrac(BUILDING_SPRITE[k].clip);
    expect(content('mine')).toBeLessThan(content('ts'));
    expect(content('ts')).toBeLessThan(content('lab'));
    expect(content('lab')).toBeLessThan(content('academy'));
    expect(content('academy')).toBeLessThan(content('pi'));
    // 矿/TS/实验室明显放大（旧版内容仅 ~0.014–0.033 相对图宽）
    expect(content('mine')).toBeGreaterThan(0.025);
    expect(content('ts')).toBeGreaterThan(0.03);
    expect(content('lab')).toBeGreaterThan(0.045);
  });

  it('内容宽度不超过槽位间距（相邻棋子不重叠）', () => {
    const content = (k: keyof typeof BUILDING_SPRITE): number =>
      BUILDING_SPRITE[k].width * visibleWidthFrac(BUILDING_SPRITE[k].clip);
    const cal = factionCalibration('terrans');
    const pitch = (slots: readonly RelPoint[]): number =>
      Math.min(...slots.slice(1).map((s, i) => s.x - slots[i]!.x));
    expect(content('mine')).toBeLessThan(pitch(cal.mineSlots));
    expect(content('ts')).toBeLessThan(pitch(cal.tsSlots));
    expect(content('lab')).toBeLessThan(pitch(cal.labSlots));
  });
});
