/**
 * 共享的结构化奖励/计数单位类型。
 * 替代 reference/gaia-engine 的 reward DSL 字符串（如 "o,q"、"+4c"、"mg >> 3vp"），
 * 各数据表统一用 plain JSON 表达。
 */

/** 结构化资源/点数奖励。缺省字段 = 无该项。 */
export interface ResourceGain {
  ore?: number;
  credits?: number;
  knowledge?: number;
  qic?: number;
  vp?: number;
  /** 充能：已有 power token 按 I→II→III 循环移动。 */
  chargePower?: number;
  /** 从供应堆获得新 power token 放入 I 区。 */
  powerToken?: number;
  /** 解锁 gaiaformer（Gaia 轨 L1/L3/L4）。 */
  gaiaformer?: number;
}

/** 计数型奖励的计数单位（"每 X 得 Y" 中的 X）。 */
export type CountUnit =
  | 'mine' // 己方矿数
  | 'ts' // 己方贸易站数
  | 'lab' // 己方实验室数
  | 'pi-academy' // 己方 PI + 学院数
  | 'gaia-planet' // 已殖民 Gaia 星球数
  | 'planet-type' // 已殖民星球类型数
  | 'sector' // 已殖民（普通）扇区数
  | 'deep-space-sector' // 已殖民深空扇区数
  | 'federation-token' // 持有联邦标记数
  | 'gaiaformer' // 拥有 gaiaformer 数（含已部署；报废于小行星的不计）
  | 'asteroid' // 已殖民小行星数
  | 'standard-tech-tile'; // 持有标准科技板数（含被高级板覆盖的）
