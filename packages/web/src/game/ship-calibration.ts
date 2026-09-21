/**
 * 船板整图的叠加校准数据（相对坐标 0..1，原点左上，x 向右 y 向下）。
 *
 * 已用 ReadMediaFile 分区放大逐船目视核定（参照 sector-calibration 的做法）：
 * - shuttleSlots[4]：探索轨 4 格中心（slot index 0..3 = 格号 1..4，自上而下；
 *   格上充能值 0/2/2/3 为船板印刷，不重画）；
 * - actionSpaces[3]：3 个六边形行动格中心（顺序 = SHIP_ACTION_SPACES[id]，
 *   即左→右）；
 * - techSlot：科技板槽中心（Twilight 无槽 → null，改放 artifacts）；
 * - fedToken：金框联邦标记槽中心（徽章形印刷位）；
 * - artifacts：Twilight 的 4 个神器位（2×2 白色椭圆槽，其余船 null）。
 *
 * 各 size 为相对图宽的直径/边长（叠加元素按 width% 缩放，纵横比随图保持）。
 * 例外：金框联邦标记不按图宽比例——固定 34px（.tile-img.fed.gold），
 * 与计分区联邦标记等大，fedToken 仅提供槽位中心。
 *
 * 注意：twilight 与 tfmars 已换 BGG 西班牙版开箱高清正面照
 * （twilight 2865×936 / tf-mars 2865×929，平整无透视，解决旧渲染图模糊投诉），
 * 坐标按新图重新标定；Rebellion 2 人局不出现但坐标照常给出。
 */
import type { ShipId } from '@gaia/engine';

export interface RelPoint {
  x: number;
  y: number;
}

export interface ShipCalibration {
  /** 原图像素尺寸（供测试/参考；布局只用相对坐标）。 */
  width: number;
  height: number;
  shuttleSlots: readonly [RelPoint, RelPoint, RelPoint, RelPoint];
  actionSpaces: readonly [RelPoint, RelPoint, RelPoint];
  techSlot: RelPoint | null;
  fedToken: RelPoint;
  artifacts: readonly RelPoint[] | null;
  /** 穿梭机/空圈直径（相对图宽）。 */
  shuttleSize: number;
  /** 行动格点击热区直径（相对图宽）。 */
  actionSize: number;
  /** 已用标记（action token）直径（相对图宽）。 */
  actionTokenSize: number;
  /** 科技板图宽度（相对图宽）。 */
  techWidth: number;
  /** 神器图宽度（相对图宽）。 */
  artifactWidth: number;
}

export const SHIP_CALIBRATION: Record<ShipId, ShipCalibration> = {
  twilight: {
    // TTS 模组官方渲染（3411×1050，黑底，与 feuerland 版同美术系列；源 URL 见 assets README）：
    // 左竖列 4 穿梭机位，中上 3 六边形行动格（绿/粉/蓝），中下徽章 = 联邦标记槽，
    // 右侧 2×2 椭圆 = 圣器位（X 印刷圆 = 圣器盖，叠加直接盖其上）
    width: 3411,
    height: 1050,
    shuttleSlots: [
      { x: 0.228, y: 0.235 },
      { x: 0.228, y: 0.463 },
      { x: 0.228, y: 0.641 },
      { x: 0.228, y: 0.82 },
    ],
    // 行动格中心/外径 2026-09-21 PIL 颜色分割重测（外轮廓 ≈300px）：
    // 盖片放大至刚好盖住印刷八边形（曾 0.045 不足半径，用户看不出已盖）
    actionSpaces: [
      { x: 0.3294, y: 0.5214 },
      { x: 0.4428, y: 0.5076 },
      { x: 0.5523, y: 0.5186 },
    ],
    techSlot: null,
    fedToken: { x: 0.6125, y: 0.763 },
    artifacts: [
      { x: 0.75, y: 0.252 },
      { x: 0.91, y: 0.252 },
      { x: 0.75, y: 0.69 },
      { x: 0.91, y: 0.69 },
    ],
    shuttleSize: 0.055,
    actionSize: 0.088,
    actionTokenSize: 0.082,
    techWidth: 0.15,
    artifactWidth: 0.1,
  },
  rebellion: {
    width: 2000,
    height: 621,
    shuttleSlots: [
      { x: 0.203, y: 0.242 },
      { x: 0.203, y: 0.427 },
      { x: 0.203, y: 0.62 },
      { x: 0.203, y: 0.797 },
    ],
    // 行动格中心/外径 2026-09-21 PIL 重测（外轮廓 ≈230px = 0.115；
    // 旧 actionSize 0.055 不足一半、盖片 0.026 仅 1/4，热区也偏小）
    actionSpaces: [
      { x: 0.3523, y: 0.5829 },
      { x: 0.468, y: 0.5709 },
      { x: 0.5753, y: 0.5797 },
    ],
    techSlot: { x: 0.835, y: 0.483 },
    fedToken: { x: 0.668, y: 0.628 },
    artifacts: null,
    shuttleSize: 0.03,
    actionSize: 0.11,
    actionTokenSize: 0.105,
    techWidth: 0.15,
    artifactWidth: 0.035,
  },
  tfmars: {
    // TTS 模组官方渲染（3411×1050，黑底；源 URL 见 assets README）：左竖列 4 穿梭机位，
    // 中上 3 六边形行动格（绿/粉/黄），右侧屏幕面板为科技板槽（槽位印在其面板右列），
    // 中下徽章 = 联邦标记槽（叠加直接盖其上）
    width: 3411,
    height: 1050,
    shuttleSlots: [
      { x: 0.22, y: 0.244 },
      { x: 0.22, y: 0.455 },
      { x: 0.22, y: 0.633 },
      { x: 0.22, y: 0.82 },
    ],
    // 行动格中心 2026-09-21 PIL 重测（外轮廓 ≈325px，actionSize 0.095 保持；
    // 盖片 0.045→0.088 刚好盖住八边形）
    actionSpaces: [
      { x: 0.372, y: 0.3771 },
      { x: 0.4883, y: 0.3838 },
      { x: 0.6041, y: 0.381 },
    ],
    techSlot: { x: 0.82, y: 0.454 },
    fedToken: { x: 0.685, y: 0.755 },
    artifacts: null,
    shuttleSize: 0.055,
    actionSize: 0.095,
    actionTokenSize: 0.088,
    techWidth: 0.15,
    artifactWidth: 0.07,
  },
  eclipse: {
    width: 2000,
    height: 621,
    shuttleSlots: [
      { x: 0.283, y: 0.218 },
      { x: 0.283, y: 0.419 },
      { x: 0.283, y: 0.608 },
      { x: 0.283, y: 0.788 },
    ],
    // 行动格中心/外径 2026-09-21 PIL 重测（外轮廓 ≈250px = 0.125；
    // 旧 actionSize 0.055 不足一半且中心下偏约 0.02-0.03）
    actionSpaces: [
      { x: 0.3992, y: 0.4235 },
      { x: 0.5158, y: 0.4316 },
      { x: 0.632, y: 0.4477 },
    ],
    techSlot: { x: 0.8225, y: 0.342 },
    fedToken: { x: 0.685, y: 0.7 },
    artifacts: null,
    shuttleSize: 0.03,
    actionSize: 0.12,
    actionTokenSize: 0.115,
    techWidth: 0.15,
    artifactWidth: 0.035,
  },
};
