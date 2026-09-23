/**
 * 从地图状态推导扇区摆放（placement）：GameState 只持久化每格的
 * sector/planet，不存 setup 时的 center/rotation，渲染整版扫描图前需反推。
 *
 * - 标准扇区（SECTORS 内的 id）：中心 = 6 邻居全在同扇区的格（唯一定理）；
 *   旋转 = 使"旋转后的相对坐标内容 == 当前地图内容"的唯一 0–5 值。
 * - LF 深空三角板（sector 为 '11'..'18'）：3 格；面（a/b）按内容多重集
 *   对照 DEEP_SPACE_TILES 判定；旋转按"标准三角坐标 + rotateRight×k 后
 *   与实格位置/内容对齐"判定（三角板 3 重旋转对称，镜像与旋转等价）。
 * - Interspace（sector='interspace'）：单格，无需推导。
 *
 * 内容比对用"美术等价"：盖亚计划把 transdim→gaia、失落星球把 empty→lost，
 * 所以 actual='gaia' 兼容 expected∈{gaia,transdim}，actual='lost' 兼容
 * expected='empty'；其余需精确相等。
 *
 * 同时产出 artPlanet：每格"原画上的内容"（扇区 layout / 深空面内容 /
 * Interspace 实内容）——叠加层只画"与原画不同"的星球（gaia 转化、失落星球）。
 */
import {
  DEEP_SPACE_TILES,
  SECTORS,
  SECTOR_POSITIONS,
  hexAdd,
  hexKey,
  parseHexKey,
  rotateRight,
} from '@gaia/engine';
import type { Hex, HexKey, HexState, PlanetType } from '@gaia/engine';

/** 标准扇区摆放。 */
export interface SectorPlacement {
  id: string;
  center: Hex;
  /** 顺时针旋转次数（0–5，与 buildMap 的 rotation 同义）。 */
  rotation: number;
}

/** 深空三角板摆放。 */
export interface DeepSpacePlacement {
  tile: number;
  side: 'a' | 'b';
  /** 图像旋转（顺时针 60° 的倍数，0–5）。 */
  rotation: number;
  /** 是否需镜像（三角板带内容后是手性的：notch 格序两种环绕方向都会出现）。 */
  mirror: boolean;
  /** 实格中对应"标准三角 f1=(0,0)"的格（图像定位锚点）。 */
  anchor: Hex;
}

export interface MapPlacements {
  sectors: SectorPlacement[];
  deepSpace: DeepSpacePlacement[];
  /** 每格原画内容（无原画的格——如 'none' 扇区——取当前 planet）。 */
  artPlanet: Map<HexKey, PlanetType>;
}

/** 美术等价判定（见模块注释）。 */
function artEquals(actual: PlanetType, expected: PlanetType): boolean {
  if (actual === expected) return true;
  if (actual === 'gaia' && (expected === 'transdim' || expected === 'gaia')) return true;
  if (actual === 'lost' && expected === 'empty') return true;
  return false;
}

const ORIGIN: Hex = { q: 0, r: 0 };

/**
 * 深空三角板图像的标准坐标（已对照 map_deep_11a.png 判定）：
 * face[0] 在左（apex）、face[1] 右上、face[2] 右下（flat-top 像素系）。
 */
const DEEP_CANONICAL: readonly Hex[] = [
  { q: -1, r: 1 }, // face[0]：左
  { q: 0, r: 0 }, // face[1]：右上（锚点）
  { q: 0, r: 1 }, // face[2]：右下
];

/**
 * 深空板**图像**的标准面序（face[0]左 / face[1]右上 / face[2]右下）与引擎
 * DEEP_SPACE_TILES 数据序不一致的板面（按图逐格标定）：11b/18b 图像
 * 小行星在右上，数据序却给在 face[0]——渲染匹配必须用图像序（内容匹配用
 * 数据序照旧，引擎循环位移下两者游戏语义等价，仅渲染会错格）。
 */
const DEEP_IMAGE_FACE_ORDER: Readonly<Record<string, readonly [PlanetType, PlanetType, PlanetType]>> = {
  '11b': ['empty', 'asteroid', 'empty'],
  '18b': ['empty', 'asteroid', 'empty'],
};

