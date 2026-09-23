/**
 * interactions 行动状态机单测：
 * - 类别分组（availableCategories）；
 * - 字段逐步收窄（currentQuestion 跳过单值字段、pick 过滤、readyAction 返回原对象）；
 * - hex 目标提取（hexTargets）；
 * - 真实引擎枚举（setup 起始矿）端到端验证"返回 legalActions 中的原对象"。
 */
import { describe, expect, it } from 'vitest';
import { enumerateActions, newGame } from '@gaia/engine';
import type { Action, HexKey } from '@gaia/engine';
import {
  availableCategories,
  categoryDef,
  currentQuestion,
  describeCandidate,
  findResponse,
  hexTargets,
  isReady,
  pick,
  readyAction,
  startSelection,
} from './interactions';

const h = (q: number, r: number): HexKey => `${q},${r}`;

describe('availableCategories 类别分组', () => {
  it('按声明顺序返回 legalActions 中存在的类别', () => {
    const legal: Action[] = [
      { type: 'build-mine', hex: h(0, 0) },
      { type: 'pass', booster: 'booster1' },
      { type: 'free-conversion', conversion: 'pw3-o' },
      { type: 'burn' },
    ];
    const ids = availableCategories(legal).map((c) => c.id);
    expect(ids).toEqual(['mine', 'pass', 'convert', 'burn']);
  });

  it('空 legalActions 返回空', () => {
    expect(availableCategories([])).toEqual([]);
  });
});

describe('类别字段清单回归（高级板三件套）', () => {
  // ship-action 升 lab 拿板必须有 advTechTile/coverTechTile/flipToken——漏列会让
  // 高级板候选在选择机里塌缩不可见。
  it('ship-action / upgrade / gain-tech 均含高级板三字段', () => {
    for (const id of ['ship-action', 'upgrade', 'gain-tech'] as const) {
      const keys = categoryDef(id).fields.map((f) => f.key);
      expect(keys, id).toContain('advTechTile');
      expect(keys, id).toContain('coverTechTile');
      expect(keys, id).toContain('flipToken');
    }
  });

  it('ship-action 选择流：升 lab + 高级板候选可选中并提交原对象', () => {
    const advAction = {
      type: 'ship-action',
      ship: 'twilight',
      action: 'ship-upgrade-ts-lab',
      payload: { hex: '0,1', advTechTile: 'advtech11', coverTechTile: 'tech9', flipToken: 'fedlf2', track: 'eco' },
    } as const;
    const stdAction = {
      type: 'ship-action',
      ship: 'twilight',
      action: 'ship-upgrade-ts-lab',
      payload: { hex: '0,1', techTile: 'tech1', track: 'eco' },
    } as const;
    const legal = [advAction, stdAction] as unknown as Action[];
    let sel = startSelection(legal, 'ship-action')!;
    for (const [k, v] of [
      ['ship', 'twilight'],
      ['action', 'ship-upgrade-ts-lab'],
      ['hex', '0,1'],
      ['advTechTile', 'advtech11'],
      ['coverTechTile', 'tech9'],
      ['flipToken', 'fedlf2'],
      ['track', 'eco'],
    ] as const) {
      sel = pick(sel, k, v);
    }
    expect(isReady(sel)).toBe(true);
    expect(readyAction(sel)).toBe(advAction);
  });
});

describe('建矿选择流（hex 字段）', () => {
  const legal: Action[] = [
    { type: 'build-mine', hex: h(0, 0) },
    { type: 'build-mine', hex: h(1, 0) },
    { type: 'build-mine', hex: h(2, 0) },
  ];

  it('startSelection 收集全部候选，当前问题为 hex 字段', () => {
    const sel = startSelection(legal, 'mine');
    expect(sel).not.toBeNull();
    expect(sel?.candidates).toHaveLength(3);
    const q = currentQuestion(sel!);
    expect(q?.field.key).toBe('hex');
    expect(q?.field.kind).toBe('hex');
    expect(q?.options.map((o) => o.value)).toEqual([h(0, 0), h(1, 0), h(2, 0)]);
  });

  it('hexTargets 返回可选格集合', () => {
    const sel = startSelection(legal, 'mine')!;
    expect([...hexTargets(sel)].sort()).toEqual([h(0, 0), h(1, 0), h(2, 0)]);
  });

  it('pick hex 后候选唯一 → readyAction 返回 legalActions 中的原对象', () => {
    const sel = startSelection(legal, 'mine')!;
    const picked = pick(sel, 'hex', h(1, 0));
    expect(isReady(picked)).toBe(true);
    expect(readyAction(picked)).toBe(legal[1]); // 同一对象引用，非新构造
  });

  it('非法取值（不在选项中）不改变候选集', () => {
    const sel = startSelection(legal, 'mine')!;
    const picked = pick(sel, 'hex', h(9, 9));
    expect(picked.candidates).toHaveLength(3);
  });
});

