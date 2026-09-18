/**
 * 13 块扇区定义（10 块物理扇区，05/06/07 有 A/B 双面）。
 * 数据核对：reference/gaia-engine/src/map.ts 12–24 行的 19 字符编码。
 * layout 顺序 = SECTOR_POSITIONS（外圈 A0–A11 → 中圈 B0–B5 → 中心 C）。
 *
 * Lost Fleet 深空三角板 11–18（8 块双面，每块 3 格）的内容见
 * data/lostfleet.ts DEEP_SPACE_TILES（实证核定）；本表只含 19 格标准扇区。
 */
import type { PlanetType } from '../types.js';

/** 扇区编码字符 → 星球类型（与 reference/gaia-engine 一致）。 */
export const SECTOR_CHAR_TO_PLANET = {
  e: 'empty',
  r: 'terra',
  d: 'desert',
  s: 'swamp',
  o: 'oxide',
  v: 'volcanic',
  t: 'titanium',
  i: 'ice',
  g: 'gaia',
  m: 'transdim',
} as const satisfies Record<string, PlanetType>;

export type SectorChar = keyof typeof SECTOR_CHAR_TO_PLANET;

/** 13 个扇区 id。 */
export type SectorId =
  | '1'
  | '2'
  | '3'
  | '4'
  | '5A'
  | '5B'
  | '6A'
  | '6B'
  | '7A'
  | '7B'
  | '8'
  | '9'
  | '10';

export interface SectorDef {
  id: SectorId;
  /** 19 格，顺序 = SECTOR_POSITIONS。 */
  layout: readonly PlanetType[];
}

/** reference/gaia-engine/src/map.ts 的原始编码（逗号分隔 外圈/中圈/中心）。 */
const RAW_SECTORS: Record<SectorId, string> = {
  '1': 'eeemevoeedee,ereees,e',
  '2': 'teedemeoeeev,eieese,e',
  '3': 'meeteedreeee,eeieeg,e',
  '4': 'teeereeeeiee,oeseve,e',
  '5A': 'iemoeedveeee,eeeeeg,e',
  '5B': 'iemoeeeveeee,eeeeeg,e',
  '6A': 'emeedmeeeeee,ereges,e',
  '6B': 'emeedmeeeeee,eregee,e',
  '7A': 'eseeeeteeeme,oegege,e',
  '7B': 'eeeeeeteeeme,gesege,e',
  '8': 'remeeeemeeee,ieteve,e',
  '9': 'emieeeeeseev,eegete,e',
  '10': 'emmeeeeoreee,eegeed,e',
};

function parseSectorLayout(raw: string): PlanetType[] {
  const layout = [...raw.replace(/,/g, '')].map((ch) => {
    const planet = SECTOR_CHAR_TO_PLANET[ch as SectorChar];
    if (planet === undefined) {
      throw new Error(`未知扇区编码字符: ${ch}`);
    }
    return planet as PlanetType;
  });
  if (layout.length !== 19) {
    throw new Error(`扇区格数必须为 19，实际 ${layout.length}: ${raw}`);
  }
  return layout;
}

function buildSectors(): Record<SectorId, SectorDef> {
  const result = {} as Record<SectorId, SectorDef>;
  for (const id of Object.keys(RAW_SECTORS) as SectorId[]) {
    result[id] = { id, layout: parseSectorLayout(RAW_SECTORS[id]) };
  }
  return result;
}

export const SECTORS: Record<SectorId, SectorDef> = buildSectors();
