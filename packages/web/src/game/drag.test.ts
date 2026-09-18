/**
 * 面板建筑拖拽（drag.ts）纯逻辑单测：
 * - planDrag：矿（setup 起始矿 > 免费矿 > 常规建矿）与升级（to 字段过滤）的
 *   合法落点集合；无可拖行动 → null；
 * - clientToSvgPoint：CTM 逆变换（缩放/平移/旋转一般 2D 仿射）；
 * - snapHex：最近合法格吸附（≤半径），非法位置 null（弹回）；
 * - applyDragDrop：落锤 = 选择机预填（等价点选 hex），返回 legalActions 原对象。
 */
import { describe, expect, it } from 'vitest';
import { enumerateActions, newGame } from '@gaia/engine';
import type { Action, HexKey } from '@gaia/engine';
import { HEX_SIZE, hexToPixel } from '../board/BoardSvg';
import { applyDragDrop, clientToSvgPoint, planDrag, snapHex } from './drag';
import { currentQuestion, isReady, readyAction } from './interactions';

const h = (q: number, r: number): HexKey => `${q},${r}`;

describe('planDrag：矿', () => {
  it('setup 阶段：place-initial-mine → setup-mine 类别（真实引擎枚举）', () => {
    const game = newGame({
      playerCount: 4,
      seed: 42,
      factions: ['terrans', 'xenos', 'geodens', 'itars'],
      lostFleet: true,
    });
    const legal = enumerateActions(game, 0);
    expect(legal.some((a) => a.type === 'place-initial-mine')).toBe(true);
    const plan = planDrag(legal, 'mine');
    expect(plan?.category).toBe('setup-mine');
    expect(plan?.prefill).toEqual([]);
    expect(plan?.targets.size).toBeGreaterThan(0);
    // 目标集 = 全部起始矿 hex
    const expectHexes = new Set(
      legal.filter((a) => a.type === 'place-initial-mine').map((a) => (a as { hex: HexKey }).hex),
    );
    expect(plan?.targets).toEqual(expectHexes);
  });

  it('常规建矿：build-mine → mine 类别', () => {
    const legal: Action[] = [
      { type: 'build-mine', hex: h(0, 0) },
      { type: 'build-mine', hex: h(1, 0) },
      { type: 'pass', booster: 'booster1' },
    ];
    const plan = planDrag(legal, 'mine');
    expect(plan?.category).toBe('mine');
    expect([...(plan?.targets ?? [])].sort()).toEqual([h(0, 0), h(1, 0)]);
  });

  it('pending 免费矿：free-mine 优先于 build-mine；hex=null 跳过项不算落点', () => {
    const legal: Action[] = [
      { type: 'free-mine', hex: h(2, 1) },
      { type: 'free-mine', hex: null },
    ];
    const plan = planDrag(legal, 'mine');
    expect(plan?.category).toBe('free-mine');
    expect([...(plan?.targets ?? [])]).toEqual([h(2, 1)]);
  });

  it('无任何建矿行动 → null（不发起拖拽）', () => {
    expect(planDrag([{ type: 'burn' }], 'mine')).toBeNull();
    expect(planDrag([], 'mine')).toBeNull();
  });
});

describe('planDrag：升级', () => {
  const legal: Action[] = [
    { type: 'upgrade', hex: h(0, 0), to: 'ts' },
    { type: 'upgrade', hex: h(1, 0), to: 'ts' },
    { type: 'upgrade', hex: h(1, 0), to: 'lab', techTile: 'tech1' },
    { type: 'upgrade', hex: h(2, 0), to: 'pi' },
    { type: 'upgrade', hex: h(3, 0), to: 'ac1', techTile: 'tech2' },
  ];

  it('拖 TS → 落点为可升 TS 的己方矿；预填 to=ts', () => {
    const plan = planDrag(legal, 'ts');
    expect(plan?.category).toBe('upgrade');
    expect(plan?.prefill).toEqual([{ field: 'to', value: 'ts' }]);
    expect([...(plan?.targets ?? [])].sort()).toEqual([h(0, 0), h(1, 0)]);
  });

  it('拖 PI/学院 → 各自的升级目标格', () => {
    expect([...(planDrag(legal, 'pi')?.targets ?? [])]).toEqual([h(2, 0)]);
    expect([...(planDrag(legal, 'ac1')?.targets ?? [])]).toEqual([h(3, 0)]);
    expect(planDrag(legal, 'ac2')).toBeNull(); // 无 ac2 升级行动
  });
});