describe('升级选择流（多字段逐步收窄）', () => {
  const legal: Action[] = [
    { type: 'upgrade', hex: h(0, 0), to: 'ts' },
    { type: 'upgrade', hex: h(0, 0), to: 'lab', techTile: 'tech1', research: null },
    { type: 'upgrade', hex: h(0, 0), to: 'lab', techTile: 'tech2', research: 'nav' },
    { type: 'upgrade', hex: h(1, 0), to: 'ts' },
  ];

  it('依次回答 hex → to → techTile，单值字段自动跳过', () => {
    let sel = startSelection(legal, 'upgrade')!;
    // 第一问：hex（4 个候选 2 种取值）
    expect(currentQuestion(sel)?.field.key).toBe('hex');
    sel = pick(sel, 'hex', h(0, 0));
    // 第二问：to（ts/lab/lab → 2 种取值）
    expect(currentQuestion(sel)?.field.key).toBe('to');
    sel = pick(sel, 'to', 'lab');
    // 第三问：techTile（tech1/tech2；research 字段此时也是 2 种取值但 techTile 在前）
    const q = currentQuestion(sel);
    expect(q?.field.key).toBe('techTile');
    expect(q?.options.map((o) => o.label)).toEqual(['矿石与 QIC', '星球类型知识']);
    sel = pick(sel, 'techTile', 'tech2');
    // research 只剩 'nav' 单值 → 自动收窄，候选唯一定稿
    expect(isReady(sel)).toBe(true);
    expect(readyAction(sel)).toBe(legal[2]);
  });

  it('techTile 的 null 取值作为显式选项（"放弃拿板"）', () => {
    const withNull: Action[] = [
      { type: 'upgrade', hex: h(0, 0), to: 'lab', techTile: 'tech1' },
      { type: 'upgrade', hex: h(0, 0), to: 'lab', techTile: null as never },
    ];
    const sel = startSelection(withNull, 'upgrade')!;
    const q = currentQuestion(sel);
    expect(q?.field.key).toBe('techTile');
    expect(q?.options.map((o) => o.value)).toEqual(['tech1', null]);
    const picked = pick(sel, 'techTile', null);
    expect(readyAction(picked)).toBe(withNull[1]);
  });
});

describe('pass / 免费兑换 / 烧脑', () => {
  it('pass：booster 字段选项，null 为"不更换"', () => {
    const legal: Action[] = [
      { type: 'pass', booster: 'booster1' },
      { type: 'pass', booster: null },
    ];
    const sel = startSelection(legal, 'pass')!;
    const q = currentQuestion(sel);
    expect(q?.field.key).toBe('booster');
    expect(q?.options.map((o) => o.label)).toEqual(['矿石与知识收入', '（不更换）']);
    expect(readyAction(pick(sel, 'booster', 'booster1'))).toBe(legal[0]);
    expect(readyAction(pick(sel, 'booster', null))).toBe(legal[1]);
  });

  it('convert：conversion 字段选项文案来自数据表', () => {
    const legal: Action[] = [
      { type: 'free-conversion', conversion: 'pw3-o' },
      { type: 'free-conversion', conversion: 'pw1-c' },
    ];
    const sel = startSelection(legal, 'convert')!;
    const q = currentQuestion(sel);
    expect(q?.field.key).toBe('conversion');
    expect(q?.options.map((o) => o.label)).toEqual(['3 能 → 1 矿', '1 能 → 1 币']);
  });

  it('burn：无字段，单候选立即定稿', () => {
    const legal: Action[] = [{ type: 'burn' }];
    const sel = startSelection(legal, 'burn')!;
    expect(isReady(sel)).toBe(true);
    expect(readyAction(sel)).toBe(legal[0]);
  });
});