/** 深空图像内 hex 外接圆半径（286×283 图紧密包围 3 个 flat-top hex 推得）。 */
export const DEEP_IMAGE_HEX_SIZE = 283 / (2 * Math.sqrt(3));
/** 锚点（face[1] hex）在图内的像素坐标。 */
export const DEEP_IMAGE_ANCHOR = { x: 286 - DEEP_IMAGE_HEX_SIZE, y: (DEEP_IMAGE_HEX_SIZE * Math.sqrt(3)) / 2 };
export const DEEP_IMAGE_WIDTH = 286;
export const DEEP_IMAGE_HEIGHT = 283;

/** Interspace 单格图尺寸与 hex 半径（165×142 flat-top 紧密包围）。 */
export const INTERSPACE_IMAGE_WIDTH = 165;
export const INTERSPACE_IMAGE_HEIGHT = 142;

/** 推导整图摆放（纯函数；地图不变时结果稳定，调用方应 useMemo）。 */
export function computePlacements(map: Record<HexKey, HexState>): MapPlacements {
  const artPlanet = new Map<HexKey, PlanetType>();
  const bySector = new Map<string, HexKey[]>();
  for (const key of Object.keys(map) as HexKey[]) {
    const list = bySector.get(map[key]!.sector) ?? [];
    list.push(key);
    bySector.set(map[key]!.sector, list);
  }

  const sectors: SectorPlacement[] = [];
  const deepSpace: DeepSpacePlacement[] = [];

  for (const [sectorId, keys] of bySector) {
    if (SECTORS[sectorId as keyof typeof SECTORS] !== undefined) {
      const p = placeStandardSector(map, sectorId, keys, artPlanet);
      if (p !== null) sectors.push(p);
    } else if (/^1[1-8]$/.test(sectorId)) {
      const p = placeDeepSpaceTile(map, Number(sectorId), keys, artPlanet);
      if (p !== null) deepSpace.push(p);
    } else {
      // interspace / none：原画 = 当前内容
      for (const k of keys) artPlanet.set(k, map[k]!.planet);
    }
  }

  return { sectors, deepSpace, artPlanet };
}

/** 标准扇区：定中心（全 19 格都在其 2 格范围内的唯一格）+ 匹配旋转。 */
function placeStandardSector(
  map: Record<HexKey, HexState>,
  sectorId: string,
  keys: HexKey[],
  artPlanet: Map<HexKey, PlanetType>,
): SectorPlacement | null {
  const def = SECTORS[sectorId as keyof typeof SECTORS];
  // 中心 = 全扇区 19 格都在其 2 格范围内的唯一 hex
  // （B 环格到对边 A 环距离为 3；6 邻居同属判据对 B 环格也成立，不能用来定中心）。
  const centerKey = keys.find((k) => {
    const h = parseHexKey(k);
    return keys.every((k2) => {
      const d = parseHexKey(k2);
      return Math.max(Math.abs(h.q - d.q), Math.abs(h.r - d.r), Math.abs(h.q - d.q + h.r - d.r)) <= 2;
    });
  });
  if (centerKey === undefined) return null;
  const center = parseHexKey(centerKey);

  for (let rotation = 0; rotation < 6; rotation++) {
    let ok = true;
    for (let j = 0; j < SECTOR_POSITIONS.length; j++) {
      const abs = rotateRight(hexAdd(SECTOR_POSITIONS[j]!, center), center, rotation);
      const hex = map[hexKey(abs)];
      if (hex === undefined || !artEquals(hex.planet, def.layout[j]!)) {
        ok = false;
        break;
      }
    }
    if (ok) {
      for (let j = 0; j < SECTOR_POSITIONS.length; j++) {
        const abs = rotateRight(hexAdd(SECTOR_POSITIONS[j]!, center), center, rotation);
        artPlanet.set(hexKey(abs), def.layout[j]!);
      }
      return { id: sectorId, center, rotation };
    }
  }
  // 匹配失败（不应发生）：不摆图，但保留原画=当前内容避免误叠加
  for (const k of keys) artPlanet.set(k, map[k]!.planet);
  return null;
}

