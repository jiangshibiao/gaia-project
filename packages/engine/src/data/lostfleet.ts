/**
 * Lost Fleet 扩展数据：地图布局几何 + 内容数据（实证核定，见 docs/rules-summary.md §2）。
 *
 * 1. **布局几何（确定性）**：由"外圈扇区沿环错位 1 格"推导出的扇区中心、
 *    Interspace 孔位、深空三角缺口。几何与 reference/gaia-project/engine/src/
 *    lost-fleet-map.ts 的 halo 算法一致（深空缺口 = 外缘 halo 中接壤 ≥2 个扇区的
 *    种子格 + 两个互为邻居的外缘格构成的 3 格三角形）：
 *    - 2 人：01–07（05–07 B 面），中心 1 + 外圈 6 错位 → 6 个单格孔；
 *      飞船格两两相距恰好 5 格；外缘 6 个深空三角缺口。
 *    - 3 人：01–10 去 08，6 孔 + 2 额外孔放 8 块 Interspace（飞船格间距 ≥3）；
 *      8 个深空缺口（其中一对相邻 = 规则书"大缺口并排放 2 块"，自然成立）。
 *    - 4 人：全 10 扇区（05–07 A 面），中心 2 + 外圈 8 → 10 孔
 *      （飞船格不相邻、间距 ≥3）；8 个深空缺口。
 *
 * 2. **内容数据（实证核定）**：深空三角板 11–18 的 16 个面（每格 P 原行星 /
 *    A 小行星 / M Transdim / B 空白）、Interspace 各组构成、飞船行动格按船
 *    分配、科技槽船、探索轨充能 0/2/2/3、Artifacts 13 枚、Tinkering tiles
 *    6 块、Economy 轨 L3/L4 覆盖板两面。
 */
import type { Hex, HexKey } from '../hex.js';
import { hexDistance, hexKey, hexNeighbors } from '../hex.js';
import type {
  ArtifactState,
  PlanetType,
  ShipActionId,
  ShipId,
  TinkeringTileId,
} from '../types.js';
import type { ResourceGain } from './rewards.js';

// ---------------------------------------------------------------------------
// 布局几何：环坐标与扇区中心
// ---------------------------------------------------------------------------

/**
 * 半径 5 的 hex 环（30 格，从 (5,-2) 出发逆时针一圈）。
 * 标准小图外圈中心 = 环上 index 0/5/10/15/20/25（即 (5,-2) 的 6 次旋转）。
 */
function ringPositions(radius: number): Hex[] {
  const start: Hex = { q: radius, r: -2 };
  const out: Hex[] = [start];
  let cur = start;
  let prev: Hex | null = null;
  // 沿环行走：每步取"距原点 == radius 且不是来路"的邻居。
  for (;;) {
    let next: Hex | null = null;
    for (const d of [
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 },
    ]) {
      const n = { q: cur.q + d.q, r: cur.r + d.r };
      if (hexDistance(n, { q: 0, r: 0 }) === radius && (prev === null || n.q !== prev.q || n.r !== prev.r)) {
        next = n;
        break;
      }
    }
    if (next === null || (next.q === out[0]!.q && next.r === out[0]!.r)) {
      break;
    }
    out.push(next);
    prev = cur;
    cur = next;
  }
  return out;
}

const RING5 = ringPositions(5);

/** 半径 2 扇区覆盖的 19 格。 */
function sectorCells(center: Hex): Hex[] {
  const out: Hex[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const h = { q: center.q + q, r: center.r + r };
      if (hexDistance(h, center) <= 2) {
        out.push(h);
      }
    }
  }
  return out;
}

/**
 * LF 标准扇区中心（外圈整体错位 1 格：每块外扇区与内扇区只沿 2 格相接）。
 * core = 中心扇区（放 01–04）；outer = 外圈（含 3/4 人局的附加扇区）。
 * 坐标由几何脚本推导验证（孔洞数与飞船间距满足规则书文字约束）。
 */
