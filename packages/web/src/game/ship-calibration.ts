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
  /** 联邦标记图宽度（相对图宽）。 */
  fedWidth: number;
  /** 神器图宽度（相对图宽）。 */
  artifactWidth: number;
}

export const SHIP_CALIBRATION: Record<ShipId, ShipCalibration> = {
  twilight: {
    // BGG 开箱正面照（2865×936）：左竖列 4 穿梭机位，中上 3 六边形行动格
    // （绿/粉/蓝），中下徽章 = 联邦标记槽，右侧 2×2 灰色椭圆 = 神器位
    width: 2865,
    height: 936,
    shuttleSlots: [
      { x: 0.233, y: 0.221 },
      { x: 0.233, y: 0.409 },
      { x: 0.233, y: 0.59 },
      { x: 0.232, y: 0.742 },
    ],
    actionSpaces: [
      { x: 0.326, y: 0.47 },
      { x: 0.44, y: 0.459 },
      { x: 0.551, y: 0.454 },
    ],
    techSlot: null,
    fedToken: { x: 0.608, y: 0.748 },
    artifacts: [
      { x: 0.744, y: 0.24 },
      { x: 0.904, y: 0.289 },
      { x: 0.743, y: 0.662 },
      { x: 0.905, y: 0.641 },
    ],
    shuttleSize: 0.058,
    actionSize: 0.095,
    actionTokenSize: 0.045,
    techWidth: 0.16,
    fedWidth: 0.07,
    artifactWidth: 0.05,
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
    actionSpaces: [
      { x: 0.353, y: 0.58 },
      { x: 0.47, y: 0.58 },
      { x: 0.578, y: 0.572 },
    ],
    techSlot: { x: 0.83, y: 0.499 },
    fedToken: { x: 0.668, y: 0.628 },
    artifacts: null,
    shuttleSize: 0.03,
    actionSize: 0.055,
    actionTokenSize: 0.026,
    techWidth: 0.09,
    fedWidth: 0.042,
    artifactWidth: 0.035,
  },
  tfmars: {
    // BGG 开箱正面照（2865×929，比透视校正版更平更清）：左竖列 4 穿梭机位，
    // 中上 3 六边形行动格（绿/粉/黄），右侧大屏幕面板为科技板槽，
    // 中下徽章 = 联邦标记槽（叠加直接盖其上）
    width: 2865,
    height: 929,
    shuttleSlots: [
      { x: 0.232, y: 0.21 },
      { x: 0.232, y: 0.39 },
      { x: 0.232, y: 0.565 },
      { x: 0.232, y: 0.743 },
    ],
    actionSpaces: [
      { x: 0.382, y: 0.339 },
      { x: 0.494, y: 0.334 },
      { x: 0.604, y: 0.328 },
    ],
    techSlot: { x: 0.806, y: 0.431 },
    fedToken: { x: 0.684, y: 0.689 },
    artifacts: null,
    shuttleSize: 0.055,
    actionSize: 0.095,
    actionTokenSize: 0.045,
    techWidth: 0.15,
    fedWidth: 0.09,
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
    actionSpaces: [
      { x: 0.398, y: 0.451 },
      { x: 0.513, y: 0.451 },
      { x: 0.628, y: 0.445 },
    ],
    techSlot: { x: 0.798, y: 0.35 },
    fedToken: { x: 0.685, y: 0.7 },
    artifacts: null,
    shuttleSize: 0.03,
    actionSize: 0.055,
    actionTokenSize: 0.026,
    techWidth: 0.09,
    fedWidth: 0.042,
    artifactWidth: 0.035,
  },
};
