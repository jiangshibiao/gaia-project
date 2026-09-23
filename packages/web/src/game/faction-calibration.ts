/**
 * 族板整图（public/assets/factions/hi/）的叠加校准。
 *
 * 全部相对坐标（0..1，原点左上）。以 Terrans.jpg（1753×1117，Etchelon 扫描）
 * 为模板用 ReadMediaFile 分区放大逐点标定，并与 Etchelon 前端的
 * player-board 几何数据交叉核对（我们的 hi/ 扫描与其 Boards_original 同源）：
 * - 顶部 0..15 资源轨（印刷轨，资源数值不叠加，见 PlayerMat 图下图标条）；
 * - 左上 power 循环：绿圆 = gaia 区，上紫 = II 区，下暗 = I 区，右大紫 = III 区；
 * - 右上 3 个六边形 = gaiaformer 槽；
 * - 收入轨（建筑放上地图即从面板取走、揭开印刷收入）：
 *   上行 = PI（左，盖 4pw+1QIC 收入）+ 学院×2（右，知识学院 ac1 / QIC 学院 ac2）；
 *   中行 = 贸易站×4（左，3/4/4/5c）+ 实验室×3（右，各 1k）；
 *   下行 = 矿×8（各 1o；最左 1o 为不被覆盖的基础收入，第 3 槽无印刷收入）。
 *   建筑"从左到右取用"（规则），故面板剩余建筑占靠右的槽。
 * - bescods：PI 与学院位置左右互换（per-faction override）；
 * - taklons：脑石按所在区叠加（brainstoneOffset 偏离区中心）；
 * - LF：tinkeroids 为官方渲染图，布局同模板（仅宽高比不同）；
 *   darkanians/space-giants 为 BGG 西班牙版开箱高清正面照（2870×1851，
 *   平整无透视），收入轨布局与模板有系统性差异（矿/TS 行整体右移、
 *   行间距更宽），用 ReadMediaFile 分区放大单独逐点标定（两板同组
 *   照片、几何一致，已抽查互验，共用一份标定）；
 * - moweyds：BGG 9503664 西班牙版开箱照下半块（Octopoides，2950×1879），
 *   与 9503663 同组照片同版型，共用 LF_PHOTO 标定（仅宽高比另给）。
 *   注意勿与 space-giants 板混淆（space-giants 为大胡子蓝老头，moweyds
 *   为触须章鱼怪，见 factions/mowyeds.jpg）。
 */
import type { FactionId } from '@gaia/engine';
import { factionBoardImage } from '../assets';
import type { RelPoint } from './research-calibration';

export interface FactionBoardCalibration {
  /** 整图路径（/assets/factions/hi/...）；null = 无高清图（回退旧布局）。 */
  image: string | null;
  /** 整图宽高比（w/h），用于容器 aspect-ratio。 */
  aspect: number;
  /** power 三区 + gaia 区 token 显示中心。 */
  power: Record<'bowl1' | 'bowl2' | 'bowl3' | 'gaia', RelPoint>;
  /** 脑石相对所在区中心的偏移（taklons）。 */
  brainstoneOffset: RelPoint;
  /** 矿槽×8（左→右 = 取用顺序；剩余矿占靠右槽）。 */
  mineSlots: readonly RelPoint[];
  /** 贸易站槽×4。 */
  tsSlots: readonly RelPoint[];
  /** 实验室槽×3。 */
  labSlots: readonly RelPoint[];
  /** PI 槽。 */
  piSlot: RelPoint;
  /** 知识学院槽（ac1）。 */
  ac1Slot: RelPoint;
  /** QIC 学院槽（ac2）。 */
  ac2Slot: RelPoint;
  /** gaiaformer 槽×3。 */
  gaiaformerSlots: readonly RelPoint[];
  /** 格伦星人专属联邦片叠放位置（族板印有联邦徽章处，PI 格右侧大格；仅 gleens）。 */
  gleensFedSlot?: RelPoint;
  /** 族板印刷的种族能力八边形热区中心（bescods 推进最低轨；PI 能力族走 piSlot 热区不在此列）。 */
  specialSlot?: RelPoint;
  /** QIC 学院特殊行动八边形（+1q；baltaks +4c）热区中心：基础板在学院槽正下方，
   *  LF 板与学院槽基本同心（缺省回退 ac2Slot）。 */
  ac2ActionSlot?: RelPoint;
  /** tinkeroids/moweyds 3 步改造星球标注格（大轮盘下三小格；setup 抽取结果按序放入）。 */
  threeStepSlots?: readonly RelPoint[];
  /** 资源轨（板顶 0-15 单轨）：cell0 中心 x、格距 dx、token 中心 y、token 直径 cellW
   *  （略小于格宽；黄钱×2/白矿×1/蓝知×1 实体风 token）。
   *  标定图：TEMPLATE=Terrans.jpg、LF_PHOTO=darkanians BGG 照、LF_RENDER=tinkeroids 官方渲染。 */
  resourceTrack?: { x0: number; dx: number; y: number; cellW: number };
}

