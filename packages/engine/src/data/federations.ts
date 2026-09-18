/**
 * 联邦标记数据：基础 6 种 + Gleens 专属 + Lost Fleet 金框 8 种（各 1 枚）。
 * 数据核对：reference/gaia-engine/src/tiles/federations.ts（基础 6 种 + gleens）+
 * reference/gaia-project/engine/src/tiles/spaceship-federations.ts（LF 8 种）。
 *
 * 供应数量：
 * - 基础 19 枚 = 6 种 ×3 + Gleens 专属 ×1（基础规则书组件清单 "19 Federation Tokens"）。
 * - LF 8 枚 = 8 种 ×1（金框；开局每船随机 1 枚，2 人局 3 船共 3 枚，其余移出游戏）。
 * 开局随机 1 枚（非 Gleens）放到 Terraforming 轨 L5 预设位。
 */
import type { FederationTokenId } from '../types.js';
import type { ResourceGain } from './rewards.js';

export interface FederationTokenDef {
  id: FederationTokenId;
  vp: number;
  /** vp 之外的即时资源奖励。 */
  other?: ResourceGain;
  /** 是否有绿面（可翻灰用于高级科技/研究 L5）。fed1 双面皆灰不可翻。 */
  flippable: boolean;
  gleensOnly?: boolean;
  lostFleet?: boolean;
  /** 供应枚数。 */
  count: number;
  /** LF 标记的即时效果（替代/附加于资源奖励）。 */
  immediate?:
    | 'tech-tile' // fedlf2：立即拿 1 块科技板（规则同升级拿板）
    | 'free-mine-unlimited-range' // fedlf3：免费建矿（无限射程；terraform 步 ore 照付，Gaia 星球 QIC 照付）
    | 'free-mine-3-steps' // fedlf4：免费建矿（3 免费 terraform 步；可付 QIC 加程）
    | 'power-tokens-bowl3'; // fedlf8：2 个 power token 直接 III 区
}

export const FEDERATION_TOKENS: Record<FederationTokenId, FederationTokenDef> = {
  fed1: {
    id: 'fed1',
    vp: 12,
    flippable: false, // 双面皆灰
    count: 3,
  },
  fed2: {
    id: 'fed2',
    vp: 8,
    other: { qic: 1 },
    flippable: true,
    count: 3,
  },
  fed3: {
    id: 'fed3',
    vp: 8,
    other: { powerToken: 2 },
    flippable: true,
    count: 3,
  },
  fed4: {
    id: 'fed4',
    vp: 7,
    other: { ore: 2 },
    flippable: true,
    count: 3,
  },
  fed5: {
    id: 'fed5',
    vp: 7,
    other: { credits: 6 },
    flippable: true,
    count: 3,
  },
  fed6: {
    id: 'fed6',
    vp: 6,
    other: { knowledge: 2 },
    flippable: true,
    count: 3,
  },
  gleens: {
    id: 'gleens',
    vp: 0,
    other: { ore: 1, knowledge: 1, credits: 2 },
    flippable: true,
    gleensOnly: true,
    count: 1,
  },
  // --- Lost Fleet 金框标记 8 种各 1（开局每船随机 1 枚，组联邦时可改拿船上的）---
  fedlf1: {
    id: 'fedlf1',
    vp: 12,
    // 与基础 fed1 不同：有绿面，可翻灰用于高级科技/L5。
    flippable: true,
    lostFleet: true,
    count: 1,
  },
  fedlf2: {
    id: 'fedlf2',
    vp: 0,
    flippable: true,
    lostFleet: true,
    count: 1,
    immediate: 'tech-tile',
  },
  fedlf3: {
    id: 'fedlf3',
    vp: 0,
    flippable: true,
    lostFleet: true,
    count: 1,
    immediate: 'free-mine-unlimited-range',
  },
  fedlf4: {
    id: 'fedlf4',
    vp: 0,
    flippable: true,
    lostFleet: true,
    count: 1,
    immediate: 'free-mine-3-steps',
  },
  fedlf5: {
    id: 'fedlf5',
    vp: 8,
    other: { credits: 8 },
    flippable: true,
    lostFleet: true,
    count: 1,
  },
  fedlf6: {
    id: 'fedlf6',
    vp: 4,
    other: { knowledge: 4 },
    flippable: true,
    lostFleet: true,
    count: 1,
  },
  fedlf7: {
    id: 'fedlf7',
    vp: 4,
    other: { ore: 2, qic: 1 },
    flippable: true,
    lostFleet: true,
    count: 1,
  },
  fedlf8: {
    id: 'fedlf8',
    vp: 7,
    flippable: true,
    lostFleet: true,
    count: 1,
    immediate: 'power-tokens-bowl3',
  },
};
