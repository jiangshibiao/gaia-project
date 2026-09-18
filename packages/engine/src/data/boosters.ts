/**
 * 回合助推器数据：基础 10 块 + Lost Fleet 4 块。
 * 数据核对：reference/gaia-engine/src/tiles/boosters.ts（基础）+
 * reference/lost-fleet-rules.txt Appendix III（LF 效果）+
 * reference/lf-page14.png（LF 收入配对，文本层只有"1 ore, 3 credits, or 2 power"）。
 *
 * 通用规则：setup 时翻出 人数+3 块供选；Pass 时归还并另选 1 块（不续用同款）；
 * 第 6 轮不拿新助推器；passVp 在 Pass 归还时结算。
 */
import type { BoosterId, SpecialActionId } from '../types.js';
import type { CountUnit, ResourceGain } from './rewards.js';

export interface BoosterDef {
  id: BoosterId;
  name: string;
  /** 每轮收入。 */
  income: ResourceGain;
  /** 特殊行动格（每轮 1 次）。 */
  special?: SpecialActionId;
  /** Pass 归还时按计数得 vp。 */
  passVp?: { per: CountUnit; vp: number };
  lostFleet?: boolean;
}

export const BOOSTERS: Record<BoosterId, BoosterDef> = {
  booster1: {
    id: 'booster1',
    name: '矿石与知识收入',
    income: { ore: 1, knowledge: 1 },
  },
  booster2: {
    id: 'booster2',
    name: '矿石与 power token 收入',
    income: { ore: 1, powerToken: 2 },
  },
  booster3: {
    id: 'booster3',
    name: 'QIC 与信用收入',
    income: { qic: 1, credits: 2 },
  },
  booster4: {
    id: 'booster4',
    name: '信用收入 + 建矿（1 免费步）',
    income: { credits: 2 },
    special: 'booster4',
  },
  booster5: {
    id: 'booster5',
    name: '充能收入 + 建矿/盖亚计划射程 +3',
    income: { chargePower: 2 },
    special: 'booster5',
  },
  booster6: {
    id: 'booster6',
    name: '矿石收入 + Pass 每矿 1vp',
    income: { ore: 1 },
    passVp: { per: 'mine', vp: 1 },
  },
  booster7: {
    id: 'booster7',
    name: '矿石收入 + Pass 每贸易站 2vp',
    income: { ore: 1 },
    passVp: { per: 'ts', vp: 2 },
  },
  booster8: {
    id: 'booster8',
    name: '知识收入 + Pass 每实验室 3vp',
    income: { knowledge: 1 },
    passVp: { per: 'lab', vp: 3 },
  },
  booster9: {
    id: 'booster9',
    name: '充能收入 + Pass 每 PI/学院 4vp',
    income: { chargePower: 4 },
    passVp: { per: 'pi-academy', vp: 4 },
  },
  booster10: {
    id: 'booster10',
    name: '信用收入 + Pass 每 Gaia 星球 1vp',
    income: { credits: 4 },
    passVp: { per: 'gaia-planet', vp: 1 },
  },
  // --- Lost Fleet（收入配对来自规则书图片 lf-page14.png：①+1o ②+1o ③+3c ④+2pw）---
  boosterlf1: {
    id: 'boosterlf1',
    name: '矿石收入 + Pass 每 Gaiaformer 3vp',
    income: { ore: 1 },
    passVp: { per: 'gaiaformer', vp: 3 },
    lostFleet: true,
  },
  boosterlf2: {
    id: 'boosterlf2',
    name: '矿石收入 + Pass 每星球类型 1vp',
    income: { ore: 1 },
    passVp: { per: 'planet-type', vp: 1 },
    lostFleet: true,
  },
  boosterlf3: {
    id: 'boosterlf3',
    name: '信用收入 + Pass 每深空扇区 2vp',
    income: { credits: 3 },
    passVp: { per: 'deep-space-sector', vp: 2 },
    lostFleet: true,
  },
  boosterlf4: {
    id: 'boosterlf4',
    name: '充能收入 + 免费立即盖亚计划',
    income: { chargePower: 2 },
    special: 'boosterlf4',
    lostFleet: true,
  },
};
