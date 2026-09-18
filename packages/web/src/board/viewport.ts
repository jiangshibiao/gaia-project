/**
 * 棋盘视口（缩放/平移）纯函数：操作 SVG viewBox 矩形。
 *
 * 用 viewBox 变换而非 CSS transform，hex 热区/高亮/tooltip 无需额外修正。
 * 初始 view=null（BoardSvg 用自适应全图的 boardViewBox）。
 */

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 缩放范围（相对自适应全图的倍率）。 */
export const ZOOM_MIN = 0.3;
export const ZOOM_MAX = 4;

export function clampZoom(zoom: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
}

export function parseViewBox(s: string): ViewBox {
  const [x = 0, y = 0, w = 100, h = 100] = s.split(/\s+/).map(Number);
  return { x, y, w, h };
}

export function formatViewBox(v: ViewBox): string {
  return `${v.x.toFixed(2)} ${v.y.toFixed(2)} ${v.w.toFixed(2)} ${v.h.toFixed(2)}`;
}

/**
 * 以 center（SVG 坐标）为中心缩放：scale > 1 放大（viewBox 变小）。
 * 缩放前后 center 指向的 SVG 点在视口中位置不变。
 */
export function zoomViewBox(view: ViewBox, center: { x: number; y: number }, scale: number): ViewBox {
  return {
    x: center.x - (center.x - view.x) / scale,
    y: center.y - (center.y - view.y) / scale,
    w: view.w / scale,
    h: view.h / scale,
  };
}

/** 平移（dx/dy 为 SVG 单位；拖拽时传屏幕位移换算后的值）。 */
export function panViewBox(view: ViewBox, dx: number, dy: number): ViewBox {
  return { ...view, x: view.x + dx, y: view.y + dy };
}

/**
 * 绕 viewBox 中心旋转 deg 后的轴对齐外接矩形（棋盘整体旋转时，
 * 自适应 viewBox 需扩到能容纳旋转后的地图包围盒；缩放/平移数学不变）。
 */
export function rotatedViewBox(v: ViewBox, deg: number): ViewBox {
  const rad = (deg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const w = v.w * c + v.h * s;
  const h = v.w * s + v.h * c;
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/**
 * 旋转后 hex 中心点的紧致包围盒（替代旋转矩形的轴对齐外接——后者会把包围盒
 * 无谓放大 (|cos|+|sin|) 倍，导致初始地图偏小）。
 */
export function rotatedPointsViewBox(
  points: readonly { x: number; y: number }[],
  cx: number,
  cy: number,
  deg: number,
  pad: number,
): ViewBox {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const x = cx + dx * c - dy * s;
    const y = cy + dx * s + dy * c;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 100, h: 100 };
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/**
 * 任意角度最优水平取向：全图 hex 中心绕 (cx,cy) 旋转后包围盒宽度最大的角度。
 * 宽度函数周期 180°，扫 −90..90° 即覆盖全部取向（1° 粗扫 + 0.1° 细扫）；
 * 宽度并列时取 |角度| 最小者（避免无谓倾斜）。返回 CSS rotate 角度（y 向下，
 * 正值 = 屏幕顺时针），与 g.board-rotate / rotatedViewBox 同一约定。
 */
export function bestHorizontalRotation(
  points: readonly { x: number; y: number }[],
  cx: number,
  cy: number,
): number {
  if (points.length === 0) return 0;
  const widthAt = (deg: number): number => {
    const rad = (deg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      const v = (p.x - cx) * c - (p.y - cy) * s;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return max - min;
  };
  /** 在 [from..to] 步进 step 扫描，返回 (宽度, 角度)，并列取 |角度| 最小。 */
  const scan = (from: number, to: number, step: number): { w: number; deg: number } => {
    let best = { w: -Infinity, deg: 0 };
    for (let d = from; d <= to + 1e-9; d += step) {
      const w = widthAt(d);
      if (w > best.w + 1e-6 || (w > best.w - 1e-6 && Math.abs(d) < Math.abs(best.deg))) {
        best = { w, deg: d };
      }
    }
    return best;
  };
  const coarse = scan(-90, 90, 1);
  const fine = scan(coarse.deg - 1, coarse.deg + 1, 0.1);
  const deg = Math.abs(fine.deg) < 0.05 ? 0 : Math.round(fine.deg * 10) / 10;
  return Object.is(deg, -0) ? 0 : deg;
}
