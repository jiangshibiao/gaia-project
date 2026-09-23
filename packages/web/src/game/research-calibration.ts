/**
 * 研究板整图（boards/ResearchBoard.jpg，1838×1972 平整渲染图）的叠加校准。
 *
 * 全部相对坐标（0..1，原点左上）。已用 ReadMediaFile 分区放大目视核定：
 * - 6 条轨道列等宽（每列 1/6 宽），列序 = TRACK_ORDER
 *   （terra 红 / nav 深蓝 / int 绿 / gaia 粉 / eco 橙 / sci 浅蓝）；
 * - 等级格 y：L5 在列顶，其下依次为科技板槽面板、L4、L3、（充能分隔）、
 *   L2、L1、L0；
 * - 轨道内灰色电路板面板 = 该轨标准科技板槽（terra..sci 6 位）；
 * - 轨道下方 6 个灰色面板 = 高级科技板槽（每轨 1 槽）；
 * - 再下 3 个宽面板 = 自由标准科技板槽（free1..3）；
 * - 最底行 = 7 个 power 行动格（紫八边形，费用 7/5/4/4/4/3/3）
 *   + 3 个 qic 行动格（绿六边形，费用 4/3/2），顺序 = 引擎 BOARD_ACTIONS。
 */
import type { BoardActionId, ResearchTrack, TechTilePosition } from '@gaia/engine';

export interface RelPoint {
  x: number;
  y: number;
}

/** 整图自然像素宽（.rb-board 按此固定宽度布局，再 transform scale 回缩）。 */
export const RB_NATURAL_WIDTH = 1838;
/** 整图自然像素高（外壳 aspect-ratio 用）。 */
export const RB_NATURAL_HEIGHT = 1972;

/**
 * 动态缩放比：外壳实际渲染宽度 → transform scale。
 * 叠加相对坐标与点击热区在放大坐标系内定义，随板面同步缩放，不失准。
 */
export function researchBoardScale(displayWidth: number): number {
  return displayWidth / RB_NATURAL_WIDTH;
}

/** 6 轨列中心 x（按 TRACK_ORDER 索引）。 */
export const TRACK_COLUMN_X: Record<ResearchTrack, number> = {
  terra: 1 / 12,
  nav: 3 / 12,
  int: 5 / 12,
  gaia: 7 / 12,
  eco: 9 / 12,
  sci: 11 / 12,
};

/** 各等级格中心 y（L0 起始格在底部）。 */
export const TRACK_LEVEL_Y: readonly number[] = [0.543, 0.462, 0.391, 0.281, 0.213, 0.043];

/** 轨道内标准科技板槽中心 y（x 取所在轨列中心 + 印刷槽位右偏量）。
 *  标准板槽在中部面板行，顶部行是高级板槽（与实体板一致）。 */
export const TRACK_TECH_Y = 0.66;

/** 标准板槽 x 右偏量（印刷槽位中心 vs 轨列中心）。
 *  锚点 = 列面板中心；列内右下橙色电路装饰不是槽位中心，勿对准它。 */
export const TECH_SLOT_DX = 0.004;

/** 高级科技板槽中心 y（x 取所在轨列中心；槽 i 对齐 TRACK_ORDER[i]）。
 *  实体板上高级科技片放在科技轨最上方（每轨顶一格），不是中部。 */
export const ADV_TECH_Y = 0.127;

/** 标准板槽（轨道位）逐列中心（按 ResearchBoard.jpg 逐面板标定浅灰槽区中心：
 *  列间距 ≈0.164——非等分 1/6≈0.167，等分会让命中逐列递增右偏；y = 面板行中心 0.657。 */
export const TECH_TRACK_SLOTS: Record<ResearchTrack, RelPoint> = {
  terra: { x: 0.084, y: 0.657 },
  nav: { x: 0.248, y: 0.657 },
  int: { x: 0.411, y: 0.657 },
  gaia: { x: 0.574, y: 0.657 },
  eco: { x: 0.737, y: 0.657 },
  sci: { x: 0.9, y: 0.657 },
};

/** 自由标准科技板槽（free1..3）中心（同批图标定：放片空白区中心）。 */
export const FREE_TECH_SLOTS: readonly RelPoint[] = [
  { x: 0.163, y: 0.79 },
  { x: 0.481, y: 0.79 },
  { x: 0.794, y: 0.79 },
];

/** power 行动格中心（power1..7，左→右 = 费用 7/5/4/4/4/3/3）。
    按印刷紫色八边形标定（PIL 颜色分割）。 */
