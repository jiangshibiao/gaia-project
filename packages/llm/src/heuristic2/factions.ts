/**
 * 种族插件：同一套估价框架，族间差异以外挂 hook 表达。
 *
 * - cfg(variant)：本族 cfg 增量（深合并到变体 cfg 之上）——资源价值观差异
 *   （如 Nevlas 一切按充能折算、Taklons 脑石循环依赖充能）。
 * - adjustAction：通用行动分之后的族属修正（如 Geodens PI 后新类型 +3k、
 *   Gleens 盖亚矿 +2vp、Ivits 早联邦奖励）。
 * - adjustFinal：终局计分期望的族属修正（如 Lantids 寄生矿不计行星类型/盖亚、
 *   Ivits 终局全场最弱整体打折）。
 *
 * FACTION_STRENGTH：draft 选族强度表，按变体分表（加不加扩展种族强度差异
 * 很大——LF 里 Terrans 公认底层、Ivits/Xenos/Bescods/Firaks 上升）。
 * 数值是 0-10 的相对强度（BGG 高手段位出价与 LF 锦标赛后讨论的经验值）。
 */
import type {
  Action,
  FinalCondition,
  GameState,
  HexKey,
} from '@gaia/engine';
import type { Cfg, DeepPartial, Variant } from './cfg.js';
import type { EvalCtx } from './context.js';

export interface FactionHooks {
  /** 本族 cfg 增量（按变体给出；深合并到变体 cfg 之上）。 */
  cfg?: (variant: Variant) => DeepPartial<Cfg>;
  /** 通用行动分之后的族属修正（返回新分）。 */
  adjustAction?: (score: number, action: Action, ctx: EvalCtx) => number;
  /** 终局计分单项期望的族属修正（返回新期望值）。 */
  adjustFinal?: (value: number, condition: FinalCondition, ctx: EvalCtx) => number;
}

/** 建矿目标行星类型辅助（adjustAction 内常用）。 */
function minePlanet(state: GameState, hex: HexKey): string | undefined {
  return state.map[hex]?.planet;
}

export const FACTION_HOOKS: Partial<Record<string, FactionHooks>> = {
  // 脑石=每充能约 1o/3c：充能价值翻倍；知识/QIC 极贵（短板）；宁可烧 token
  // 也要每轮用脑石 → burn 惩罚减轻。
  taklons: {
    cfg: () => ({
      resources: { chargePower: 1.5, knowledge: 4, qic: 5 },
    }),
    adjustAction: (s, a) => (a.type === 'burn' ? s + 0.2 : s),
  },
  // 隐形经济：一切资源按充能折算；4 充能片是命门；不上 nav 轨。
  nevlas: {
    cfg: () => ({
      resources: { chargePower: 1.2, powerToken: 2.5 },
      research: { rangePerStep: 1.5 },
    }),
  },
  // 唯一自带 VP 引擎（盖亚星 2vp/颗）；拿不到 QIC 是致命约束。
  gleens: {
    cfg: () => ({
      resources: { qic: 5 },
      research: { rangePerStep: 4 }, // 必冲 nav2
    }),
    adjustAction: (s, a, ctx) => {
      if (a.type === 'build-mine' && minePlanet(ctx.state, a.hex) === 'gaia') return s + 2;
      return s;
    },
  },
  // PI 后每种新行星类型 +3k（≈9 当量）；最需要行星类型/扇区终局。
  geodens: {
    adjustAction: (s, a, ctx) => {
      if (a.type !== 'build-mine') return s;
      const me = ctx.me;
      const piBuilt = me.buildings.pi === 0; // PI 已放上地图
      const planet = minePlanet(ctx.state, a.hex);
      if (
        piBuilt &&
        planet !== undefined &&
        !(me.colonizedPlanetTypes as readonly string[]).includes(planet)
      ) {
        return s + 6; // +3k 净当量（通用 newPlanetType 已含基础进程）
      }
      return s;
    },
  },
  // 寄生矿不可升级、不计行星类型/盖亚 → 两类终局归零；寄生矿本身是蹭电/导航跳板。
  lantids: {
    adjustFinal: (v, cond) => (cond === 'planet-type' || cond === 'gaia' ? 0 : v),
  },
  // 盖亚形成最适配族之一（token 进盖亚碗正好喂 PI）。
  itars: {
    adjustAction: (s, a) => {
      if (a.type === 'research' && a.track === 'gaia') return s + 1.5;
      if (a.type === 'start-gaia-project') return s + 1;
      return s;
    },
  },
  // 终局全场最差（平均 ~11 分）→ 终局权重减半；早联邦是标准打法（R1 联邦）。
  ivits: {
    adjustAction: (s, a, ctx) => {
      if (a.type === 'form-federation' && ctx.state.round <= 2) return s + 2;
      return s;
    },
    adjustFinal: (v) => v * 0.5,
  },
  // 3 矿开局扩张强、科技弱；PI 评价两极（不如多建 RL/矿）。
  xenos: {
    cfg: () => ({
      mine: { base: 5 },
      upgrade: { piUnlock: 2 },
    }),
  },
  // 盖亚形成专精：基础版强（独享 transdim 接近 OP）；LF 人人上盖亚轨 → 贬值。
  terrans: {
    adjustAction: (s, a, ctx) => {
      if (ctx.variant === 'lostFleet') return s; // LF 盖亚轨竞争激烈，不给溢价
      if (a.type === 'research' && a.track === 'gaia') return s + 2;
      if (a.type === 'start-gaia-project') return s + 1.5;
      return s;
    },
  },
  // 信用富余 → 信用贬值、ore 升值；机会主义经济族。
  'hadsch-hallas': {
    cfg: () => ({
      resources: { credits: 0.8, ore: 3.3 },
      upgrade: { piUnlock: 3 }, // PI 绝不 R1 建（R2-4 对齐计分/能力）
    }),
  },
  // 每轮免费爬最低轨 → 更要集中爬高少数轨（高级别奖励更值钱）。
  bescods: {
    adjustAction: (s, a, ctx) => {
      if (a.type !== 'research') return s;
      const lvl = ctx.me.research[a.track];
      return lvl >= 2 ? s + 1 : s;
    },
  },
  // TF 轨快冲（R2 即可 1o/步）；4-5 联邦常态。
  ambas: {
    adjustAction: (s, a) => {
      if (a.type === 'research' && a.track === 'terra') return s + 1.5;
      if (a.type === 'form-federation') return s + 0.5;
      return s;
    },
  },
  // PI 升降机（每轮 1 科技片+3 爬轨）；科技轨重量级。
  firaks: {
    adjustAction: (s, a) => {
      if (a.type === 'upgrade' && (a.to === 'ts' || a.to === 'lab')) return s + 0.5;
      if (a.type === 'research') return s + 0.5;
      return s;
    },
  },
  // 无 nav 轨，靠 gaiaformer 换 QIC 打 QIC 行动流；QIC 升值、gaiaformer 贬值。
  baltaks: {
    cfg: () => ({
      resources: { qic: 4.5, gaiaformer: 2.5 },
    }),
  },
  // --- LF 新族 ---
  // 打高不打宽，科技轨 40+ 是标准画像。
  tinkeroids: {
    adjustAction: (s, a) => (a.type === 'research' ? s + 0.5 : s),
  },
  // 全行星 1 步改造但无母星、盖亚星 2QIC、无改造科技来源 → nav/QIC 升值。
  darkanians: {
    cfg: () => ({
      resources: { qic: 4.5 },
      research: { rangePerStep: 4 },
    }),
  },
  // 只玩 PI 开局+早联邦+高级片（3vp/联邦片可刷 42-48vp）。
  moweyds: {
    adjustAction: (s, a) => {
      if (a.type === 'form-federation') return s + 1;
      if (a.type === 'upgrade' && a.to === 'pi') return s + 1;
      return s;
    },
  },
  // 每轮免费 1 步改造；盖亚形成向；行星类型快。
  'space-giants': {
    adjustAction: (s, a, ctx) => {
      if (a.type === 'build-mine' && minePlanet(ctx.state, a.hex) === 'gaia') return s + 1;
      if (a.type === 'start-gaia-project') return s + 1;
      return s;
    },
  },
};

