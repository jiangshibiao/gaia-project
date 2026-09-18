/**
 * 科技板数据：标准 9 种（各 4 块）+ 高级 15 种 + Lost Fleet 新增。
 * 数据核对：reference/gaia-engine/src/tiles/techs.ts（基础）+
 * reference/lost-fleet-rules.txt Appendix V（LF）。
 *
 * 拿板通用规则：
 * - 升 lab/学院时拿 1 块标准板；拿板可升对应轨 1 级（轨正下方 6 块）或任意轨
 *   （底排 3 块），可选择不升。
 * - 高级板条件：对应轨 L4/L5 + 翻 1 枚联邦标记 + 覆盖自己一块标准板（被覆盖
 *   的标准板失效）；每局随机 6 块（LF 扩展条第 7 槽：2 人局需 ≥25vp，
 *   3–4 人局需已探索 3 艘不同飞船）。
 * - LF 新标准板不混入标准池：3 种各 1 块，开局随机放 Rebellion/T F Mars/
 *   Eclipse 各 1 槽（Twilight 0 槽改放 Artifacts；2 人局只放 2 块）；
 *   有穿梭机在该船后，升 lab/学院可改拿船上标准板，拿后升任意轨 1 级。
 */
import type { AdvTechTileId, SpecialActionId, TechTileId } from '../types.js';
import type { CountUnit, ResourceGain } from './rewards.js';

/** trigger 类效果的触发时机。 */
export type TechTrigger =
  | 'build-mine-gaia' // 每次在 Gaia 星球上建矿
  | 'build-mine' // 每次建矿
  | 'upgrade-ts' // 每次升级到贸易站
  | 'research' // 每次研究推进
  | 'terraform-step' // 每次 terraform 步（含免费步；advtechlf6）
  | 'qic-action'; // 每次执行 Q.I.C. 行动（LF 飞船 QIC 格；advtechlf5）

export interface TechEffect {
  kind: 'once' | 'income' | 'trigger' | 'pass' | 'special' | 'passive';
  /** 固定奖励（once/income/special/trigger）。 */
  gain?: ResourceGain;
  /** 计数奖励：每 per 单位得 perGain（once/pass）。 */
  per?: CountUnit;
  perGain?: ResourceGain;
  /** kind=trigger 的触发时机。 */
  on?: TechTrigger;
  /** kind=special 的特殊行动 id。 */
  action?: SpecialActionId;
  /** kind=passive 的具体效果标识。 */
  passive?:
    | 'pi-academy-pv4' // tech3：PI/学院 power value 变 4
    | 'range-plus-1'; // techlf2：基本射程 +1（被高级板覆盖时失效）
  /** 一次性免费建矿（techlf1）。 */
  freeMine?: {
    freeTerraformSteps: number;
    /** 可额外付 ore 买第 3 步、付 QIC 加程。 */
    mayBuyExtraStep: boolean;
  };
}

export interface TechTileDef {
  id: TechTileId;
  name: string;
  effect: TechEffect;
  /** 供应块数（标准 9 种 ×4；LF 船上板见注释）。 */
  count: number;
  lostFleet?: boolean;
}

export interface AdvTechTileDef {
  id: AdvTechTileId;
  name: string;
  effect: TechEffect;
  /** 供应块数（基础 15 种 ×1；LF 6 种 ×1）。 */
  count: number;
  lostFleet?: boolean;
}

/** 标准科技板 9 种（各 4 块）+ LF 飞船用 3 种（各 1 块）。 */
export const TECH_TILES: Record<TechTileId, TechTileDef> = {
  tech1: {
    id: 'tech1',
    name: '矿石与 QIC',
    effect: { kind: 'once', gain: { ore: 1, qic: 1 } },
    count: 4,
  },
  tech2: {
    id: 'tech2',
    name: '星球类型知识',
    effect: { kind: 'once', per: 'planet-type', perGain: { knowledge: 1 } },
    count: 4,
  },
  tech3: {
    id: 'tech3',
    name: '高效研究所',
    effect: { kind: 'passive', passive: 'pi-academy-pv4' },
    count: 4,
  },
  tech4: {
    id: 'tech4',
    name: '7 胜利点',
    effect: { kind: 'once', gain: { vp: 7 } },
    count: 4,
  },
  tech5: {
    id: 'tech5',
    name: '矿石与充能收入',
    effect: { kind: 'income', gain: { ore: 1, chargePower: 1 } },
    count: 4,
  },
  tech6: {
    id: 'tech6',
    name: '知识与信用收入',
    effect: { kind: 'income', gain: { knowledge: 1, credits: 1 } },
    count: 4,
  },
  tech7: {
    id: 'tech7',
    name: '盖亚殖民得分',
    effect: { kind: 'trigger', on: 'build-mine-gaia', gain: { vp: 3 } },
    count: 4,
  },
  tech8: {
    id: 'tech8',
    name: '信用收入',
    effect: { kind: 'income', gain: { credits: 4 } },
    count: 4,
  },
  tech9: {
    id: 'tech9',
    name: '充能行动',
    effect: { kind: 'special', action: 'tech9', gain: { chargePower: 4 } },
    count: 4,
  },
  // --- Lost Fleet 飞船用标准板（不混入标准池；3 种各 1 块，随机放
  // Rebellion/T F Mars/Eclipse 各 1 槽，Twilight 0 槽改放 Artifacts；2 人局只放 2 块）---
  techlf1: {
    id: 'techlf1',
    name: '免费建矿（2 免费步）',
    effect: {
      kind: 'once',
      freeMine: { freeTerraformSteps: 2, mayBuyExtraStep: true },
    },
    count: 1,
    lostFleet: true,
  },
  techlf2: {
    id: 'techlf2',
    name: '基本射程 +1',
    effect: { kind: 'passive', passive: 'range-plus-1' },
    count: 1,
    lostFleet: true,
  },
  techlf3: {
    id: 'techlf3',
    name: '矿石与知识',
    effect: { kind: 'once', gain: { ore: 1, knowledge: 3 } },
    count: 1,
    lostFleet: true,
  },
};