/** 基础族扫描图宽高比（1753×1117）。 */
const BASE_ASPECT = 1753 / 1117;
/** LF 官方渲染图宽高比（2000×1267）。 */
const LF_RENDER_ASPECT = 2000 / 1267;
/** LF BGG 开箱正面照宽高比（2870×1851）。 */
const LF_PHOTO_ASPECT = 2870 / 1851;

/** 模板（Terrans 标定；除 bescods 外 13 块基础族板与 LF 渲染板同布局）。 */
const TEMPLATE = {
  aspect: BASE_ASPECT,
  power: {
    bowl1: { x: 0.25, y: 0.335 },
    bowl2: { x: 0.25, y: 0.17 },
    bowl3: { x: 0.465, y: 0.235 },
    gaia: { x: 0.075, y: 0.235 },
  },
  brainstoneOffset: { x: -0.045, y: 0.02 },
  mineSlots: [0.1505, 0.2007, 0.2509, 0.3011, 0.3513, 0.4015, 0.4517, 0.5019].map((x) => ({ x, y: 0.91 })),
  tsSlots: [0.1505, 0.2007, 0.2509, 0.3011].map((x) => ({ x, y: 0.729 })),
  labSlots: [0.507, 0.58, 0.652].map((x) => ({ x, y: 0.729 })),
  piSlot: { x: 0.172, y: 0.526 },
  ac1Slot: { x: 0.518, y: 0.526 },
  ac2Slot: { x: 0.63, y: 0.526 },
  // ac2 特殊行动八边形在学院槽正下方（按 terrans/gleens 板标定 ≈(0.636,0.60)）
  ac2ActionSlot: { x: 0.636, y: 0.6 },
  gaiaformerSlots: [0.806, 0.884, 0.961].map((x) => ({ x, y: 0.352 })),
  // 资源轨（按 1753×1117 图标定：cell0 圆心 0.0502、格距 0.0600、圆心高 0.0815；token 0.049 略小于格）
  resourceTrack: { x0: 0.0502, dx: 0.06, y: 0.0815, cellW: 0.049 },
} satisfies Omit<FactionBoardCalibration, 'image'>;

/** bescods：PI 与学院位置左右互换。 */
const BESCODS: Pick<FactionBoardCalibration, 'piSlot' | 'ac1Slot' | 'ac2Slot'> = {
  piSlot: { x: 0.485, y: 0.526 },
  ac1Slot: { x: 0.145, y: 0.526 },
  ac2Slot: { x: 0.255, y: 0.526 },
};

/**
 * LF BGG 开箱正面照（darkanians/space-giants，2870×1851）逐点标定：
 * 与模板同结构但收入轨几何有系统性差异（非全局仿射），故按
 * 标志点（收入图标/槽框/power 碗中心 + 模板相对偏移）直接测量。
 */
const LF_PHOTO = {
  aspect: LF_PHOTO_ASPECT,
  power: {
    bowl1: { x: 0.261, y: 0.323 },
    bowl2: { x: 0.261, y: 0.18 },
    bowl3: { x: 0.483, y: 0.244 },
    gaia: { x: 0.088, y: 0.231 },
  },
  brainstoneOffset: { x: -0.045, y: 0.02 },
  // 矿行（PIL 亮段标定 darkanians 板：0.1563 起、间距 0.0493；space-giants 板
  // 同法标定一致；TS/实验室/PI/学院行与模板同位）
  mineSlots: [0.1563, 0.2056, 0.2547, 0.304, 0.3531, 0.4019, 0.4505, 0.499].map((x) => ({ x, y: 0.903 })),
  tsSlots: [0.1585, 0.2073, 0.2561, 0.3049].map((x) => ({ x, y: 0.715 })),
  labSlots: [0.505, 0.575, 0.648].map((x) => ({ x, y: 0.721 })),
  piSlot: { x: 0.166, y: 0.519 },
  ac1Slot: { x: 0.523, y: 0.521 },
  ac2Slot: { x: 0.632, y: 0.535 },
  gaiaformerSlots: [0.807, 0.887, 0.963].map((x) => ({ x, y: 0.355 })),
  // 资源轨（按 2870×1851 图标定：cell0 圆心 0.0436、格距 0.0609、圆心高 0.0837；token 0.050 略小于格）
  resourceTrack: { x0: 0.0436, dx: 0.0609, y: 0.0837, cellW: 0.05 },
} satisfies Omit<FactionBoardCalibration, 'image'>;

const BASE_FACTIONS: readonly FactionId[] = [
  'terrans',
  'lantids',
  'xenos',
  'gleens',
  'taklons',
  'ambas',
  'hadsch-hallas',
  'ivits',
  'geodens',
  'baltaks',
  'firaks',
  'nevlas',
  'itars',
];

