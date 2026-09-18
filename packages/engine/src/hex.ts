/**
 * 六边形格 axial 坐标几何（无第三方依赖）。
 * axial (q, r)，第三轴 s = -q - r。
 * 与 reference/gaia-engine 的坐标系一致：rotRight(q,r,s) = (-r,-s,-q)。
 */

export interface Hex {
  q: number;
  r: number;
}

export type HexKey = `${number},${number}`;

export function hexKey(h: Hex): HexKey {
  return `${h.q},${h.r}`;
}

export function parseHexKey(k: HexKey): Hex {
  const [q, r] = k.split(',').map(Number);
  return { q: q as number, r: r as number };
}

export function hexS(h: Hex): number {
  return -h.q - h.r;
}

export function hexAdd(a: Hex, b: Hex): Hex {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function hexSub(a: Hex, b: Hex): Hex {
  return { q: a.q - b.q, r: a.r - b.r };
}

export function hexDistance(a: Hex, b: Hex): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

/** 六个方向（axial）。 */
export const HEX_DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexNeighbors(h: Hex): Hex[] {
  return HEX_DIRECTIONS.map((d) => hexAdd(h, d));
}

/** 顺时针旋转 60° × times（绕 center）。cube: (q,r,s) → (-r,-s,-q)。 */
export function rotateRight(h: Hex, center: Hex, times: number): Hex {
  let q = h.q - center.q;
  let r = h.r - center.r;
  let s = -q - r;
  const t = ((times % 6) + 6) % 6;
  for (let i = 0; i < t; i++) {
    const nq = -r;
    const nr = -s;
    const ns = -q;
    q = nq;
    r = nr;
    s = ns;
  }
  return { q: q + center.q, r: r + center.r };
}

/**
 * 扇区内 19 个位置的相对坐标，顺序与 reference/gaia-engine 的扇区字符串编码一致：
 * 外圈 12（A0–A11）→ 中圈 6（B0–B5）→ 中心 1（C）。
 * 已用 reference/gaia-engine/src/map.spec.ts 的三组断言核对。
 */
export const SECTOR_POSITIONS: readonly Hex[] = [
  // 外圈 A0..A11
  { q: 2, r: 0 },
  { q: 1, r: 1 },
  { q: 0, r: 2 },
  { q: -1, r: 2 },
  { q: -2, r: 2 },
  { q: -2, r: 1 },
  { q: -2, r: 0 },
  { q: -1, r: -1 },
  { q: 0, r: -2 },
  { q: 1, r: -2 },
  { q: 2, r: -2 },
  { q: 2, r: -1 },
  // 中圈 B0..B5
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  // 中心 C
  { q: 0, r: 0 },
];
