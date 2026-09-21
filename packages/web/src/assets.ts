/**
 * 原版桌游素材路径映射（美术重构）：引擎 id → public/assets 静态路径。
 *
 * 素材为个人非商用用途随仓库分发（参照 Brass 做法），全部走
 * `public/assets` 静态路径（不 import 进 bundle，vite 原样拷贝）。
 *
 * 板块图为 Etchelon 命名，映射已逐一对照原版组件确认：
 * - 科技板 tech1..9 → TEC*；高级板 advtech1..15 → ADV*；
 * - 回合计分 score1..10 → RND*；终局 6 → FIN*；助推器 10 → BOO*；
 * - 联邦标记 fed1..6/gleens → FED*；
 * - LF 素材在 lf/ 下（船板/深空三角/Interspace/星球贴图/神器/金框标记等）。
 */
import type {
  AdvTechTileId,
  ArtifactId,
  BoosterId,
  BuildingType,
  FactionId,
  FederationTokenId,
  FinalTileId,
  PlanetType,
  ScoringTileId,
  ShipId,
  TechTileId,
} from '@gaia/engine';

const A = '/assets';

// ---------------------------------------------------------------------------
// 扇区 / 地图
// ---------------------------------------------------------------------------

/** 标准扇区整版扫描图（5A/6A/7A 为无描边面，B 面为 outlined）。 */
export function sectorImage(sectorId: string): string | null {
  switch (sectorId) {
    case '5A':
      return `${A}/sectors/5.png`;
    case '5B':
      return `${A}/sectors/5outlined.png`;
    case '6A':
      return `${A}/sectors/6.png`;
    case '6B':
      return `${A}/sectors/6outlined.png`;
    case '7A':
      return `${A}/sectors/7.png`;
    case '7B':
      return `${A}/sectors/7outlined.png`;
    case '8':
    case '9':
    case '10':
    case '1':
    case '2':
    case '3':
    case '4':
      return `${A}/sectors/${sectorId}.png`;
    default:
      return null;
  }
}

/** LF Interspace 单格图（飞船格按船给图）。 */
export function interspaceImage(planet: PlanetType, ship: ShipId | undefined): string {
  if (ship !== undefined) return `${A}/lf/interspace/map_interspace_${ship}.png`;
  if (planet === 'asteroid' || planet === 'proto') return `${A}/lf/interspace/map_interspace_${planet}.png`;
  return `${A}/lf/interspace/map_interspace_empty.png`;
}

/** LF 深空三角板（tile 11–18，side a/b）。 */
export function deepSpaceImage(tile: number, side: 'a' | 'b'): string {
  return `${A}/lf/deep-space/map_deep_${tile}${side}.png`;
}

