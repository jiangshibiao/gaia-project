/**
 * 联邦标记单行排布（PlayerMat 持有行 / ResearchBoard 供应行共用）：
 * 任何数量都单行放下——flex nowrap + 每个标记 maxWidth =
 * (容器宽 − (n−1)×固定间隙) ÷ n，随数量等比缩小。
 */

/** 单个联邦标记的最大宽度（CSS calc 表达式）。 */
export function fedTokenMaxWidth(count: number, gapPx: number): string {
  const n = Math.max(1, count);
  return `calc((100% - ${(n - 1) * gapPx}px) / ${n})`;
}
