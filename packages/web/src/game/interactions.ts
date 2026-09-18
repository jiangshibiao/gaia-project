/**
 * 行动交互状态机（M2c）：把引擎枚举的**完全指定** legal actions 分类，
 * 通过"字段逐步收窄"让用户点选出唯一行动。
 *
 * 核心不变量：所有函数返回 legalActions 数组里的**同一个 Action 对象**
 * （绝不新构造）——服务器校验按枚举逐项匹配，新构造的 Action 可能被判
 * illegal-action。参数收集 = 逐步缩小 legalActions 子集，最后取唯一项。
 *
 * 模型：
 * - CategoryDef：一类行动（建矿/升级/联邦/研究/……）+ 有序字段列表；
 * - Selection：当前类别 + 已收窄的候选集；
 * - currentQuestion：候选集中第一个存在 ≥2 种取值的字段即当前问题——
 *   单值字段自动收窄（玩家无感）；hex 字段的问题由棋盘点选回答，
 *   其余字段由选项对话框回答；联邦类别为列表模式（完整枚举直接列选）。
 */
import type {
  Action,
  AdvTechTileId,
  ArtifactId,
  BoardActionId,
  BoosterId,
  FederationTokenId,
  HexKey,
  ResearchTrack,
  ShipActionId,
  ShipId,
  SpecialActionId,
  TechTileId,
  TinkeringTileId,
} from '@gaia/engine';
import {
  advTechTileName,
  artifactName,
  boardActionLabel,
  boosterName,
  buildingName,
  conversionLabel,
  describeAction,
  federationTokenName,
  shipActionLabel,
  shipName,
  specialActionLabel,
  techTileName,
  tinkeringName,
  trackName,
} from './display';

// ---------------------------------------------------------------------------
// 类别定义
// ---------------------------------------------------------------------------

export type CategoryId =
  | 'mine' // 建矿
  | 'gaia-project' // 盖亚计划
  | 'upgrade' // 升级建筑
  | 'federation' // 组建联邦（列表模式）
  | 'research' // 研究
  | 'power' // power 行动
  | 'qic' // QIC 行动
  | 'special' // 特殊行动
  | 'ship-action' // 飞船行动
  | 'explore' // 探索飞船
  | 'artifact' // 检视神器
  | 'pass' // Pass
  | 'convert' // 免费兑换
  | 'burn' // 烧脑
  | 'setup-mine' // 放起始矿
  | 'setup-booster' // 选起始助推器
  // 以下为 pending 响应类别
  | 'itars-tech' // 伊塔盖亚阶段拿板
  | 'tinkering' // 修补匠选板块
  | 'gain-tech' // gain-tech-tile 响应
  | 'free-mine'; // 免费建矿响应

/** 字段定义：get 返回该行动在此字段的取值（null = 未指定，作为"无"选项）。 */
export interface FieldDef {
  key: string;
  label: string;
  /** hex 字段的问题由棋盘点选回答（高亮可选格）。 */
  kind: 'hex' | 'choice';
  get: (a: Action) => string | null;
  /** 选项文案（value 为 null 时用 nullLabel）。 */
  format: (v: string) => string;
  nullLabel?: string;
}

export interface CategoryDef {
  id: CategoryId;
  label: string;
  match: (a: Action) => boolean;
  fields: FieldDef[];
  /** list：候选直接全列表展示（联邦枚举），不走字段收窄。 */
  mode?: 'list';
}

/** 取行动 payload 字段（无 payload 返回 null）。 */
function payloadGet(key: string): (a: Action) => string | null {
  return (a) => {
    const p = (a as { payload?: Record<string, unknown> }).payload;
    const v = p?.[key];
    return typeof v === 'string' ? v : null;
  };
}

function field(
  key: string,
  label: string,
  get: (a: Action) => string | null,
  format: (v: string) => string,
  opts: { kind?: 'hex' | 'choice'; nullLabel?: string } = {},
): FieldDef {
  return { key, label, get, format, kind: opts.kind ?? 'choice', ...(opts.nullLabel !== undefined ? { nullLabel: opts.nullLabel } : {}) };
}

const hexField = (key: string, label: string, get: (a: Action) => string | null): FieldDef =>
  field(key, label, get, (v) => v, { kind: 'hex' });

