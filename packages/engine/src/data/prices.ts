/**
 * 价格表：建筑费用、升级链、建筑 power value、board action、免费兑换、飞船行动格。
 * 数据核对：reference/gaia-engine/src/buildings.ts、actions.ts、
 * faction-boards/types.ts（费用）+ docs/rules-summary.md §1/§2.5 +
 * reference/lost-fleet-rules.txt Appendix II（飞船行动格）。
 */
import type {
  BoardActionId,
  BuildingType,
  FactionId,
  FreeConversionId,
  ShipActionId,
} from '../types.js';
import type { ResourceGain } from './rewards.js';

// ---------------------------------------------------------------------------
// 建筑费用与升级链
// ---------------------------------------------------------------------------

export interface BuildingCost {
  ore: number;
  credits: number;
}

/** 建筑费用。TS 有两种价：2 格内有对手建筑用 tsAdjacent。 */
export const BUILDING_COST = {
  mine: { ore: 1, credits: 2 },
  ts: { ore: 2, credits: 6 },
  tsAdjacent: { ore: 2, credits: 3 },
  lab: { ore: 3, credits: 5 },
  pi: { ore: 4, credits: 6 },
  academy: { ore: 6, credits: 6 },
} as const satisfies Record<string, BuildingCost>;

/** 升级链（bescods 因 PI/学院位置互换而不同，见 UPGRADE_CHAIN_BESCODS）。 */
export const UPGRADE_CHAIN: Record<BuildingType, readonly BuildingType[]> = {
  gf: ['mine'],
  mine: ['ts'],
  ts: ['lab', 'pi'],
  lab: ['ac1', 'ac2'],
  pi: [],
  ac1: [],
  ac2: [],
  sp: [],
};

export const UPGRADE_CHAIN_BESCODS: Record<BuildingType, readonly BuildingType[]> = {
  gf: ['mine'],
  mine: ['ts'],
  ts: ['lab', 'ac1', 'ac2'],
  lab: ['pi'],
  pi: [],
  ac1: [],
  ac2: [],
  sp: [],
};

/**
 * 建筑 power value（组联邦与被动充能用）。
 * 注：Ivits 空间站 pv 1；tech3 被动使 PI/学院变 4；bescods 钛星建筑 +1；
 * Moweyds Power Ring +2。
 */
export const BUILDING_POWER_VALUE: Record<BuildingType, number> = {
  mine: 1,
  ts: 2,
  lab: 2,
  pi: 3,
  ac1: 3,
  ac2: 3,
  gf: 0,
  sp: 0,
};

/** 组建联邦所需最小总 power value（xenos PI 后为 6）。 */
export const FEDERATION_MIN_POWER = 7;

/** 升级 lab/学院立即拿 1 块科技板（一次性，非收入）。 */
// ---------------------------------------------------------------------------
// 研究板 power / qic 行动格（每格每轮全场 1 次）
// ---------------------------------------------------------------------------

export type BoardActionEffect =
  | { kind: 'gain'; gain: ResourceGain }
  | { kind: 'build-mine'; freeTerraformSteps: number }
  | { kind: 'gain-tech-tile' }
  | { kind: 'rescore-federation' }
  | { kind: 'vp-per-planet-type'; base: number; perType: number };

export interface BoardActionDef {
  id: BoardActionId;
  cost: { power?: number; qic?: number };
  effect: BoardActionEffect;
}

/**
 * board action 价格。
 * 注：Lost Fleet 中研究板 3 个 QIC 行动格被覆盖板盖住整局不可用，
 * QIC 行动改由飞船行动格提供（见 SHIP_ACTIONS）。
 */
export const BOARD_ACTIONS: Record<BoardActionId, BoardActionDef> = {
  power1: { id: 'power1', cost: { power: 7 }, effect: { kind: 'gain', gain: { knowledge: 3 } } },
  power2: {
    id: 'power2',
    cost: { power: 5 },
    effect: { kind: 'build-mine', freeTerraformSteps: 2 },
  },
  power3: { id: 'power3', cost: { power: 4 }, effect: { kind: 'gain', gain: { ore: 2 } } },
  power4: { id: 'power4', cost: { power: 4 }, effect: { kind: 'gain', gain: { credits: 7 } } },
  power5: { id: 'power5', cost: { power: 4 }, effect: { kind: 'gain', gain: { knowledge: 2 } } },
  power6: {
    id: 'power6',
    cost: { power: 3 },
    effect: { kind: 'build-mine', freeTerraformSteps: 1 },
  },
  power7: { id: 'power7', cost: { power: 3 }, effect: { kind: 'gain', gain: { powerToken: 2 } } },
  qic1: { id: 'qic1', cost: { qic: 4 }, effect: { kind: 'gain-tech-tile' } },
  qic2: { id: 'qic2', cost: { qic: 3 }, effect: { kind: 'rescore-federation' } },
  qic3: {
    id: 'qic3',
    cost: { qic: 2 },
    effect: { kind: 'vp-per-planet-type', base: 3, perType: 1 },
  },
};

