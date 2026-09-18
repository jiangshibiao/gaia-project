/**
 * 地图构建与纯查询。
 * 构建算法参照 reference/gaia-engine/src/map.ts：每块扇区按 SECTOR_POSITIONS
 * 铺到绝对坐标（相对坐标 + center 后绕 center rotateRight）。
 * 全部函数为纯查询，不修改入参。
 */
import {
  hexAdd,
  hexDistance,
  hexKey,
  hexNeighbors,
  parseHexKey,
  rotateRight,
  SECTOR_POSITIONS,
  type Hex,
  type HexKey,
} from './hex.js';
import type { HexBuilding, HexState, PlanetType, PlayerIndex } from './types.js';
import { SECTORS, type SectorId } from './data/sectors.js';
import { HOME_PLANET_TYPES } from './data/planets.js';
import { BUILDING_POWER_VALUE } from './data/prices.js';

const HOME_TYPES: readonly string[] = HOME_PLANET_TYPES;

function isHomePlanet(planet: PlanetType): boolean {
  return HOME_TYPES.includes(planet);
}

/**
 * 把若干扇区铺成绝对坐标地图。
 * @param sectorIds 扇区 id（'1'..'10'、'5A'/'5B' 等），顺序对应 centers
 * @param rotations 每块扇区顺时针旋转次数（0–5）
 * @param centers 每块扇区的绝对中心坐标
 * 坐标重叠或扇区 id 未知时抛错（地图配置 bug，不应静默）。
 */
export function buildMap(
  sectorIds: string[],
  rotations: number[],
  centers: Hex[],
): Record<HexKey, HexState> {
  if (sectorIds.length !== rotations.length || sectorIds.length !== centers.length) {
    throw new Error(
      `buildMap: 参数长度不一致 sectorIds=${sectorIds.length} rotations=${rotations.length} centers=${centers.length}`,
    );
  }
  const map: Record<HexKey, HexState> = {};
  for (let i = 0; i < sectorIds.length; i++) {
    const sectorId = sectorIds[i] as SectorId;
    const def = SECTORS[sectorId];
    const center = centers[i];
    const rotation = rotations[i];
    if (def === undefined || center === undefined || rotation === undefined) {
      throw new Error(`buildMap: 未知扇区 id: ${String(sectorIds[i])}`);
    }
    for (let j = 0; j < SECTOR_POSITIONS.length; j++) {
      // SECTOR_POSITIONS 是扇区相对坐标：先加 center 得绝对坐标，再绕 center 旋转。
      const abs = rotateRight(hexAdd(SECTOR_POSITIONS[j]!, center), center, rotation);
      const key = hexKey(abs);
      if (map[key] !== undefined) {
        throw new Error(`buildMap: 坐标重叠 ${key}（扇区 ${sectorId}）`);
      }
      map[key] = {
        planet: def.layout[j]!,
        sector: sectorId,
        deepSpace: false,
        federations: [],
      };
    }
  }
  return map;
}

/**
 * 地图合法性（german 规则，参照 reference map.ts isValid）：
 * 任意两个相邻 hex 不得是同种母星类型；gaia/transdim/empty（及非母星类型）豁免。
 */
export function isValidMap(map: Record<HexKey, HexState>): boolean {
  for (const [key, hex] of Object.entries(map) as [HexKey, HexState][]) {
    if (!isHomePlanet(hex.planet)) {
      continue;
    }
    for (const nbKey of mapNeighbors(map, key)) {
      const nb = map[nbKey]!;
      // 每个无序对检查一次即可，但双向检查不影响正确性，保持简单。
      if (nb.planet === hex.planet) {
        return false;
      }
    }
  }
  return true;
}

/** 图内相邻 hex（只返回地图中存在的格）。 */
export function mapNeighbors(map: Record<HexKey, HexState>, hex: HexKey): HexKey[] {
  const out: HexKey[] = [];
  for (const nb of hexNeighbors(parseHexKey(hex))) {
    const key = hexKey(nb);
    if (map[key] !== undefined) {
      out.push(key);
    }
  }
  return out;
}

/** 距 center（含自身）dist 格以内的图内 hex。 */
export function hexesWithin(
  map: Record<HexKey, HexState>,
  center: HexKey,
  dist: number,
): HexKey[] {
  const c = parseHexKey(center);
  const out: HexKey[] = [];
  for (const key of Object.keys(map) as HexKey[]) {
    if (hexDistance(c, parseHexKey(key)) <= dist) {
      out.push(key);
    }
  }
  return out;
}

/** from 集合中到 to 的最小距离；from 为空返回 Infinity。 */
export function minDistanceToAny(
  map: Record<HexKey, HexState>,
  from: HexKey[],
  to: HexKey,
): number {
  const target = parseHexKey(to);
  let min = Infinity;
  for (const key of from) {
    if (map[key] === undefined) {
      continue;
    }
    const d = hexDistance(parseHexKey(key), target);
    if (d < min) {
      min = d;
    }
  }
  return min;
}

/** 玩家在地图上的全部建筑（含 gf/sp；不含 Lantids 附加矿）。 */
export function playerBuildings(
  map: Record<HexKey, HexState>,
  player: PlayerIndex,
): { hex: HexKey; building: HexBuilding }[] {
  const out: { hex: HexKey; building: HexBuilding }[] = [];
  for (const [key, hex] of Object.entries(map) as [HexKey, HexState][]) {
    if (hex.building !== undefined && hex.building.player === player) {
      out.push({ hex: key, building: hex.building });
    }
  }
  return out;
}

/**
 * 玩家已殖民的 hex（参照 reference/gaia-engine/src/gaia-hex.ts colonizedBy）：
 * 建筑 power value > 0 才算殖民——gf/sp 不算；Lantids 附加矿算殖民。
 */
export function colonizedHexes(
  map: Record<HexKey, HexState>,
  player: PlayerIndex,
): HexKey[] {
  const out: HexKey[] = [];
  for (const [key, hex] of Object.entries(map) as [HexKey, HexState][]) {
    if (hex.additionalMine === player) {
      out.push(key);
      continue;
    }
    if (
      hex.building !== undefined &&
      hex.building.player === player &&
      BUILDING_POWER_VALUE[hex.building.type] > 0
    ) {
      out.push(key);
    }
  }
  return out;
}