export function lfStandardCenters(playerCount: number): { core: Hex[]; outer: Hex[] } {
  const ring6 = [2, 7, 12, 17, 22, 27].map((i) => RING5[i]!);
  if (playerCount <= 2) {
    return { core: [{ q: 0, r: 0 }], outer: ring6 };
  }
  if (playerCount === 3) {
    return { core: [{ q: 0, r: 0 }], outer: [...ring6, { q: 6, r: -9 }, { q: 9, r: -3 }] };
  }
  // 4 人：中心 2 块（(0,0) 与 (5,-4)），外圈 8 块。
  return {
    core: [
      { q: 0, r: 0 },
      { q: 5, r: -4 },
    ],
    outer: [...ring6.slice(1), { q: 6, r: -9 }, { q: 9, r: -3 }, { q: 10, r: -8 }],
  };
}

/**
 * Interspace 孔位：被标准扇区完全包围的单格空洞（6 邻居全被占的空格）。
 * 由扇区中心计算（2/3/4 人 = 6/8/10 个），无需硬编码。
 */
export function lfHolePositions(playerCount: number): HexKey[] {
  const { core, outer } = lfStandardCenters(playerCount);
  const occupied = new Set<HexKey>();
  for (const c of [...core, ...outer]) {
    for (const h of sectorCells(c)) {
      occupied.add(hexKey(h));
    }
  }
  const holes = new Set<HexKey>();
  for (const k of occupied) {
    const [q, r] = k.split(',').map(Number) as [number, number];
    for (const nb of hexNeighbors({ q, r })) {
      const nk = hexKey(nb);
      if (!occupied.has(nk) && hexNeighbors(nb).every((n2) => occupied.has(hexKey(n2)))) {
        holes.add(nk);
      }
    }
  }
  return [...holes].sort();
}

// ---------------------------------------------------------------------------
// 深空三角缺口（halo 算法，与 reference lost-fleet-map.ts findDeepSpaceNotches 一致）
// ---------------------------------------------------------------------------

interface HaloInfo {
  /** 空格 key → 它接壤的不同扇区 index 集合。 */
  touch: Map<HexKey, Set<number>>;
  cells: Map<HexKey, Hex>;
}

/** 扇区布局的 halo：所有标准扇区格外一圈的空格及其接壤扇区。 */
function buildHalo(centers: Hex[]): HaloInfo {
  const occupied = new Set<HexKey>();
  for (const c of centers) {
    for (const h of sectorCells(c)) {
      occupied.add(hexKey(h));
    }
  }
  const touch = new Map<HexKey, Set<number>>();
  const cells = new Map<HexKey, Hex>();
  centers.forEach((c, idx) => {
    for (const h of sectorCells(c)) {
      for (const n of hexNeighbors(h)) {
        const k = hexKey(n);
        if (occupied.has(k)) {
          continue;
        }
        if (!touch.has(k)) {
          touch.set(k, new Set());
          cells.set(k, n);
        }
        touch.get(k)!.add(idx);
      }
    }
  });
  return { touch, cells };
}

