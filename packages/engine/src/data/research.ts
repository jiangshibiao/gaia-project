/**
 * 6 条研究轨 × 5 级效果表。
 * 数据核对：reference/gaia-engine/src/research-tracks.ts + 官方规则书 Appendix II。
 * 仅当前所在级生效（不累计）；星标奖励为一次性。
 *
 * 通用规则（不重复写进每级数据）：
 * - 升到任意轨 L3 时立即充能 3 power（见 LEVEL3_CHARGE_POWER，已并入各级 once）。
 * - 升 L5 必须翻 1 枚己方联邦标记到灰面；每轨全游戏仅 1 人可达 L5。
 * - Terraforming L5：获得开局预设在该轨的联邦标记（算组建一次联邦）。
 * - Navigation L5：在可达空格放置 Lost Planet（算建矿、独立星球类型、
 *   不可升级、放 1 个卫星标记）。
 * - 设置时种族起始 L1：星标一次性奖励立即获得；Economy/Science L1 是收入，
 *   设置时不获得。
 */
import type { ResearchTrack } from '../types.js';
import type { ResourceGain } from './rewards.js';

/** 升到 L3 的通用充能（已并入各级 once.chargePower）。 */
export const LEVEL3_CHARGE_POWER = 3;

/** L0 默认 terraform 每步 ore 费用。 */
export const BASE_TERRAFORM_COST_PER_STEP = 3;

/** L0 默认基础射程。 */
export const BASE_RANGE = 1;

export interface ResearchLevelEffect {
  /** 到达该级的一次性奖励。 */
  once?: ResourceGain;
  /** 每轮收入（仅 Economy/Science 轨）。 */
  income?: ResourceGain;
  /** terraform 每步 ore 费用（Terraforming 轨）。 */
  terraformCostPerStep?: number;
  /** 基础射程（Navigation 轨）。 */
  range?: number;
  /** 启动盖亚计划需移入 Gaia 区的 power 数（Gaia Project 轨）。 */
  gaiaProjectCost?: number;
  /** Terraforming L5：获得预设联邦标记（算组建联邦）。 */
  grantsPresetFederationToken?: boolean;
  /** Navigation L5：放置 Lost Planet。 */
  placesLostPlanet?: boolean;
  /** Gaia 轨 L5 一次性奖励：每颗有己方建筑的 Gaia 星球额外 +N vp。 */
  vpPerGaiaPlanet?: number;
}

export interface ResearchTrackDef {
  id: ResearchTrack;
  name: string;
  /** L1–L5（index 0 = L1）。 */
  levels: readonly [
    ResearchLevelEffect,
    ResearchLevelEffect,
    ResearchLevelEffect,
    ResearchLevelEffect,
    ResearchLevelEffect,
  ];
}

export const RESEARCH_TRACKS: Record<ResearchTrack, ResearchTrackDef> = {
  terra: {
    id: 'terra',
    name: '地形改造',
    levels: [
      { once: { ore: 2 } },
      { terraformCostPerStep: 2 },
      { terraformCostPerStep: 1, once: { chargePower: LEVEL3_CHARGE_POWER } },
      { once: { ore: 2 } },
      { terraformCostPerStep: 1, grantsPresetFederationToken: true },
    ],
  },
  nav: {
    id: 'nav',
    name: '导航',
    levels: [
      { once: { qic: 1 } },
      { range: 2 },
      { once: { qic: 1, chargePower: LEVEL3_CHARGE_POWER } },
      { range: 3 },
      { range: 4, placesLostPlanet: true },
    ],
  },
  int: {
    id: 'int',
    name: '人工智能',
    levels: [
      { once: { qic: 1 } },
      { once: { qic: 1 } },
      { once: { qic: 2, chargePower: LEVEL3_CHARGE_POWER } },
      { once: { qic: 2 } },
      { once: { qic: 4 } },
    ],
  },
  gaia: {
    id: 'gaia',
    name: '盖亚计划',
    levels: [
      { gaiaProjectCost: 6, once: { gaiaformer: 1 } },
      { gaiaProjectCost: 6, once: { powerToken: 3 } },
      { gaiaProjectCost: 4, once: { gaiaformer: 1, chargePower: LEVEL3_CHARGE_POWER } },
      { gaiaProjectCost: 3, once: { gaiaformer: 1 } },
      // L5 一次性：+4vp，且每颗有己方建筑的 Gaia 星球 +1vp。
      { gaiaProjectCost: 3, once: { vp: 4 }, vpPerGaiaPlanet: 1 },
    ],
  },
  eco: {
    id: 'eco',
    name: '经济',
    // LF：L3/L4 收入被"调整后的经济研究区板块"覆盖（1 块双面，setup 随机
    // 选面；覆盖面值见 data/lostfleet.ts ECONOMY_OVERLAY，turn.ts 收入结算使用）。
    levels: [
      { income: { credits: 2, chargePower: 1 } },
      { income: { credits: 2, ore: 1, chargePower: 2 } },
      { income: { credits: 3, ore: 1, chargePower: 3 }, once: { chargePower: LEVEL3_CHARGE_POWER } },
      { income: { credits: 4, ore: 2, chargePower: 4 } },
      { once: { credits: 6, ore: 3, chargePower: 6 } },
    ],
  },
  sci: {
    id: 'sci',
    name: '科学',
    levels: [
      { income: { knowledge: 1 } },
      { income: { knowledge: 2 } },
      { income: { knowledge: 3 }, once: { chargePower: LEVEL3_CHARGE_POWER } },
      { income: { knowledge: 4 } },
      { once: { knowledge: 9 } },
    ],
  },
};