describe('clientToSvgPoint：CTM 逆变换', () => {
  it('均匀缩放 + 平移（viewBox meet 的典型形态）', () => {
    // ctm: client = 2·svg + (100, 50) → client (10, 20) ↔ svg (-45, -15)
    const m = { a: 2, b: 0, c: 0, d: 2, e: 100, f: 50 };
    const p = clientToSvgPoint(m, 10, 20);
    expect(p.x).toBeCloseTo(-45);
    expect(p.y).toBeCloseTo(-15);
  });

  it('带旋转/剪切的一般 2D 仿射（正逆往返）', () => {
    const m = { a: 0.8, b: 0.3, c: -0.2, d: 1.1, e: 7, f: -13 };
    const x = 123;
    const y = 45;
    // 正变换后再逆变换应还原
    const sx = m.a * x + m.c * y + m.e;
    const sy = m.b * x + m.d * y + m.f;
    const p = clientToSvgPoint(m, sx, sy);
    expect(p.x).toBeCloseTo(x);
    expect(p.y).toBeCloseTo(y);
  });
});

describe('snapHex：最近合法格吸附', () => {
  const targets = new Set([h(0, 0), h(2, 0), h(0, 2)]);

  it('目标格中心附近 → 吸附该格', () => {
    const c = hexToPixel(2, 0);
    expect(snapHex({ x: c.x + 3, y: c.y - 5 }, targets)).toBe(h(2, 0));
  });

  it('两个目标之间 → 取更近者', () => {
    const near = new Set([h(0, 0), h(1, 0)]);
    const c0 = hexToPixel(0, 0);
    const c1 = hexToPixel(1, 0);
    // 相邻两格中点偏向 (0,0) 一侧（中点距各自中心 < HEX_SIZE）
    const p = { x: (c0.x + c1.x) / 2 - 5, y: (c0.y + c1.y) / 2 };
    expect(snapHex(p, near)).toBe(h(0, 0));
  });

  it('非目标格位置 / 超半径 → null（弹回）', () => {
    const far = hexToPixel(5, 5);
    expect(snapHex(far, targets)).toBeNull();
    const c = hexToPixel(0, 0);
    expect(snapHex({ x: c.x + HEX_SIZE + 1, y: c.y }, targets)).toBeNull();
  });

  it('空目标集 → null', () => {
    expect(snapHex({ x: 0, y: 0 }, new Set())).toBeNull();
  });
});

describe('applyDragDrop：落锤预填', () => {
  it('建矿：候选收窄到唯一 → readyAction 返回 legalActions 原对象', () => {
    const legal: Action[] = [
      { type: 'build-mine', hex: h(0, 0) },
      { type: 'build-mine', hex: h(1, 0) },
    ];
    const plan = planDrag(legal, 'mine')!;
    const sel = applyDragDrop(legal, plan, h(1, 0));
    expect(sel).not.toBeNull();
    expect(isReady(sel!)).toBe(true);
    expect(readyAction(sel!)).toBe(legal[1]);
  });

  it('升级：hex + to 预填后剩余字段（科技板）仍走选择机追问', () => {
    const legal: Action[] = [
      { type: 'upgrade', hex: h(0, 0), to: 'ts' },
      { type: 'upgrade', hex: h(1, 0), to: 'lab', techTile: 'tech1' },
      { type: 'upgrade', hex: h(1, 0), to: 'lab', techTile: 'tech2' },
    ];
    const plan = planDrag(legal, 'lab')!;
    const sel = applyDragDrop(legal, plan, h(1, 0))!;
    expect(sel.candidates).toHaveLength(2);
    const q = currentQuestion(sel);
    expect(q?.field.key).toBe('techTile');
  });

  it('非法落点（不在 targets）→ null', () => {
    const legal: Action[] = [{ type: 'build-mine', hex: h(0, 0) }];
    const plan = planDrag(legal, 'mine')!;
    expect(applyDragDrop(legal, plan, h(9, 9))).toBeNull();
  });
});