// ---------------------------------------------------------------------------
// 免费兑换（行动前后任意次）
// ---------------------------------------------------------------------------

export interface ConversionCost {
  /** 从 III 区花费 power。 */
  power?: number;
  /** 从 Gaia 区弃 power（terrans 盖亚阶段）。 */
  gaiaPower?: number;
  ore?: number;
  credits?: number;
  knowledge?: number;
  qic?: number;
  /** 弃 1 个可用 gaiaformer 入 Gaia 区（baltaks）。 */
  gaiaformer?: number;
  /** 从 III 区移 1 个 power token 入 Gaia 区（nevlas，不算花费）。 */
  powerTokenFromBowl3?: number;
}

export interface FreeConversionDef {
  id: FreeConversionId;
  cost: ConversionCost;
  gain: ResourceGain;
  /** 获得的 power token 直接放 III 区（xenos-o-t3；默认放 I 区）。 */
  powerTokenToBowl3?: boolean;
  /** null = 全族通用。 */
  faction: FactionId | null;
  requiresPI?: boolean;
  /** 仅盖亚阶段可用（terrans-gaia-*）。 */
  gaiaPhaseOnly?: boolean;
  /** 仅 Lost Fleet 可用（xenos-o-t3 等 LF 新增免费行动）。 */
  lostFleet?: boolean;
}

export const FREE_CONVERSIONS: Record<FreeConversionId, FreeConversionDef> = {
  'pw4-q': { id: 'pw4-q', cost: { power: 4 }, gain: { qic: 1 }, faction: null },
  'pw3-o': { id: 'pw3-o', cost: { power: 3 }, gain: { ore: 1 }, faction: null },
  'q-o': { id: 'q-o', cost: { qic: 1 }, gain: { ore: 1 }, faction: null },
  'pw4-k': { id: 'pw4-k', cost: { power: 4 }, gain: { knowledge: 1 }, faction: null },
  'pw1-c': { id: 'pw1-c', cost: { power: 1 }, gain: { credits: 1 }, faction: null },
  'k-c': { id: 'k-c', cost: { knowledge: 1 }, gain: { credits: 1 }, faction: null },
  'o-c': { id: 'o-c', cost: { ore: 1 }, gain: { credits: 1 }, faction: null },
  'o-t': { id: 'o-t', cost: { ore: 1 }, gain: { powerToken: 1 }, faction: null },
  'nevlas-pw-k': {
    id: 'nevlas-pw-k',
    cost: { powerTokenFromBowl3: 1 },
    gain: { knowledge: 1 },
    faction: 'nevlas',
  },
  'nevlas-pw4-oc': {
    id: 'nevlas-pw4-oc',
    cost: { power: 4 },
    gain: { ore: 1, credits: 1 },
    faction: 'nevlas',
    requiresPI: true,
  },
  'nevlas-pw2-2c': {
    id: 'nevlas-pw2-2c',
    cost: { power: 2 },
    gain: { credits: 2 },
    faction: 'nevlas',
    requiresPI: true,
  },
  'nevlas-pw6-2o': {
    id: 'nevlas-pw6-2o',
    cost: { power: 6 },
    gain: { ore: 2 },
    faction: 'nevlas',
    requiresPI: true,
  },
  'hadsch-c4-q': {
    id: 'hadsch-c4-q',
    cost: { credits: 4 },
    gain: { qic: 1 },
    faction: 'hadsch-hallas',
    requiresPI: true,
  },
  'hadsch-c3-o': {
    id: 'hadsch-c3-o',
    cost: { credits: 3 },
    gain: { ore: 1 },
    faction: 'hadsch-hallas',
    requiresPI: true,
  },
  'hadsch-c4-k': {
    id: 'hadsch-c4-k',
    cost: { credits: 4 },
    gain: { knowledge: 1 },
    faction: 'hadsch-hallas',
    requiresPI: true,
  },
  'baltaks-gf-q': {
    id: 'baltaks-gf-q',
    cost: { gaiaformer: 1 },
    gain: { qic: 1 },
    faction: 'baltaks',
  },
  // LF Xenos 新免费行动（仅 Lost Fleet）。
  'xenos-o-t3': {
    id: 'xenos-o-t3',
    cost: { ore: 1 },
    gain: { powerToken: 1 },
    powerTokenToBowl3: true,
    faction: 'xenos',
    lostFleet: true,
  },
  'terrans-gaia-q': {
    id: 'terrans-gaia-q',
    cost: { gaiaPower: 4 },
    gain: { qic: 1 },
    faction: 'terrans',
    requiresPI: true,
    gaiaPhaseOnly: true,
  },
  'terrans-gaia-o': {
    id: 'terrans-gaia-o',
    cost: { gaiaPower: 3 },
    gain: { ore: 1 },
    faction: 'terrans',
    requiresPI: true,
    gaiaPhaseOnly: true,
  },
  'terrans-gaia-k': {
    id: 'terrans-gaia-k',
    cost: { gaiaPower: 4 },
    gain: { knowledge: 1 },
    faction: 'terrans',
    requiresPI: true,
    gaiaPhaseOnly: true,
  },
  'terrans-gaia-c': {
    id: 'terrans-gaia-c',
    cost: { gaiaPower: 1 },
    gain: { credits: 1 },
    faction: 'terrans',
    requiresPI: true,
    gaiaPhaseOnly: true,
  },
};