/** 升级/拿板共用的科技板尾部字段（techTile → ship → 高级板 → 覆盖板 → 翻标记 → 升轨 → 失落星球）。 */
const techTailFields = (
  techTileGet: (a: Action) => string | null,
  advGet: (a: Action) => string | null,
  coverGet: (a: Action) => string | null,
  flipGet: (a: Action) => string | null,
  researchGet: (a: Action) => string | null,
  lostPlanetGet: (a: Action) => string | null,
  shipGet: (a: Action) => string | null,
  techNullLabel?: string,
): FieldDef[] => [
  field('techTile', '科技板', techTileGet, (v) => techTileName(v as TechTileId), techNullLabel !== undefined ? { nullLabel: techNullLabel } : {}),
  field('ship', '从飞船拿板', shipGet, (v) => shipName(v as ShipId), { nullLabel: '从供应拿' }),
  field('advTechTile', '高级科技板', advGet, (v) => advTechTileName(v as AdvTechTileId), { nullLabel: '不拿高级板' }),
  field('coverTechTile', '被覆盖的板', coverGet, (v) => techTileName(v as TechTileId)),
  field('flipToken', '翻面联邦标记', flipGet, (v) => federationTokenName(v as FederationTokenId)),
  field('research', '推进研究轨', researchGet, (v) => trackName(v as ResearchTrack), { nullLabel: '不推进' }),
  hexField('lostPlanetHex', '失落星球放置格', lostPlanetGet),
];

