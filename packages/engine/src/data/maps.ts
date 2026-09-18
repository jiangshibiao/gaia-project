/**
 * 地图布局配置。
 * 数据核对：reference/gaia-engine/src/map.ts 63–103 行。
 * 注意：中心点按代码里的循环生成顺序（[(0,0)] + Hex(5,-2) 旋转 0..5 次；
 * big 再加 Hex(-6,10) 绕 pivot(-3,5) 旋转 -1,0,1 次），
 * 不是 smallCenters/bigCenters 硬编码数组的 legacy 顺序。
 */
import { rotateRight, type Hex } from '../hex.js';
import type { SectorId } from './sectors.js';

const ORIGIN: Hex = { q: 0, r: 0 };

/** 小图（1–2 人）7 个扇区中心：(0,0) + (5,-2) 绕原点顺时针旋转 0–5 次。 */
export function smallMapCenters(): Hex[] {
  const centers: Hex[] = [{ q: 0, r: 0 }];
  for (let i = 0; i < 6; i++) {
    centers.push(rotateRight({ q: 5, r: -2 }, ORIGIN, i));
  }
  return centers;
}

/** 大图（3–4 人）10 个扇区中心：小图 7 个 + (-6,10) 绕 pivot(-3,5) 旋转 -1,0,1 次。 */
export function bigMapCenters(): Hex[] {
  const centers = smallMapCenters();
  const pivot: Hex = { q: -3, r: 5 };
  for (const times of [-1, 0, 1]) {
    centers.push(rotateRight({ q: -6, r: 10 }, pivot, times));
  }
  return centers;
}

/** 标准小图选用的扇区（05–07 用 B 面）。 */
export const STANDARD_SECTORS_SMALL: readonly SectorId[] = ['1', '2', '3', '4', '5B', '6B', '7B'];

/** 标准大图选用的扇区（05–07 用 A 面）。 */
export const STANDARD_SECTORS_BIG: readonly SectorId[] = [
  '1',
  '2',
  '3',
  '4',
  '5A',
  '6A',
  '7A',
  '8',
  '9',
  '10',
];

// ---------------------------------------------------------------------------
// Lost Fleet 地图布局在 data/lostfleet.ts：
// 外圈扇区错位 1 格的几何（扇区中心/Interspace 孔位/深空三角缺口 halo 算法）+
// 全部 LF 内容数据（实证核定，见 docs/rules-summary.md §2 M1.6 实现口径）。
// ---------------------------------------------------------------------------