// ---------------------------------------------------------------------------
// Lost Fleet 飞船行动格（有穿梭机在该船即解锁；每格每轮全场 1 次）
// ---------------------------------------------------------------------------

export type ShipActionEffect =
  | { kind: 'rescore-federation-full' } // 重结算联邦标记（含其它即时效果）
  | { kind: 'vp-per-planet-type'; base: number; perType: number }
  | { kind: 'gain-tech-tile'; fromShip: boolean } // 可拿船上标准板
  | { kind: 'vp-per-standard-tech-tile'; base: number; perTile: number }
  | { kind: 'free-upgrade'; from: 'mine' | 'ts'; to: 'ts' | 'lab' }
  | { kind: 'research' } // 推进 1 级研究（升 L5 规则照常）
  | { kind: 'gaia-project-immediate' } // 立即盖亚计划（免移 power、立即转化、本轮可建矿复用 gaiaformer）
  | { kind: 'range'; amount: number } // 本次行动射程 +N（也可用于探索飞船）
  | { kind: 'gain'; gain: ResourceGain }
  | { kind: 'build-mine'; freeTerraformSteps: number }
  | { kind: 'build-mine-asteroid' }; // 射程内小行星免费建矿（无需 gaiaformer）

export interface ShipActionDef {
  id: ShipActionId;
  cost: { power?: number; qic?: number; ore?: number; credits?: number; knowledge?: number };
  effect: ShipActionEffect;
}

export const SHIP_ACTIONS: Record<ShipActionId, ShipActionDef> = {
  // --- Twilight（0 科技槽，改放 Artifacts）---
  'ship-rescore-fed': { id: 'ship-rescore-fed', cost: { qic: 3 }, effect: { kind: 'rescore-federation-full' } },
  'ship-upgrade-ts-lab': {
    id: 'ship-upgrade-ts-lab',
    cost: { power: 3, ore: 2 },
    effect: { kind: 'free-upgrade', from: 'ts', to: 'lab' },
  },
  'ship-range3': { id: 'ship-range3', cost: { knowledge: 1 }, effect: { kind: 'range', amount: 3 } },
  // --- Rebellion（1 科技槽）---
  'ship-tech-tile': {
    id: 'ship-tech-tile',
    cost: { qic: 3 },
    effect: { kind: 'gain-tech-tile', fromShip: true },
  },
  'ship-upgrade-mine-ts': {
    id: 'ship-upgrade-mine-ts',
    cost: { power: 3, ore: 1 },
    effect: { kind: 'free-upgrade', from: 'mine', to: 'ts' },
  },
  'ship-2c1q': {
    id: 'ship-2c1q',
    cost: { knowledge: 2 },
    effect: { kind: 'gain', gain: { credits: 2, qic: 1 } },
  },
  // --- T F Mars（1 科技槽）---
  'ship-vp-per-tech': {
    id: 'ship-vp-per-tech',
    cost: { qic: 2 },
    effect: { kind: 'vp-per-standard-tech-tile', base: 2, perTile: 1 },
  },
  'ship-instant-gaia': {
    id: 'ship-instant-gaia',
    cost: { power: 2 },
    effect: { kind: 'gaia-project-immediate' },
  },
  'ship-terraform-step': {
    id: 'ship-terraform-step',
    cost: { credits: 3 },
    effect: { kind: 'build-mine', freeTerraformSteps: 1 },
  },
  // --- Eclipse（1 科技槽）---
  'ship-vp-per-planet': {
    id: 'ship-vp-per-planet',
    cost: { qic: 2 },
    effect: { kind: 'vp-per-planet-type', base: 2, perType: 1 },
  },
  'ship-research': {
    id: 'ship-research',
    cost: { power: 3, knowledge: 2 },
    effect: { kind: 'research' },
  },
  'ship-asteroid-mine': { id: 'ship-asteroid-mine', cost: { credits: 6 }, effect: { kind: 'build-mine-asteroid' } },
};

/** 探索飞船费用（vp）；族属调整见下。 */
export const EXPLORE_SHIP_COST_VP = 5;

/** Bal T'aks 探索飞船费用（vp）。 */
export const EXPLORE_SHIP_COST_VP_BALTAKS = 7;

/** 检查神器费用：任意区组合弃 6 power。 */
export const INSPECT_ARTIFACT_COST_POWER = 6;

// 探索飞船的族属额外费用（rules-summary §2.5）：
// - Taklons：额外把 Brainstone 移入 Gaia 区；
// - Nevlas / Itars：额外弃 1 power；
// - Bal T'aks：费用改为 7vp（见 EXPLORE_SHIP_COST_VP_BALTAKS）。