const responseGet = <T extends Action['type'], K extends string>(type: T, key: K) =>
  (a: Action): string | null => {
    if (a.type !== type) return null;
    const v = (a as unknown as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : null;
  };

const upgradeGet = <K extends string>(key: K) => responseGet('upgrade', key);

export const CATEGORIES: readonly CategoryDef[] = [
  {
    id: 'mine',
    label: '建矿',
    match: (a) => a.type === 'build-mine',
    fields: [hexField('hex', '目标格', responseGet('build-mine', 'hex'))],
  },
  {
    id: 'gaia-project',
    label: '盖亚计划',
    match: (a) => a.type === 'start-gaia-project',
    fields: [hexField('hex', '目标格', responseGet('start-gaia-project', 'hex'))],
  },
  {
    id: 'upgrade',
    label: '升级建筑',
    match: (a) => a.type === 'upgrade',
    fields: [
      hexField('hex', '升级建筑格', upgradeGet('hex')),
      field('to', '升级为', upgradeGet('to'), (v) => buildingName(v as 'ts')),
      ...techTailFields(
        upgradeGet('techTile'),
        upgradeGet('advTechTile'),
        upgradeGet('coverTechTile'),
        upgradeGet('flipToken'),
        upgradeGet('research'),
        upgradeGet('lostPlanetHex'),
        upgradeGet('ship'),
        '放弃拿板',
      ),
    ],
  },
  {
    id: 'federation',
    label: '组建联邦',
    match: (a) => a.type === 'form-federation',
    fields: [],
    mode: 'list',
  },
  {
    id: 'research',
    label: '研究',
    match: (a) => a.type === 'research',
    fields: [
      field('track', '研究轨', responseGet('research', 'track'), (v) => trackName(v as ResearchTrack)),
      field('flipToken', '翻面联邦标记', responseGet('research', 'flipToken'), (v) => federationTokenName(v as FederationTokenId)),
      hexField('hex', '失落星球放置格', responseGet('research', 'hex')),
    ],
  },
  {
    id: 'power',
    label: '充能行动',
    match: (a) => a.type === 'power-action',
    fields: [
      field('action', '行动格', responseGet('power-action', 'action'), (v) => boardActionLabel(v as BoardActionId)),
      hexField('hex', '目标格', payloadGet('hex')),
      field('track', '研究轨', payloadGet('track'), (v) => trackName(v as ResearchTrack)),
      field('techTile', '科技板', payloadGet('techTile'), (v) => techTileName(v as TechTileId)),
      field('federationToken', '联邦标记', payloadGet('federationToken'), (v) => federationTokenName(v as FederationTokenId)),
    ],
  },
  {
    id: 'qic',
    label: 'QIC 行动',
    match: (a) => a.type === 'qic-action',
    fields: [
      field('action', '行动格', responseGet('qic-action', 'action'), (v) => boardActionLabel(v as BoardActionId)),
      hexField('hex', '目标格', payloadGet('hex')),
      field('track', '研究轨', payloadGet('track'), (v) => trackName(v as ResearchTrack)),
      field('techTile', '科技板', payloadGet('techTile'), (v) => techTileName(v as TechTileId)),
      field('federationToken', '联邦标记', payloadGet('federationToken'), (v) => federationTokenName(v as FederationTokenId)),
    ],
  },
  {
    id: 'special',
    label: '特殊行动',
    match: (a) => a.type === 'special-action',
    fields: [
      field('action', '特殊行动', responseGet('special-action', 'action'), (v) => specialActionLabel(v as SpecialActionId)),
      hexField('hex', '目标格', payloadGet('hex')),
      field('track', '研究轨', payloadGet('track'), (v) => trackName(v as ResearchTrack)),
      field('ship', '飞船', payloadGet('ship'), (v) => shipName(v as ShipId)),
    ],
  },
  {
    id: 'ship-action',
    label: '飞船行动',
    match: (a) => a.type === 'ship-action',
    fields: [
      field('ship', '飞船', responseGet('ship-action', 'ship'), (v) => shipName(v as ShipId)),
      field('action', '行动格', responseGet('ship-action', 'action'), (v) => shipActionLabel(v as ShipActionId)),
      hexField('hex', '目标格', payloadGet('hex')),
      field('track', '研究轨', payloadGet('track'), (v) => trackName(v as ResearchTrack)),
      field('techTile', '科技板', payloadGet('techTile'), (v) => techTileName(v as TechTileId)),
      field('federationToken', '联邦标记', payloadGet('federationToken'), (v) => federationTokenName(v as FederationTokenId)),
    ],
  },
  {
    id: 'explore',
    label: '探索飞船',
    match: (a) => a.type === 'explore-ship',
    fields: [field('ship', '飞船', responseGet('explore-ship', 'ship'), (v) => shipName(v as ShipId))],
  },
  {
    id: 'artifact',
    label: '检视神器',
    match: (a) => a.type === 'inspect-artifact',
    fields: [
      field('artifact', '神器', responseGet('inspect-artifact', 'artifact'), (v) => artifactName(v as ArtifactId)),
      field('federationToken', '重触发联邦标记', responseGet('inspect-artifact', 'federationToken'), (v) => federationTokenName(v as FederationTokenId)),
    ],
  },
  {
    id: 'pass',
    label: 'Pass',
    match: (a) => a.type === 'pass',
    fields: [field('booster', '换助推器', responseGet('pass', 'booster'), (v) => boosterName(v as BoosterId), { nullLabel: '（不更换）' })],
  },
  {
    id: 'convert',
    label: '免费兑换',
    match: (a) => a.type === 'free-conversion',
    fields: [field('conversion', '兑换', responseGet('free-conversion', 'conversion'), (v) => conversionLabel(v as never))],
  },
  {
    id: 'burn',
    label: '烧脑',
    match: (a) => a.type === 'burn',
    fields: [],
  },
  {
    id: 'setup-mine',
    label: '放置起始矿',
    match: (a) => a.type === 'place-initial-mine',
    fields: [hexField('hex', '起始矿位置', responseGet('place-initial-mine', 'hex'))],
  },
  {
    id: 'setup-booster',
    label: '选起始助推器',
    match: (a) => a.type === 'choose-booster',
    fields: [field('booster', '助推器', responseGet('choose-booster', 'booster'), (v) => boosterName(v as BoosterId))],
  },
  {
    id: 'itars-tech',
    label: '伊塔盖亚阶段',
    match: (a) => a.type === 'itars-gaia-tech',
    fields: techTailFields(
      responseGet('itars-gaia-tech', 'techTile'),
      responseGet('itars-gaia-tech', 'advTechTile'),
      responseGet('itars-gaia-tech', 'coverTechTile'),
      responseGet('itars-gaia-tech', 'flipToken'),
      responseGet('itars-gaia-tech', 'research'),
      () => null,
      () => null,
      '结束盖亚阶段',
    ),
  },
  {
    id: 'tinkering',
    label: '选择修补板块',
    match: (a) => a.type === 'choose-tinkering',
    fields: [field('tile', '修补板块', responseGet('choose-tinkering', 'tile'), (v) => tinkeringName(v as TinkeringTileId))],
  },
  {
    id: 'gain-tech',
    label: '拿科技板',
    match: (a) => a.type === 'gain-tech-tile',
    fields: techTailFields(
      responseGet('gain-tech-tile', 'techTile'),
      responseGet('gain-tech-tile', 'advTechTile'),
      responseGet('gain-tech-tile', 'coverTechTile'),
      responseGet('gain-tech-tile', 'flipToken'),
      responseGet('gain-tech-tile', 'research'),
      responseGet('gain-tech-tile', 'lostPlanetHex'),
      responseGet('gain-tech-tile', 'ship'),
      '放弃',
    ),
  },
  {
    id: 'free-mine',
    label: '免费建矿',
    match: (a) => a.type === 'free-mine',
    fields: [hexField('hex', '免费建矿格', responseGet('free-mine', 'hex'))],
  },
];

const CATEGORY_MAP = new Map(CATEGORIES.map((c) => [c.id, c]));

export function categoryDef(id: CategoryId): CategoryDef {
  const def = CATEGORY_MAP.get(id);
  if (def === undefined) throw new Error(`未知行动类别 ${id}`);
  return def;
}

/** legalActions 中存在的类别（保持 CATEGORIES 声明顺序）。 */
export function availableCategories(legalActions: readonly Action[]): CategoryDef[] {
  return CATEGORIES.filter((c) => legalActions.some(c.match));
}

// ---------------------------------------------------------------------------
// 选择状态机
// ---------------------------------------------------------------------------

export interface Selection {
  category: CategoryId;
  /** 当前收窄后的候选（legalActions 的子集，元素为原对象）。 */
  candidates: Action[];
}

export function startSelection(
  legalActions: readonly Action[],
  category: CategoryId,
): Selection | null {
  const def = categoryDef(category);
  const candidates = legalActions.filter(def.match);
  if (candidates.length === 0) return null;
  return { category, candidates };
}

/** 字段在候选集中的去重取值（保持首次出现顺序；null 表示"未指定"）。 */
function distinctValues(candidates: readonly Action[], f: FieldDef): (string | null)[] {
  const seen = new Set<string | null>();
  const out: (string | null)[] = [];
  for (const a of candidates) {
    const v = f.get(a);
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}

export interface Question {
  field: FieldDef;
  options: { value: string | null; label: string }[];
}

/**
 * 当前待回答问题：候选集中第一个有 ≥2 种取值的字段。
 * 单值字段被跳过（隐含自动收窄）；返回 null 表示可以定稿
 * （readyAction 取唯一候选；候选 >1 但无区分字段时由 UI 退化为列表直选）。
 */
export function currentQuestion(sel: Selection): Question | null {
  if (sel.candidates.length <= 1) return null;
  const def = categoryDef(sel.category);
  for (const f of def.fields) {
    const values = distinctValues(sel.candidates, f);
    if (values.length >= 2) {
      return {
        field: f,
        options: values.map((v) => ({
          value: v,
          label: v === null ? (f.nullLabel ?? '（无）') : f.format(v),
        })),
      };
    }
  }
  return null;
}

/** 回答当前问题（按字段取值收窄候选）。 */
export function pick(sel: Selection, fieldKey: string, value: string | null): Selection {
  const def = categoryDef(sel.category);
  const f = def.fields.find((x) => x.key === fieldKey);
  if (f === undefined) return sel;
  const candidates = sel.candidates.filter((a) => f.get(a) === value);
  if (candidates.length === 0) return sel; // 非法取值：忽略（不应发生，选项来自 distinctValues）
  return { ...sel, candidates };
}

/**
 * 定稿：候选收窄到唯一行动时返回它（原对象，可直接 submit）。
 * 候选 >1 但无区分字段（理论上字段表完备时不会发生）返回 null，
 * UI 应退化为列表直选（describeCandidate）。
 */
export function readyAction(sel: Selection): Action | null {
  if (sel.candidates.length === 1) return sel.candidates[0] ?? null;
  return null;
}

/** 是否已可提交。 */
export function isReady(sel: Selection): boolean {
  return sel.candidates.length === 1;
}

/** 当前问题为 hex 字段时的可选格集合（棋盘高亮用）；非 hex 问题返回空集。 */
export function hexTargets(sel: Selection): Set<HexKey> {
  const q = currentQuestion(sel);
  if (q === null || q.field.kind !== 'hex') return new Set();
  return new Set(q.options.map((o) => o.value).filter((v): v is HexKey => v !== null) as HexKey[]);
}

/** 列表模式/退化直选：候选一句话描述。 */
export function describeCandidate(a: Action): string {
  return describeAction(a);
}

// ---------------------------------------------------------------------------
// 便捷查询
// ---------------------------------------------------------------------------

/** legalActions 中是否存在某类响应行动（pending 且轮到我时直接取原对象提交）。 */
export function findResponse<T extends Action['type']>(
  legalActions: readonly Action[],
  type: T,
): Extract<Action, { type: T }> | undefined {
  return legalActions.find((a): a is Extract<Action, { type: T }> => a.type === type);
}
