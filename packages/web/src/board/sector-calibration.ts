/**
 * 扇区整版扫描图的几何校准。
 *
 * 含义：扇区图在 "rotation=4 映射" 下——即图像内容 = 标准 layout 按
 * rotateRight ×4 旋转后的排布（flat-top，y 向下，已用叠加图 /tmp/cal-*.png
 * 逐格验证）。cx/cy = 扇区中心 hex 在图内的像素坐标；size = 图内 hex
 * 外接圆半径（flat-top：相邻 hex 中心水平距 = 1.5·size）。
 * 全部图为 650×705。
 *
 * 全局统一几何（2026-09 接缝修复）：13 块扇区图物理同版同尺寸，
 * 此前逐扇区独立的 (cx,cy,size) 校准值（cx 313–325、cy 340–360、size 76–84）
 * 是目视拟合噪声，导致相邻扇区网格错位、接缝处露出黑色缝隙。
 * 对全部扇区图做 hex 网格模板匹配（19 格六边形边采样梯度最大化），
 * 所有图一致收敛到 (325, 352.5, 81.25)——与理论值（中心 (325, 352.5)、
 * size = 650/8 = 81.25）吻合，且外圈 hex 边缘恰好落在图像四边上
 * （上/下外圈 hex 平边贴 y=1/704，左/右外圈 hex 顶点贴 x=0/650），
 * 与扫描裁切位置一致，证实同版。故所有扇区共用这一套全局几何。
 * （历史逐扇区校准值见 git 历史与 public/assets/sectors/calibration.json。）
 */
export interface SectorCalibration {
  cx: number;
  cy: number;
  size: number;
}

/** 校准映射的固定旋转（图像内容 = layout rotateRight ×4）。 */
export const CALIBRATION_ROTATION = 4;

export const SECTOR_IMAGE_WIDTH = 650;
export const SECTOR_IMAGE_HEIGHT = 705;

/** 全部扇区共用的全局几何（模板匹配实测 + 理论值双重确认）。 */
export const GLOBAL_SECTOR_CALIBRATION: SectorCalibration = {
  cx: SECTOR_IMAGE_WIDTH / 2,
  cy: SECTOR_IMAGE_HEIGHT / 2,
  size: SECTOR_IMAGE_WIDTH / 8,
};
