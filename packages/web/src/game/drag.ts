/**
 * 面板建筑拖拽（建矿/升级）纯逻辑：拖拽计划、落点换算、最近格吸附。
 *
 * 事件模型在 GameScreen（pointerdown 发起 + window pointermove/pointerup，
 * 参照 BrassBirmingham web 的拖拽实现；与棋盘空白处拖拽平移天然隔离——
 * 拖拽从面板棋子发起，地图 pan 从棋盘空白发起，两者互斥）。本模块只含
 * 可单测的纯函数：
 * - planDrag：拖某个面板建筑时的合法落点集合 + 落锤预填方案；
 * - clientToSvgPoint：client 坐标经 CTM 逆变换到 SVG 坐标（viewBox
 *   缩放/平移后仍准确）；
 * - snapHex：落点吸附到最近合法 hex（超出半径 = 非法位置，弹回）；
 * - applyDragDrop：落锤后等价于点选 hex 的选择机预填。
 */
import type { Action, HexKey } from '@gaia/engine';
import { parseHexKey } from '@gaia/engine';
import { HEX_SIZE, hexToPixel } from '../board/BoardSvg';
import { pick, startSelection } from './interactions';
import type { CategoryId, Selection } from './interactions';

/** 可拖拽的面板建筑（BuildingSupply 键；ac1/ac2 均为学院）。 */
export type DragBuilding = 'mine' | 'ts' | 'lab' | 'pi' | 'ac1' | 'ac2';

export interface DragPlan {
  /** 落锤后进入的选择类别。 */
  category: CategoryId;
  /** 除 hex 外要预填的字段（升级为 to）。 */
  prefill: { field: string; value: string }[];
  /** 合法落点集合（拖动时高亮 + 吸附候选）。 */
  targets: Set<HexKey>;
}

/** 拖高级建筑 → 升级目标（mine→TS、TS→lab/PI、lab→学院）。 */
const UPGRADE_TO: Record<Exclude<DragBuilding, 'mine'>, 'ts' | 'lab' | 'pi' | 'ac1' | 'ac2'> = {
  ts: 'ts',
  lab: 'lab',
  pi: 'pi',
  ac1: 'ac1',
  ac2: 'ac2',
};

/**
 * 拖拽计划：拖面板建筑 b 时的合法落点与预填方案；null = 当前无可拖行动
 * （不发起拖拽）。矿按当前 legalActions 判定类别：setup 起始矿 >
 * pending 免费矿 > 常规建矿。
 */
export function planDrag(legalActions: readonly Action[], b: DragBuilding): DragPlan | null {
  if (b === 'mine') {
    for (const [type, category] of [
      ['place-initial-mine', 'setup-mine'],
      ['free-mine', 'free-mine'],
      ['build-mine', 'mine'],
    ] as const) {
      const targets = new Set<HexKey>();
      for (const a of legalActions) {
        if (a.type !== type) continue;
        const hex = (a as { hex: HexKey | null }).hex;
        if (hex !== null) targets.add(hex); // free-mine hex=null 为跳过项，非落点
      }
      if (targets.size > 0) return { category, prefill: [], targets };
    }
    return null;
  }
  const to = UPGRADE_TO[b];
  const targets = new Set<HexKey>();
  for (const a of legalActions) {
    if (a.type === 'upgrade' && a.to === to) targets.add(a.hex);
  }
  if (targets.size === 0) return null;
  return { category: 'upgrade', prefill: [{ field: 'to', value: to }], targets };
}

/** 2D 仿射矩阵（DOMMatrix 结构子集：svg.getScreenCTM() 可直接传入）。 */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** client 坐标 → SVG 坐标（CTM 逆变换，兼容 viewBox 缩放/平移）。 */
export function clientToSvgPoint(m: Affine, x: number, y: number): { x: number; y: number } {
  const det = m.a * m.d - m.b * m.c;
  return {
    x: (m.d * (x - m.e) - m.c * (y - m.f)) / det,
    y: (-m.b * (x - m.e) + m.a * (y - m.f)) / det,
  };
}

/**
 * 落点吸附：SVG 坐标点 → 中心距离 ≤ radius 的最近合法 hex；
 * 无命中返回 null（非法位置，棋子弹回，不触发任何行动）。
 */
export function snapHex(
  p: { x: number; y: number },
  targets: ReadonlySet<HexKey>,
  radius: number = HEX_SIZE,
): HexKey | null {
  let best: HexKey | null = null;
  let bestDist = radius;
  for (const key of targets) {
    const { q, r } = parseHexKey(key);
    const c = hexToPixel(q, r);
    const d = Math.hypot(p.x - c.x, p.y - c.y);
    if (d <= bestDist) {
      best = key;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 落锤预填（等价于点选高亮 hex）：startSelection + prefill 字段 + hex。
 * 返回的 Selection 候选已收窄，剩余子选择（科技板等）走现有对话框。
 */
export function applyDragDrop(
  legalActions: readonly Action[],
  plan: DragPlan,
  hex: HexKey,
): Selection | null {
  if (!plan.targets.has(hex)) return null;
  let sel = startSelection(legalActions, plan.category);
  if (sel === null) return null;
  for (const pf of plan.prefill) sel = pick(sel, pf.field, pf.value);
  return pick(sel, 'hex', hex);
}