describe('power/qic 行动（payload 字段）', () => {
  it('power-action：action 字段优先，随后 payload.hex（棋盘字段）', () => {
    const legal: Action[] = [
      { type: 'power-action', action: 'power2', payload: { hex: h(0, 0) } },
      { type: 'power-action', action: 'power2', payload: { hex: h(1, 0) } },
      { type: 'power-action', action: 'power3' },
    ];
    let sel = startSelection(legal, 'power')!;
    expect(currentQuestion(sel)?.field.key).toBe('action');
    sel = pick(sel, 'action', 'power2');
    const q = currentQuestion(sel);
    expect(q?.field.key).toBe('hex');
    expect(q?.field.kind).toBe('hex');
    sel = pick(sel, 'hex', h(1, 0));
    expect(readyAction(sel)).toBe(legal[1]);
  });
});

describe('组建联邦（列表模式）', () => {
  it('mode=list，候选一句话描述为"N 星球+M 卫星 → 标记名"', () => {
    const legal: Action[] = [
      { type: 'form-federation', hexes: [h(0, 0), h(1, 0)], satellites: [h(0, 1)], token: 'fed1' },
      { type: 'form-federation', hexes: [h(0, 0)], satellites: [], token: 'fed6' },
    ];
    expect(categoryDef('federation').mode).toBe('list');
    const sel = startSelection(legal, 'federation')!;
    expect(sel.candidates).toHaveLength(2);
    expect(describeCandidate(legal[0]!)).toBe('组建联邦（2 星球+1 卫星）→ 12 分');
    expect(describeCandidate(legal[1]!)).toBe('组建联邦（1 星球+0 卫星）→ 6 分 + 2 知');
  });
});

describe('pending 响应类别', () => {
  it('charge/decline-charge 经 findResponse 直接取原对象', () => {
    const legal: Action[] = [{ type: 'charge' }, { type: 'decline-charge' }];
    expect(findResponse(legal, 'charge')).toBe(legal[0]);
    expect(findResponse(legal, 'decline-charge')).toBe(legal[1]);
    expect(findResponse(legal, 'burn')).toBeUndefined();
  });

  it('free-mine：hex 选项含 null（跳过）', () => {
    const legal: Action[] = [
      { type: 'free-mine', hex: h(0, 0) },
      { type: 'free-mine', hex: null },
    ];
    const sel = startSelection(legal, 'free-mine')!;
    const q = currentQuestion(sel);
    expect(q?.field.kind).toBe('hex');
    expect(q?.options.map((o) => o.value)).toEqual([h(0, 0), null]);
    expect(readyAction(pick(sel, 'hex', null))).toBe(legal[1]);
  });

  it('tinkering：tile 字段', () => {
    const legal: Action[] = [
      { type: 'choose-tinkering', tile: 'tink1' },
      { type: 'choose-tinkering', tile: 'tink3' },
    ];
    const sel = startSelection(legal, 'tinkering')!;
    expect(currentQuestion(sel)?.field.key).toBe('tile');
    expect(readyAction(pick(sel, 'tile', 'tink3'))).toBe(legal[1]);
  });
});

describe('真实引擎枚举（setup 起始矿）', () => {
  it('newGame 后 setup 行动归入 setup-mine，hex 目标非空，pick 返回原对象', () => {
    const game = newGame({
      playerCount: 4,
      seed: 42,
      factions: ['terrans', 'xenos', 'geodens', 'itars'],
      lostFleet: true,
    });
    expect(game.phase).toBe('setup');
    const actor = game.setupQueue[0];
    expect(actor).toBeDefined();
    const legal = enumerateActions(game, actor!);
    expect(legal.length).toBeGreaterThan(0);
    const ids = availableCategories(legal).map((c) => c.id);
    expect(ids).toContain('setup-mine');
    const sel = startSelection(legal, 'setup-mine')!;
    const q = currentQuestion(sel);
    expect(q?.field.kind).toBe('hex');
    expect(hexTargets(sel).size).toBeGreaterThan(0);
    const firstHex = q!.options[0]!.value;
    const done = pick(sel, 'hex', firstHex);
    expect(isReady(done)).toBe(true);
    const action = readyAction(done);
    // 返回 legalActions 中的原对象（服务器按枚举匹配，不能是新构造）
    expect(legal).toContain(action);
  });
});
