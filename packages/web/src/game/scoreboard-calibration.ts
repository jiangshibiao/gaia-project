/**
 * 计分板（实图版）叠加校准（相对坐标 0..1，原点左上，基于 scoreboard-base.png 1600×1570）。
 *
 * 已用 ReadMediaFile 分区放大目视核定（同 sector-calibration 的做法）：
 * - roundSlots[6]：扇形区 6 个回合计分片槽中心 + 径向旋转角（左逆右顺）+ 片宽；
 * - finalSlots[2]：方形区右侧两个灰色面板内的终局计分片槽中心 + 片宽；
 * - finalRows[2]：两条绿色终局计数轨（与 finalSlots 上下对应）：
 *   count k（0..10）的 x 线性插值于 x0..x1，标记点圆心 y；
 * - extAdvSlot：LF 梯形扩展片上的第 7 高级科技片槽（相对梯形图 1200×439）。
 */

/** 回合计分片槽：中心 + 径向旋转角（度，顺时针为正）+ 宽度（相对图宽）。 */
export interface RoundSlot {
  x: number;
  y: number;
  rot: number;
  w: number;
}

export const SB_ROUND_SLOTS: readonly RoundSlot[] = [
  { x: 0.319, y: 0.408, rot: -62, w: 0.18 },
  { x: 0.375, y: 0.296, rot: -37, w: 0.18 },
  { x: 0.451, y: 0.272, rot: -12, w: 0.18 },
  { x: 0.551, y: 0.272, rot: 12, w: 0.18 },
  { x: 0.633, y: 0.297, rot: 37, w: 0.18 },
  { x: 0.681, y: 0.408, rot: 62, w: 0.18 },
];

/** 终局计分片槽（右侧灰面板，上/下）：中心 + 宽度（相对图宽）。 */
export const SB_FINAL_SLOTS: readonly { x: number; y: number; w: number }[] = [
  { x: 0.67, y: 0.554, w: 0.15 },
  { x: 0.671, y: 0.74, w: 0.15 },
];

/** 终局计数轨（绿条）：count 0..10 线性映射 x0→x1，标记圆心 y（相对图高）。 */
export const SB_FINAL_ROWS: readonly { x0: number; x1: number; y: number }[] = [
  { x0: 0.182, x1: 0.555, y: 0.55 },
  { x0: 0.182, x1: 0.555, y: 0.732 },
];

/** 计数标记直径（相对图宽）。 */
export const SB_FINAL_MARKER = 0.028;

/** LF 梯形扩展片上的第 7 高级科技片槽（相对梯形图）：中心 + 宽度。
    2026-09-21 重测：灰色竖条纹槽区 x0.385-0.615 / y0.405-0.64（中心 0.50,0.52，
    基本填满槽宽 0.23；旧值 (0.565,0.8,0.16) 偏右下且偏小，大屏下明显歪）。 */
export const SB_EXT_ADV_SLOT = { x: 0.5, y: 0.52, w: 0.23 } as const;

/** LF 梯形扩展片渲染宽（相对主板渲染宽；按两片实物比例 1677/2956 实测）。 */
export const SB_EXT_WIDTH_FRAC = 0.567;