/** 取族 hook（无注册时返回空对象）。 */
export function factionHooks(faction: string): FactionHooks {
  return FACTION_HOOKS[faction] ?? {};
}

/**
 * draft 选族强度表（0-10 相对强度），按变体分表。
 * 依据：BGG 统计帖 thread/2725599（高手段位出价：Taklons/Itars/Ivits/Ambas/Nevlas
 * 最高）+ LF 锦标赛后帖 thread/3533221（Ivits 依旧最强候选；Xenos/Bescods/Firaks/
 * Lantids 增强；Terrans 公认底层；Darkanians 新族最弱）。
 */
export const FACTION_STRENGTH: Record<Variant, Record<string, number>> = {
  base: {
    taklons: 9,
    itars: 9,
    ivits: 9,
    ambas: 8.5,
    nevlas: 8.5,
    'hadsch-hallas': 8,
    geodens: 8,
    terrans: 7.5,
    firaks: 7,
    bescods: 7,
    xenos: 7,
    gleens: 6,
    lantids: 6,
    baltaks: 6,
  },
  lostFleet: {
    ivits: 9,
    firaks: 8.5,
    xenos: 8.5,
    bescods: 8.5,
    itars: 8.5,
    taklons: 8.5,
    moweyds: 8,
    tinkeroids: 8,
    ambas: 8,
    nevlas: 8,
    lantids: 8,
    'hadsch-hallas': 8,
    geodens: 8,
    gleens: 7,
    'space-giants': 7,
    baltaks: 6,
    darkanians: 5.5,
    terrans: 4.5, // LF 盖亚轨不再被垄断，公认底层
  },
};

/** draft 选族：可用池中按变体强度取最高（未收录的族取 6 中位）。 */
export function pickFactionByStrength<T extends string>(
  available: readonly T[],
  variant: Variant,
): T | undefined {
  const table = FACTION_STRENGTH[variant];
  let best: T | undefined;
  let bestV = -Infinity;
  for (const f of available) {
    const v = table[f] ?? 6;
    if (v > bestV) {
      bestV = v;
      best = f;
    }
  }
  return best;
}