/** LF 单星球贴图（gaia 转化/失落星球等需要覆盖原画的情形）。 */
export function planetTexture(planet: PlanetType): string | null {
  switch (planet) {
    case 'gaia':
      return `${A}/lf/planets/planet_gaia.png`;
    case 'transdim':
      return `${A}/lf/planets/planet_transdim.png`;
    case 'asteroid':
      return `${A}/lf/planets/planet_asteroid.png`;
    case 'proto':
      return `${A}/lf/planets/planet_proto.png`;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// 建筑棋子（LF 青/粉无图：用相近色 + CSS hue-rotate 兜底）
// ---------------------------------------------------------------------------

const BUILDING_PREFIX: Record<string, string> = {
  mine: 'MI',
  ts: 'TS',
  lab: 'RL',
  pi: 'PI',
  ac1: 'AC',
  ac2: 'AC',
  gf: 'GF',
};

/** 族色 → 建筑图文件色名（engine 'gray' → 文件 'grey'；pink/turquoise 取近似色）。 */
const BUILDING_COLOR_FILE: Record<string, string> = {
  blue: 'blue',
  yellow: 'yellow',
  brown: 'brown',
  red: 'red',
  orange: 'orange',
  gray: 'grey',
  white: 'white',
  pink: 'red',
  turquoise: 'blue',
};

/** 近似色图需要的 hue-rotate 补偿（pink←red、turquoise←blue）。 */
export const BUILDING_COLOR_FILTER: Record<string, string | undefined> = {
  pink: 'hue-rotate(-50deg) saturate(1.4)',
  // 青色与亚特兰斯星人纯蓝要有明显区分：往青绿方向多转一些
  turquoise: 'hue-rotate(-65deg) saturate(1.3) brightness(1.05)',
};

/** 建筑棋子图（sp 无棋子——用 markers/SpaceStation）。 */
export function buildingImage(type: BuildingType, factionColor: string): string {
  if (type === 'sp') return `${A}/markers/SpaceStation.png`;
  const prefix = BUILDING_PREFIX[type] ?? 'MI';
  const color = BUILDING_COLOR_FILE[factionColor] ?? 'white';
  return `${A}/buildings/${prefix}_${color}.png`;
}

/** 已裁透明边距的建筑棋子图（地图用：可见大小 = 绘制大小）。 */
export function buildingImageTrimmed(type: BuildingType, factionColor: string): string {
  if (type === 'sp') return `${A}/markers/SpaceStation.png`;
  const prefix = BUILDING_PREFIX[type] ?? 'MI';
  const color = BUILDING_COLOR_FILE[factionColor] ?? 'white';
  return `${A}/buildings/trim/${prefix}_${color}.png`;
}

// ---------------------------------------------------------------------------
// 族面板 / 标记 / 背景
// ---------------------------------------------------------------------------

/** 族面板头图（注意 moweyds 的文件名拼写为 mowyeds.jpg）。 */
export function factionImage(factionId: string): string {
  const file = factionId === 'moweyds' ? 'mowyeds' : factionId;
  return `${A}/factions/${file}.jpg`;
}

/** 族板整图（factions/hi/）文件名映射（含扩展名）；moweyds 无高清图为 null（回退旧布局）。 */
const FACTION_BOARD_HI_FILE: Record<FactionId, string | null> = {
  terrans: 'Terrans.jpg',
  lantids: 'Lantids.jpg',
  xenos: 'Xenos.jpg',
  gleens: 'Gleens.jpg',
  taklons: 'Taklons.jpg',
  ambas: 'Ambas.jpg',
  'hadsch-hallas': 'HadschHallas.jpg',
  ivits: 'Ivits.jpg',
  geodens: 'Geodens.jpg',
  baltaks: 'BalTaks.jpg',
  firaks: 'Firak.jpg',
  bescods: 'Bescods.jpg',
  nevlas: 'Nevlas.jpg',
  itars: 'Itars.jpg',
  'space-giants': 'space-giants_board_bgg9503663.png',
  tinkeroids: 'tinkeroids_board_feuerland.jpg',
  darkanians: 'darkanians_board_bgg9503663.png',
  // moweyds：BGG 9503664 西班牙版开箱照下半块（Octopoides；曾误用 wellplayed 图——实为 space-giants 板）
  moweyds: 'moweyds_board_bgg9503664.png',
};

/** 族板整图（Etchelon 扫描 / LF 官方渲染·BGG 开箱正面照）；null = 无高清图。 */
export function factionBoardImage(factionId: FactionId): string | null {
  const file = FACTION_BOARD_HI_FILE[factionId];
  return file === null ? null : `${A}/factions/hi/${file}`;
}

/** 资源/标记图标（markers/*.png，首字母大写命名）。 */
export function markerImage(name: string): string {
  return `${A}/markers/${name}.png`;
}

/** 行动格已用盖片（trim 版：裁过透明边距，渲染 width = 内容直径，见 ship/research-calibration）。 */
export const ACTION_TOKEN_IMAGE = `${A}/markers/trim/ActionToken.png`;

/** 种族飞船面板（LF 探索板整图，用户自拍抠图素材，factions/panels/<id>.png）。 */
export function factionPanelImage(factionId: FactionId): string {
  return `${A}/factions/panels/${factionId}.png`;
}

export const PAGE_BACKGROUND = `${A}/bg/background.jpg`;
export const RESEARCH_BOARD_BG = `${A}/boards/ResearchBoard.jpg`;

/** 计分板整图（用户自拍抠图，含外圈行星装饰）：标准局直接用，LF 局下方再接梯形扩展片。 */
export const SCOREBOARD_BASE_IMAGE = `${A}/boards/scoreboard-base.png`;

/** LF 计分板梯形扩展片（按 scoringExtension 选面：vp=25 胜点解锁 / ships=探索 3 船解锁）。 */
export function scoreboardExtImage(face: 'vp' | 'ships'): string {
  return `${A}/lf/scoreboard-ext-${face}.png`;
}

/** LF QIC 覆盖板（盖住科技轨右下角 3 个绿水晶行动格）。 */
export const QIC_COVER_IMAGE = `${A}/lf/qic-cover.png`;

// ---------------------------------------------------------------------------
// 板块图（Etchelon 命名 → 引擎 id）
// ---------------------------------------------------------------------------

const TECH_TILE_FILE: Record<TechTileId, string> = {
  tech1: 'TECqic',
  tech2: 'TECtyp',
  tech3: 'TECpia',
  tech4: 'TECvps',
  tech5: 'TECore',
  tech6: 'TECknw',
  tech7: 'TECgai',
  tech8: 'TECcre',
  tech9: 'TECpow',
  techlf1: 'shiptech_terra',
  techlf2: 'shiptech_range',
  techlf3: 'shiptech_1o3k',
};

const ADV_TECH_FILE: Record<AdvTechTileId, string> = {
  advtech1: 'ADVfedP',
  advtech2: 'ADVstp',
  advtech3: 'ADVqic',
  advtech4: 'ADVminV',
  advtech5: 'ADVlab',
  advtech6: 'ADVsecO',
  advtech7: 'ADVtyp',
  advtech8: 'ADVgai',
  advtech9: 'ADVtrsV',
  advtech10: 'ADVsecV',
  advtech11: 'ADVore',
  advtech12: 'ADVfedV',
  advtech13: 'ADVknw',
  advtech14: 'ADVminB',
  advtech15: 'ADVtrsB',
  advtechlf1: 'adv_big',
  advtechlf2: 'adv_deep',
  advtechlf3: 'adv_asteroidpass',
  advtechlf4: 'adv_deeppass',
  advtechlf5: 'adv_qaction',
  advtechlf6: 'adv_terra',
};

const ROUND_SCORING_FILE: Record<ScoringTileId, string> = {
  score1: 'RNDter',
  score2: 'RNDstp',
  score3: 'RNDmin',
  score4: 'RNDfed',
  score5: 'RNDtrs4',
  score6: 'RNDgai4',
  score7: 'RNDpia',
  score8: 'RNDtrs3',
  score9: 'RNDgai3',
  score10: 'RNDpia',
  scorelf1: 'round_sector3',
  scorelf2: 'round_planet3',
  scorelf3: 'round_lab4',
};

const FINAL_SCORING_FILE: Record<FinalTileId, string> = {
  structure: 'FINbld',
  structureFed: 'FINfed',
  gaia: 'FINgai',
  satellite: 'FINsat',
  sector: 'FINsec',
  planetType: 'FINtyp',
  asteroid: 'final_asteroid',
  deepSpace: 'final_deep',
  piAcademyDistance: 'final_distance',
};

const BOOSTER_FILE: Record<BoosterId, string> = {
  booster1: 'BOOknw',
  booster2: 'BOOpwt',
  booster3: 'BOOqic',
  booster4: 'BOOter',
  booster5: 'BOOnav',
  booster6: 'BOOmin',
  booster7: 'BOOlab',
  booster8: 'BOOtrs',
  booster9: 'BOOpia',
  booster10: 'BOOgai',
  boosterlf1: 'booster_former',
  boosterlf2: 'booster_planet',
  boosterlf3: 'booster_deep',
  boosterlf4: 'booster_instant',
};

const FEDERATION_FILE: Record<FederationTokenId, string> = {
  fed1: 'FEDvps',
  fed2: 'FEDqic',
  fed3: 'FEDpwt',
  fed4: 'FEDore',
  fed5: 'FEDcre',
  fed6: 'FEDknw',
  gleens: 'FEDgle',
  fedlf1: 'shipfed_vp',
  fedlf2: 'shipfed_tech',
  fedlf3: 'shipfed_range',
  fedlf4: 'shipfed_terra',
  fedlf5: 'shipfed_c',
  fedlf6: 'shipfed_k',
  fedlf7: 'shipfed_oq',
  fedlf8: 'shipfed_pwt',
};

/** 标准科技板图（LF 船上 3 种在 lf/tech-tiles/）。 */
export function techTileImage(id: TechTileId): string {
  const file = TECH_TILE_FILE[id];
  return file.startsWith('TEC') ? `${A}/tiles/tech/${file}.png` : `${A}/lf/tech-tiles/${file}.png`;
}

export function advTechTileImage(id: AdvTechTileId): string {
  const file = ADV_TECH_FILE[id];
  return file.startsWith('ADV') ? `${A}/tiles/tech/${file}.png` : `${A}/lf/tech-tiles/${file}.png`;
}

export function roundScoringImage(id: ScoringTileId): string {
  const file = ROUND_SCORING_FILE[id];
  return file.startsWith('RND') ? `${A}/tiles/scoring/${file}.png` : `${A}/lf/scoring/${file}.png`;
}

export function finalScoringImage(id: FinalTileId): string {
  const file = FINAL_SCORING_FILE[id];
  return file.startsWith('FIN') ? `${A}/tiles/final/${file}.png` : `${A}/lf/scoring/${file}.png`;
}

export function boosterImage(id: BoosterId): string {
  const file = BOOSTER_FILE[id];
  return file.startsWith('BOO') ? `${A}/tiles/boosters/${file}.png` : `${A}/lf/boosters/${file}.png`;
}

export function federationTokenImage(id: FederationTokenId): string {
  const file = FEDERATION_FILE[id];
  return file.startsWith('FED') ? `${A}/tiles/federations/${file}.png` : `${A}/lf/federation-tokens/${file}.png`;
}

// ---------------------------------------------------------------------------
// Lost Fleet
// ---------------------------------------------------------------------------

/** 船板整图（Twilight/TF-Mars 用 BGG 开箱高清正面照，平整无透视；Rebellion/Eclipse 用 feuerland 照片）。 */
export const SHIP_BOARD_IMAGE: Record<ShipId, string> = {
  twilight: `${A}/lf/ships/twilight_board_render.jpg`,
  rebellion: `${A}/lf/ships/rebellion_board_feuerland.jpg`,
  tfmars: `${A}/lf/ships/tfmars_board_render.jpg`,
  eclipse: `${A}/lf/ships/eclipse_board_feuerland.jpg`,
};

export function artifactImage(id: ArtifactId): string {
  return `${A}/lf/artifacts/artifact_${id.replace('art-', '')}.png`;
}

/** Tinkering 板块单图（官方合影裁切抠底，lf/misc/tinkering/tinkN.png）。 */
export function tinkeringTileImage(id: string): string {
  return `${A}/lf/misc/tinkering/${id}.png`;
}

export const SHUTTLE_IMAGE = `${A}/lf/misc/shuttle.png`;
/** 按族色预染的穿梭机图（PIL 亮度映射生成，lf/misc/shuttle/<color>.png，共 9 色）。 */
export function shuttleImage(color: string): string {
  return `${A}/lf/misc/shuttle/${color}.png`;
}
export const POWER_RING_IMAGE = `${A}/lf/misc/powerring.png`;

/** LF 经济轨 L3/L4 覆盖板（pw/vp 双面）。 */
export function economyOverlayImage(face: 'pw' | 'vp'): string {
  return `${A}/lf/misc/econ_${face}.png`;
}

/** LF 计分板扩展（第 7 高级板槽）解锁条件指示（vp=25 胜点 / ships=3 穿梭机）。 */
export function advConditionImage(cond: 'vp' | 'ships'): string {
  return `${A}/lf/misc/advcond_${cond === 'ships' ? 'shuttle' : 'vp'}.png`;
}