/** 高级科技板 15 种 + LF 3 种。 */
export const ADV_TECH_TILES: Record<AdvTechTileId, AdvTechTileDef> = {
  advtech1: {
    id: 'advtech1',
    name: '联邦标记 Pass 得分',
    effect: { kind: 'pass', per: 'federation-token', perGain: { vp: 3 } },
    count: 1,
  },
  advtech2: {
    id: 'advtech2',
    name: '研究得分',
    effect: { kind: 'trigger', on: 'research', gain: { vp: 2 } },
    count: 1,
  },
  advtech3: {
    id: 'advtech3',
    name: 'QIC 与信用行动',
    effect: { kind: 'special', action: 'advtech3', gain: { qic: 1, credits: 5 } },
    count: 1,
  },
  advtech4: {
    id: 'advtech4',
    name: '每矿 2 分',
    effect: { kind: 'once', per: 'mine', perGain: { vp: 2 } },
    count: 1,
  },
  advtech5: {
    id: 'advtech5',
    name: '实验室 Pass 得分',
    effect: { kind: 'pass', per: 'lab', perGain: { vp: 3 } },
    count: 1,
  },
  advtech6: {
    id: 'advtech6',
    name: '每扇区 1 矿石',
    effect: { kind: 'once', per: 'sector', perGain: { ore: 1 } },
    count: 1,
  },
  advtech7: {
    id: 'advtech7',
    name: '星球类型 Pass 得分',
    effect: { kind: 'pass', per: 'planet-type', perGain: { vp: 1 } },
    count: 1,
  },
  advtech8: {
    id: 'advtech8',
    name: '每 Gaia 星球 2 分',
    effect: { kind: 'once', per: 'gaia-planet', perGain: { vp: 2 } },
    count: 1,
  },
  advtech9: {
    id: 'advtech9',
    name: '每贸易站 4 分',
    effect: { kind: 'once', per: 'ts', perGain: { vp: 4 } },
    count: 1,
  },
  advtech10: {
    id: 'advtech10',
    name: '每扇区 2 分',
    effect: { kind: 'once', per: 'sector', perGain: { vp: 2 } },
    count: 1,
  },
  advtech11: {
    id: 'advtech11',
    name: '矿石行动',
    effect: { kind: 'special', action: 'advtech11', gain: { ore: 3 } },
    count: 1,
  },
  advtech12: {
    id: 'advtech12',
    name: '每联邦标记 5 分',
    effect: { kind: 'once', per: 'federation-token', perGain: { vp: 5 } },
    count: 1,
  },
  advtech13: {
    id: 'advtech13',
    name: '知识行动',
    effect: { kind: 'special', action: 'advtech13', gain: { knowledge: 3 } },
    count: 1,
  },
  advtech14: {
    id: 'advtech14',
    name: '建矿得分',
    effect: { kind: 'trigger', on: 'build-mine', gain: { vp: 3 } },
    count: 1,
  },
  advtech15: {
    id: 'advtech15',
    name: '升贸易站得分',
    effect: { kind: 'trigger', on: 'upgrade-ts', gain: { vp: 3 } },
    count: 1,
  },
  // --- Lost Fleet（6 种各 1，实证核定）---
  advtechlf1: {
    id: 'advtechlf1',
    name: '每 PI/学院 6 分',
    effect: { kind: 'once', per: 'pi-academy', perGain: { vp: 6 } },
    count: 1,
    lostFleet: true,
  },
  advtechlf2: {
    id: 'advtechlf2',
    name: '每深空扇区 4 分',
    effect: { kind: 'once', per: 'deep-space-sector', perGain: { vp: 4 } },
    count: 1,
    lostFleet: true,
  },
  advtechlf3: {
    id: 'advtechlf3',
    name: '小行星 Pass 得分',
    effect: { kind: 'pass', per: 'asteroid', perGain: { vp: 2 } },
    count: 1,
    lostFleet: true,
  },
  advtechlf4: {
    id: 'advtechlf4',
    name: '深空扇区 Pass 得分',
    effect: { kind: 'pass', per: 'deep-space-sector', perGain: { vp: 2 } },
    count: 1,
    lostFleet: true,
  },
  advtechlf5: {
    id: 'advtechlf5',
    name: 'Q.I.C. 行动得分',
    effect: { kind: 'trigger', on: 'qic-action', gain: { vp: 4 } },
    count: 1,
    lostFleet: true,
  },
  advtechlf6: {
    id: 'advtechlf6',
    name: 'Terraform 步得分',
    effect: { kind: 'trigger', on: 'terraform-step', gain: { vp: 2 } },
    count: 1,
    lostFleet: true,
  },
};