/** cellKeys 的邻接连通分量（大的在前；cells 提供坐标）。 */
function haloComponents(cellKeys: Set<HexKey>, cells: Map<HexKey, Hex>): HexKey[][] {
  const seen = new Set<HexKey>();
  const comps: HexKey[][] = [];
  for (const start of cellKeys) {
    if (seen.has(start)) {
      continue;
    }
    const stack = [start];
    seen.add(start);
    const comp: HexKey[] = [];
    while (stack.length > 0) {
      const ck = stack.pop()!;
      comp.push(ck);
      for (const n of hexNeighbors(cells.get(ck)!)) {
        const nk = hexKey(n);
        if (cellKeys.has(nk) && !seen.has(nk)) {
          seen.add(nk);
          stack.push(nk);
        }
      }
    }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  return comps;
}

/**
 * 深空三角缺口（3 格三角形）：外缘无界区域中接壤 ≥2 个不同扇区的种子格
 * （相邻两外扇区之间的楔形内角）+ 它的两个互为邻居的外缘格。
 * 数量 = 深空板放置数（2/3/4 人 = 6/8/8）。3 人局恰好一对缺口互相相邻
 * （规则书"最后放置的扇区旁大缺口并排放 2 块"，无需特判）。
 */
export function lfDeepSpaceNotches(playerCount: number): Hex[][] {
  const { core, outer } = lfStandardCenters(playerCount);
  const centers = [...core, ...outer];
  const { touch, cells } = buildHalo(centers);
  const comps = haloComponents(new Set(touch.keys()), cells);
  const outerRegion = new Set(comps[0]); // 最大分量 = 无界外缘
  const seeds = [...outerRegion].filter((k) => touch.get(k)!.size >= 2);

  return seeds.map((seedKey) => {
    const seed = cells.get(seedKey)!;
    const outerNbs = hexNeighbors(seed).filter((n) => outerRegion.has(hexKey(n)));
    for (let i = 0; i < outerNbs.length; i++) {
      for (let j = i + 1; j < outerNbs.length; j++) {
        if (hexNeighbors(outerNbs[i]!).some((n) => n.q === outerNbs[j]!.q && n.r === outerNbs[j]!.r)) {
          return [seed, outerNbs[i]!, outerNbs[j]!];
        }
      }
    }
    throw new Error(`lfDeepSpaceNotches: 缺口 ${seedKey} 找不到成三角的两个外缘邻居——几何数据错误`);
  });
}

// ---------------------------------------------------------------------------
// 深空三角板（8 块双面，编号 11–18；2 人局只用 11–16）
// 每面 3 格：P=原行星 A=小行星 M=Transdim B=空白（无标准色星球、无 gaia）。
// 数据来源：reference/gaia-project/engine/src/lost-fleet-map.ts DEEP_SPACE_TILES。
// ---------------------------------------------------------------------------

export interface DeepSpaceTileDef {
  id: number;
  a: readonly [PlanetType, PlanetType, PlanetType];
  b: readonly [PlanetType, PlanetType, PlanetType];
}

const P: PlanetType = 'proto';
const A: PlanetType = 'asteroid';
const M: PlanetType = 'transdim';
const B: PlanetType = 'empty';

export const DEEP_SPACE_TILES: readonly DeepSpaceTileDef[] = [
  { id: 11, a: [P, A, B], b: [A, B, B] },
  { id: 12, a: [M, P, B], b: [A, B, B] },
  { id: 13, a: [M, B, A], b: [B, B, A] },
  { id: 14, a: [P, B, A], b: [B, B, A] },
  { id: 15, a: [P, B, B], b: [P, B, A] },
  { id: 16, a: [B, B, P], b: [A, B, A] }, // b 面 2 个小行星（"最多小行星"终局板的保底翻转对象）
  { id: 17, a: [M, B, B], b: [B, A, B] },
  { id: 18, a: [P, B, B], b: [A, B, B] },
];

/** 各人数使用的深空板（2 人局 11–16；3/4 人局全部 8 块）。 */
export function lfDeepSpaceTilePool(playerCount: number): DeepSpaceTileDef[] {
  return playerCount <= 2 ? DEEP_SPACE_TILES.filter((t) => t.id <= 16) : [...DEEP_SPACE_TILES];
}

// ---------------------------------------------------------------------------
// Interspace 构成（实证核定；飞船身份见 lfShipsFor）
// ---------------------------------------------------------------------------

/** 各人数 Interspace 非飞船格内容（proto/asteroid/empty）。 */
export const LF_INTERSPACE_FILL: Record<number, readonly PlanetType[]> = {
  // 2 人：3 飞船 + 2 小行星 + 1 原行星 = 6 块
  2: ['proto', 'asteroid', 'asteroid'],
  // 3 人：4 飞船 + 2 小行星 + 1 原行星 + 1 空白 = 8 块
  3: ['proto', 'asteroid', 'asteroid', 'empty'],
  // 4 人：4 飞船 + 4 小行星 + 1 原行星 + 1 空白 = 10 块
  4: ['proto', 'asteroid', 'asteroid', 'asteroid', 'asteroid', 'empty'],
};

/** 各人数使用的飞船（2 人局不用 Rebellion）。 */
export function lfShipsFor(playerCount: number): ShipId[] {
  return playerCount <= 2 ? ['twilight', 'tfmars', 'eclipse'] : ['twilight', 'rebellion', 'tfmars', 'eclipse'];
}

// ---------------------------------------------------------------------------
// 飞船行动格（每船固定 3 格 = 1 QIC + 1 Power + 1 Knowledge/Credit；实证核定）
// ---------------------------------------------------------------------------

export const SHIP_ACTION_SPACES: Record<ShipId, readonly ShipActionId[]> = {
  twilight: ['ship-rescore-fed', 'ship-upgrade-ts-lab', 'ship-range3'],
  rebellion: ['ship-tech-tile', 'ship-upgrade-mine-ts', 'ship-2c1q'],
  tfmars: ['ship-vp-per-tech', 'ship-instant-gaia', 'ship-terraform-step'],
  eclipse: ['ship-vp-per-planet', 'ship-research', 'ship-asteroid-mine'],
};

/** 有标准科技板槽的船（各 1 槽；Twilight 0 槽改放 Artifacts）。 */
export const SHIP_TECH_SLOT_SHIPS: readonly ShipId[] = ['rebellion', 'tfmars', 'eclipse'];

/** 探索轨 4 格充能值 0/2/2/3（非格号；slot index 即格序）。 */
export function shuttleSlotCharge(slotIndex: number): number {
  return [0, 2, 2, 3][slotIndex] ?? 0;
}

/** 各人数每人的穿梭机数（2 人 2 个 / 3–4 人 3 个）。 */
export function shuttlesPerPlayer(playerCount: number): number {
  return playerCount <= 2 ? 2 : 3;
}

// ---------------------------------------------------------------------------
// Artifact 池（13 枚各不相同）
// ---------------------------------------------------------------------------

export function artifactPool(): ArtifactState[] {
  return [
    { id: 'art-1k1o' },
    { id: 'art-3c3o' },
    { id: 'art-3k1q' },
    { id: 'art-5c2o' },
    { id: 'art-asteroid' },
    { id: 'art-proto' },
    { id: 'art-sci' },
    { id: 'art-gaia' },
    { id: 'art-track' },
    { id: 'art-planet' },
    { id: 'art-deep' },
    { id: 'art-fed' },
    { id: 'art-pwt' },
  ];
}

// ---------------------------------------------------------------------------
// Tinkering tiles（6 块，实证核定）
// ---------------------------------------------------------------------------

export interface TinkeringTileDef {
  id: TinkeringTileId;
  /** 可用轮次组：1–3 轮 / 4–6 轮。 */
  rounds: 'early' | 'late';
  name: string;
}

export const TINKERING_TILES: Record<TinkeringTileId, TinkeringTileDef> = {
  tink1: { id: 'tink1', rounds: 'early', name: '建矿（1 免费 terraform 步）' },
  tink2: { id: 'tink2', rounds: 'early', name: '充能 4 power' },
  tink3: { id: 'tink3', rounds: 'early', name: '获得 1 QIC' },
  tink4: { id: 'tink4', rounds: 'late', name: '建矿（3 免费 terraform 步）' },
  tink5: { id: 'tink5', rounds: 'late', name: '获得 3 知识' },
  tink6: { id: 'tink6', rounds: 'late', name: '获得 2 QIC' },
};

/** 某轮可选的 tinkering tile 组。 */
export function tinkeringGroupForRound(round: number): 'early' | 'late' {
  return round <= 3 ? 'early' : 'late';
}

// ---------------------------------------------------------------------------
// Economy 轨 L3/L4 覆盖板（1 块双面，setup 随机选面；实证核定）
// ---------------------------------------------------------------------------

export interface EconomyOverlayFace {
  /** L3/L4 收入（替代基础收入；L3 到达时的充能 3pw 一次性奖励不受影响）。 */
  l3: ResourceGain;
  l4: ResourceGain;
}

export const ECONOMY_OVERLAY: Record<'pw' | 'vp', EconomyOverlayFace> = {
  pw: {
    l3: { ore: 1, credits: 2, chargePower: 3 },
    l4: { ore: 2, credits: 2, chargePower: 2 },
  },
  vp: {
    l3: { ore: 1, credits: 3, vp: 1 },
    l4: { ore: 2, credits: 4, vp: 1 },
  },
};
