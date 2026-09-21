/**
 * 种族飞船面板（LF 探索板）叠加校准（相对坐标 0..1，原点左上，基于 400×1240 面板图）。
 *
 * 18 块面板共用同一印刷模板（顶部肖像 / 中部派遣费用徽章与调整图标 /
 * 底部右列 3 个穿梭机槽位），故槽位一份校准全族通用。
 * 数值按 factions/panels/terrans.png 逐格目视核定（同 sector-calibration 的做法）。
 * 顶槽印有「3-4」标记 = 仅 3-4 人局启用；2 人局只用下方 2 槽（PANEL_SLOT_OFFSET）。
 * 特殊行动八边形（gleens +2 航距 / space-giants 2 免费步等；持续型能力的族无此格）
 * 位置同模板，2026-09-21 按 gleens.png/space-giants.png 实测。
 */
import type { FactionId, SpecialActionId } from '@gaia/engine';

/** 穿梭机槽位中心（自上而下）。 */
export const PANEL_SHUTTLE_SLOTS: readonly { x: number; y: number }[] = [
  { x: 0.588, y: 0.515 },
  { x: 0.588, y: 0.675 },
  { x: 0.588, y: 0.83 },
];

/** 2 人局跳过的顶槽数（「3-4」标记槽不用）。 */
export const PANEL_SLOT_OFFSET_2P = 1;

/** 穿梭机标记宽度（相对面板图宽）。 */
export const PANEL_SHUTTLE_W = 0.35;

/** 探索板特殊行动八边形中心（gleens/space-giants 面板 2026-09-21 实测，全族同模板）。 */
export const PANEL_SPECIAL_SLOT = { x: 0.49, y: 0.39 };

/** 特殊行动八边形直径（相对面板图宽；实测 ≈0.44-0.47，盖片略小于印刷外径）。 */
export const PANEL_SPECIAL_SIZE = 0.44;

/**
 * 族 → 探索板（面板）特殊行动 id（印在面板中部的八边形格；Terrans 等持续型
 * 探索板能力的族无八边形、不在表内）。仅列引擎已实现的探索板特殊行动。
 */
export const PANEL_SPECIAL_ACTION: Partial<Record<FactionId, SpecialActionId>> = {
  gleens: 'gleens-range',
  'space-giants': 'space-giants-mine',
};