/** 深空三角板：定面（内容多重集）+ 匹配旋转/锚点。 */
function placeDeepSpaceTile(
  map: Record<HexKey, HexState>,
  tileId: number,
  keys: HexKey[],
  artPlanet: Map<HexKey, PlanetType>,
): DeepSpacePlacement | null {
  const def = DEEP_SPACE_TILES.find((t) => t.id === tileId);
  if (def === undefined || keys.length !== 3) return null;

  const sorted = (arr: readonly PlanetType[]) => [...arr].sort().join(',');
  const actual = sorted(keys.map((k) => map[k]!.planet));
  // 盖亚计划/失落星球会改变内容：先精确比，再放宽（gaia≈transdim、lost≈empty）
  let side: 'a' | 'b' | null = null;
  for (const s of ['a', 'b'] as const) {
    if (sorted(def[s]) === actual) side = s;
  }
  if (side === null) {
    // 放宽匹配：逐面尝试旋转对齐（artEquals 处理转化）
    for (const s of ['a', 'b'] as const) {
      if (matchDeepRotation(map, keys, def[s]) !== null) {
        side = s;
        break;
      }
    }
  }
  if (side === null) return null;

  const face = def[side];
  const match = matchDeepRotation(map, keys, face);
  if (match === null) return null;
  const mirrorTransform = (c: Hex): Hex => (match.mirror ? { q: c.q, r: -c.q - c.r } : c);
  for (let i = 0; i < 3; i++) {
    const abs = hexAdd(rotateRight(mirrorTransform(DEEP_CANONICAL[i]!), ORIGIN, match.rotation), match.anchor);
    artPlanet.set(hexKey(abs), face[i]!);
  }
  // 渲染摆放：图像面序与数据序不一致的板面（DEEP_IMAGE_FACE_ORDER）改按图像序
  // 匹配——否则图里的小行星会落到数据序对应格之外的格子（11b/18b 会错一格）。
  const renderFace = DEEP_IMAGE_FACE_ORDER[`${tileId}${side}`] ?? face;
  const renderMatch =
    renderFace === face ? match : matchDeepRotation(map, keys, renderFace);
  return renderMatch !== null
    ? { tile: tileId, side, rotation: renderMatch.rotation, mirror: renderMatch.mirror, anchor: renderMatch.anchor }
    : { tile: tileId, side, rotation: match.rotation, mirror: match.mirror, anchor: match.anchor };
}

/**
 * 找 (rotation, mirror, anchor) 使标准三角（可先镜像）旋转平移后与实格
 * 逐格内容美术等价。镜像 = cube (q,r,s)→(q,s,r)，即像素系 y→-y 翻转。
 */
function matchDeepRotation(
  map: Record<HexKey, HexState>,
  keys: HexKey[],
  face: readonly PlanetType[],
): { rotation: number; mirror: boolean; anchor: Hex } | null {
  // 变换后的 3 格必须恰好落在本板块 3 格内——否则重复内容（两个 empty 等）
  // 会把锚点误配到邻近的同内容格外。
  const inSector = new Set(keys);
  for (const mirror of [false, true]) {
    const canonical = DEEP_CANONICAL.map((c) => (mirror ? { q: c.q, r: -c.q - c.r } : c));
    for (let rotation = 0; rotation < 6; rotation++) {
      const rotated = canonical.map((c) => rotateRight(c, ORIGIN, rotation));
      // 锚点 = face[1] 对应的实格（f1=(0,0) 旋转/镜像后仍是原点）；遍历 3 种平移
      for (const key of keys) {
        const anchor = parseHexKey(key);
        let ok = true;
        for (let i = 0; i < 3; i++) {
          const abs = hexAdd(rotated[i]!, anchor);
          const hex = map[hexKey(abs)];
          if (!inSector.has(hexKey(abs)) || hex === undefined || !artEquals(hex.planet, face[i]!)) {
            ok = false;
            break;
          }
        }
        if (ok) return { rotation, mirror, anchor };
      }
    }
  }
  return null;
}