export const POWER_ACTION_SLOTS: readonly RelPoint[] = [
  { x: 0.063, y: 0.9516 },
  { x: 0.15, y: 0.9516 },
  { x: 0.238, y: 0.9516 },
  { x: 0.325, y: 0.9516 },
  { x: 0.415, y: 0.9516 },
  { x: 0.505, y: 0.9516 },
  { x: 0.593, y: 0.9516 },
];

/** qic 行动格中心（qic1..3，左→右 = 费用 4/3/2）。 */
export const QIC_ACTION_SLOTS: readonly RelPoint[] = [
  { x: 0.69, y: 0.9516 },
  { x: 0.801, y: 0.9516 },
  { x: 0.921, y: 0.9516 },
];

/** 行动格叠加定位（power1..7 + qic1..3）。 */
export const BOARD_ACTION_SLOTS: Record<BoardActionId, RelPoint> = {
  power1: POWER_ACTION_SLOTS[0]!,
  power2: POWER_ACTION_SLOTS[1]!,
  power3: POWER_ACTION_SLOTS[2]!,
  power4: POWER_ACTION_SLOTS[3]!,
  power5: POWER_ACTION_SLOTS[4]!,
  power6: POWER_ACTION_SLOTS[5]!,
  power7: POWER_ACTION_SLOTS[6]!,
  qic1: QIC_ACTION_SLOTS[0]!,
  qic2: QIC_ACTION_SLOTS[1]!,
  qic3: QIC_ACTION_SLOTS[2]!,
};

/** 标准科技板槽（9 位）：轨道位取 TECH_TRACK_SLOTS 逐列实测，free 取 FREE_TECH_SLOTS。 */
export function techTileSlot(pos: TechTilePosition): RelPoint {
  switch (pos) {
    case 'terra':
    case 'nav':
    case 'int':
    case 'gaia':
    case 'eco':
    case 'sci':
      return TECH_TRACK_SLOTS[pos];
    case 'free1':
      return FREE_TECH_SLOTS[0]!;
    case 'free2':
      return FREE_TECH_SLOTS[1]!;
    case 'free3':
      return FREE_TECH_SLOTS[2]!;
  }
}

/** LF 经济轨 L3/L4 覆盖板位置（盖住 eco 轨 L3/L4 收入图标区，右缘不越出经济列）。 */
export const ECONOMY_OVERLAY_POS: RelPoint = { x: 0.778, y: 0.247 };

/** 等级格容器宽度（相对图宽；高度由宽高比推出，token 以其为参照）。 */
export const LEVEL_BOX_WIDTH = 0.092;
/** 等级格容器宽高比（格 ~270×125 原图像素）。 */
export const LEVEL_BOX_RATIO = 2.1;
/** 玩家等级 token 宽度（相对等级格容器宽；圆柱形 = 顶椭圆+柱身，高由 CSS 宽高比推出）。 */
export const LEVEL_DOT_FRAC = 0.28;
/** 同格多 token 的横向错开步长（相对等级格容器宽）。 */
export const LEVEL_DOT_STAGGER_FRAC = 0.24;
/** 科技板图宽度（相对图宽；≈2.3× 印刷槽位，与飞船科技片同放置思路）。 */
export const TECH_TILE_WIDTH = 0.13;
/** 科技板图宽高比（TEC* 扫描图 178×134；槽位按钮按此定高）。 */
export const TECH_TILE_ASPECT = 178 / 134;
/** 堆叠：每层向右上步进的步长（相对槽宽 %，整叠居中于槽位——底层在左下露边表张数）。 */
export const TECH_STACK_OFFSET_PCT = 5;
/** 高级板图宽度（相对图宽）。 */
export const ADV_TILE_WIDTH = 0.12;
/** 行动格热区直径（相对图宽；印刷八边形外径 ≈150px = 0.082 图宽）。 */
export const ACTION_ZONE_SIZE = 0.082;
/** 已用 action token 直径（相对图宽；trim 素材内容≈93% 图宽，0.084 刚好盖住印刷格
    ——盖片须基本覆盖印刷八边形才可辨识）。 */
export const ACTION_TOKEN_SIZE = 0.084;
/** Terraforming L5 联邦标记宽度（相对图宽）。 */
export const L5_FED_WIDTH = 0.045;
/** 经济覆盖板宽度（相对图宽）。 */
export const ECON_OVERLAY_WIDTH = 0.1;

/** LF QIC 覆盖板矩形（盖住右下角 3 个绿水晶行动格的印刷盒；相对坐标，按 ResearchBoard.jpg 实测）。 */
export const QIC_COVER_RECT = { x0: 0.63, y0: 0.86, x1: 1.0, y1: 1.0 } as const;