function buildCalibrations(): Record<FactionId, FactionBoardCalibration> {
  const out = {} as Record<FactionId, FactionBoardCalibration>;
  for (const f of BASE_FACTIONS) {
    out[f] = { image: factionBoardImage(f), ...TEMPLATE };
  }
  out.bescods = { image: factionBoardImage('bescods'), ...TEMPLATE, ...BESCODS, specialSlot: { x: 0.867, y: 0.219 } };
  // 格伦星人：专属联邦片放在族板印有联邦徽章的位置（PI 格右侧大格，徽章中心
  // (500,593)/1753×1117），不叠压 PI 棋子（要塞与其他族同位显示）。
  out.gleens = { image: factionBoardImage('gleens'), ...TEMPLATE, gleensFedSlot: { x: 0.285, y: 0.531 } };
  out.tinkeroids = {
    image: factionBoardImage('tinkeroids'),
    ...TEMPLATE,
    aspect: LF_RENDER_ASPECT,
    // 资源轨（按 2000×1267 官方渲染标定：cell0 圆心 0.065、格距 0.0593、圆心高 0.0695；token 0.0485）
    resourceTrack: { x0: 0.065, dx: 0.0593, y: 0.0695, cellW: 0.0485 },
    // 3 步改造星球标注格（按 2000×1267 图标定：大轮盘下三小格）
    threeStepSlots: [
      { x: 0.757, y: 0.583 },
      { x: 0.79, y: 0.583 },
      { x: 0.822, y: 0.583 },
    ],
  };
  for (const f of ['space-giants', 'darkanians'] as const) {
    out[f] = { image: factionBoardImage(f), ...LF_PHOTO };
  }
  // moweyds：BGG 9503664 下半块（2950×1879），与 9503663 同组照片同版型，共用 LF_PHOTO 标定。
  out.moweyds = {
    image: factionBoardImage('moweyds'),
    ...LF_PHOTO,
    aspect: 2950 / 1879,
    // 矿行印刷与 darkanians 不同（按 2950×1879 图标定：槽 x 起始 0.1578、间距 0.0485；
    // TS/实验室/PI/学院行与 LF_PHOTO 一致）
    mineSlots: [0.1578, 0.2061, 0.2541, 0.3027, 0.3512, 0.3997, 0.4483, 0.4969].map((x) => ({ x, y: 0.903 })),
    // 3 步改造星球标注格（按 2950×1879 图标定）
    threeStepSlots: [
      { x: 0.745, y: 0.581 },
      { x: 0.78, y: 0.581 },
      { x: 0.814, y: 0.581 },
    ],
  };
  return out;
}

const CALIBRATIONS = buildCalibrations();

/** 族板叠加校准（每个 FactionId 均有条目，全部有高清图）。 */
export function factionCalibration(faction: FactionId): FactionBoardCalibration {
  return CALIBRATIONS[faction];
}

// ---------------------------------------------------------------------------
// 叠加元素尺寸（相对图宽）
// ---------------------------------------------------------------------------

/** power token 点阵小圆片直径（相对图宽）。 */
export const POWER_DOT_WIDTH = 0.026;

/**
 * 收入轨建筑棋子叠加规格：图宽（相对图宽）+ 内容裁剪。
 *
 * 棋子 PNG 透明边距很大（矿图内容仅占图宽 35%），直接按印刷槽位放大
 * 会让相邻图的透明区互相重叠（hover/拖拽热区错乱），故用 clip-path
 * 裁到内容区：视觉上棋子放大到基本盖住印刷槽位，指针热区也收归棋子本体。
 * 图宽按 Terrans.jpg（1753×1117）印刷槽位标定：矿槽 ~45px / TS ~70px /
 * 实验室 ~108px / 学院 ~120px / PI ~150px；实物比例矿最小、TS/实验室中等、
 * PI/学院最大。clip 为 inset(top right bottom left)，按全色棋子图
 * 内容 bbox（各色一致）外放 ~2-3% 测得。
 */
export interface BuildingSprite {
  /** 图宽（相对图宽）。 */
  width: number;
  /** clip-path inset（裁透明边距；null = 不裁，PI 图几乎无 padding）。 */
  clip: string | null;
}

export const BUILDING_SPRITE: Record<'mine' | 'ts' | 'lab' | 'pi' | 'academy', BuildingSprite> = {
  mine: { width: 0.075, clip: 'inset(27% 29% 26% 30%)' },
  ts: { width: 0.072, clip: 'inset(17% 22% 16% 23%)' },
  lab: { width: 0.095, clip: 'inset(17% 20% 16% 21%)' },
  pi: { width: 0.085, clip: null },
  academy: { width: 0.069, clip: 'inset(0% 4% 0% 5%)' },
};

/** gaiaformer 图宽度（相对图宽）。棋子图内容占比仅 ~42%（透明边距大），
 *  0.078 时可见内容 ≈ 0.032 ≈ 槽位八边形大小。 */
export const GAIAFORMER_WIDTH = 0.078;
/** 脑石图宽度（相对图宽）。 */
export const BRAINSTONE_WIDTH = 0.032;
