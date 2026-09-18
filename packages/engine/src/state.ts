/**
 * 状态查询/修改小助手。
 * 所有修改函数直接原地修改传入的 state/player——克隆在 apply.ts 做
 * （applyAction 先 structuredClone 再改），本模块不管不可变性。
 */
import { IllegalActionError } from './errors.js';
import type { GameState, PlayerIndex, PlayerState, PowerAreaAmounts, Resources } from './types.js';
import type { ResourceGain } from './data/rewards.js';

export const MAX_ORE = 15;
export const MAX_KNOWLEDGE = 15;
export const MAX_CREDITS = 30;

export function player(state: GameState, idx: PlayerIndex): PlayerState {
  const p = state.players[idx];
  if (p === undefined) {
    throw new IllegalActionError('no-such-player', `玩家不存在: ${idx}`);
  }
  return p;
}

export function currentPlayer(state: GameState): PlayerState {
  return player(state, state.currentPlayerIdx);
}

export function addVp(p: PlayerState, vp: number): void {
  p.vp += vp;
}

/**
 * 获得资源（含 15o/15k/30c 上限，超出作废；qic 无上限）。
 * Gleens 能力：建 QIC 学院（ac2）前，获得 QIC 改为获得等量 ore。
 */
export function gainResources(p: PlayerState, gain: Partial<Resources>): void {
  const r = p.resources;
  r.ore = Math.min(MAX_ORE, r.ore + (gain.ore ?? 0));
  r.credits = Math.min(MAX_CREDITS, r.credits + (gain.credits ?? 0));
  r.knowledge = Math.min(MAX_KNOWLEDGE, r.knowledge + (gain.knowledge ?? 0));
  let qic = gain.qic ?? 0;
  if (qic > 0 && p.faction === 'gleens' && p.buildings.ac2 > 0) {
    r.ore = Math.min(MAX_ORE, r.ore + qic);
    qic = 0;
  }
  r.qic += qic;
}

/** 支付资源；不足抛错（枚举层已保证可负担，此处为防御性校验）。 */
export function spendResources(p: PlayerState, cost: Partial<Resources>): void {
  const r = p.resources;
  if (
    (cost.ore ?? 0) > r.ore ||
    (cost.credits ?? 0) > r.credits ||
    (cost.knowledge ?? 0) > r.knowledge ||
    (cost.qic ?? 0) > r.qic
  ) {
    throw new IllegalActionError(
      'insufficient-resources',
      `资源不足: 需 ${JSON.stringify(cost)}，有 ${JSON.stringify(r)}`,
    );
  }
  r.ore -= cost.ore ?? 0;
  r.credits -= cost.credits ?? 0;
  r.knowledge -= cost.knowledge ?? 0;
  r.qic -= cost.qic ?? 0;
}

// ---------------------------------------------------------------------------
// Power
// ---------------------------------------------------------------------------

/** 全场 power token 总数（含 brainstone；用于 fuzz 守恒校验）。 */
export function totalPowerTokens(p: PlayerState): number {
  const pw = p.power;
  return pw.bowl1 + pw.bowl2 + pw.bowl3 + pw.gaia + (pw.brainstone !== 'none' ? 1 : 0);
}

/**
 * 可花费 power（III 区 token + taklons brainstone 在 III 区时当 3）。
 * nevlas PI：III 区 token 每个当 2 power 花（付奇数费用找零损失）。
 */
export function spendablePower(p: PlayerState): number {
  const nevlasPi = p.faction === 'nevlas' && p.buildings.pi === 0;
  return p.power.bowl3 * (nevlasPi ? 2 : 1) + (p.power.brainstone === 'bowl3' ? 3 : 0);
}

/**
 * 充能：I→II 优先；I 空则 II→III；都空则不能充（返回实际充入量）。
 * brainstone 约定：普通 token 先动，brainstone 最后动。
 */
export function chargePower(p: PlayerState, amount: number): number {
  const pw = p.power;
  let remaining = amount;
  let charged = 0;
  // I→II（普通 token）
  const m1 = Math.min(remaining, pw.bowl1);
  pw.bowl1 -= m1;
  pw.bowl2 += m1;
  remaining -= m1;
  charged += m1;
  // brainstone 在 I 区：普通 token 用完后才动
  if (remaining > 0 && pw.brainstone === 'bowl1') {
    pw.brainstone = 'bowl2';
    remaining -= 1;
    charged += 1;
  }
  // II→III（含刚从 I 区移入的 token）
  const m2 = Math.min(remaining, pw.bowl2);
  pw.bowl2 -= m2;
  pw.bowl3 += m2;
  remaining -= m2;
  charged += m2;
  // brainstone 在 II 区
  if (remaining > 0 && pw.brainstone === 'bowl2') {
    pw.brainstone = 'bowl3';
    remaining -= 1;
    charged += 1;
  }
  return charged;
}

/**
 * 花费 power：仅从 III→I。
 * taklons brainstone 在 III 区时可当 3 花（费用 ≥3 或 III 区普通 token 不足时
 * 使用，溢出作废）；nevlas PI 每个 III 区 token 当 2 花（奇数费用找零损失）；
 * 不足抛错。
 */
export function spendPower(p: PlayerState, amount: number): void {
  const pw = p.power;
  if (p.faction === 'nevlas' && p.buildings.pi === 0) {
    const tokens = Math.ceil(amount / 2);
    if (tokens > pw.bowl3) {
      throw new IllegalActionError('insufficient-power', `power 不足: 需 ${amount}，III 区 ${pw.bowl3}（nevlas 每个当 2）`);
    }
    pw.bowl3 -= tokens;
    pw.bowl1 += tokens;
    return;
  }
  let rest = amount;
  if (pw.brainstone === 'bowl3' && (rest >= 3 || pw.bowl3 < rest)) {
    pw.brainstone = 'bowl1';
    rest = Math.max(rest - 3, 0);
  }
  if (rest > pw.bowl3) {
    throw new IllegalActionError('insufficient-power', `power 不足: 需 ${amount}，III 区 ${pw.bowl3}`);
  }
  pw.bowl3 -= rest;
  pw.bowl1 += rest;
}

/**
 * 弃置 power token（建卫星用，每颗卫星弃 1 个 token，任意区）。
 * 规范化顺序：I→II→III，brainstone 最后（移回 I 区，不算弃置、不当 3）。
 * ivits 建卫星改付 1q，不走此函数。
 */
export function discardPowerTokens(p: PlayerState, n: number): void {
  const pw = p.power;
  let rest = n;
  for (const bowl of ['bowl1', 'bowl2', 'bowl3'] as const) {
    const m = Math.min(rest, pw[bowl]);
    pw[bowl] -= m;
    rest -= m;
    p.powerStats.discarded += m;
  }
  if (rest > 0 && pw.brainstone !== 'none') {
    pw.brainstone = 'bowl1';
    rest -= 1;
  }
  if (rest > 0) {
    throw new IllegalActionError('insufficient-power', `可弃 power token 不足: 需 ${n}`);
  }
}

/**
 * 把 amount 点 power 从任意区（I/II/III 混合）移入 Gaia 区（启动盖亚计划）。
 * 规范化顺序：III→II→I 普通 token 优先，taklons brainstone 当 3 最后使用
 * （溢出作废）。不足抛错。
 */
export function movePowerToGaia(p: PlayerState, amount: number): void {
  const pw = p.power;
  let rest = amount;
  for (const bowl of ['bowl3', 'bowl2', 'bowl1'] as const) {
    const m = Math.min(rest, pw[bowl]);
    pw[bowl] -= m;
    pw.gaia += m;
    rest -= m;
  }
  if (rest > 0 && pw.brainstone !== 'none') {
    pw.brainstone = 'gaia';
    rest = Math.max(rest - 3, 0);
  }
  if (rest > 0) {
    throw new IllegalActionError('insufficient-power', `可移入 Gaia 区的 power 不足: 需 ${amount}`);
  }
}

/** 盖亚阶段：Gaia 区 power 移到指定区（brainstone 跟随）。 */
export function moveGaiaPowerToBowl(p: PlayerState, bowl: 'bowl1' | 'bowl2'): void {
  const pw = p.power;
  pw[bowl] += pw.gaia;
  pw.gaia = 0;
  if (pw.brainstone === 'gaia') {
    pw.brainstone = bowl;
  }
}

/**
 * 按指定区域数量把 power 移入 Gaia 区（harness 对拍覆盖，替代 movePowerToGaia
 * 的规范化顺序）。只动普通 token（参考引擎的 using 子句不含 brainstone）。
 */
export function movePowerToGaiaFrom(p: PlayerState, from: PowerAreaAmounts): void {
  const pw = p.power;
  const take = (bowl: 'bowl1' | 'bowl2' | 'bowl3', n: number): void => {
    if (n > pw[bowl]) {
      throw new IllegalActionError('insufficient-power', `${bowl} 不足: 需 ${n}，有 ${pw[bowl]}`);
    }
    pw[bowl] -= n;
    pw.gaia += n;
  };
  take('bowl1', from.area1 ?? 0);
  take('bowl2', from.area2 ?? 0);
  take('bowl3', from.area3 ?? 0);
}

/**
 * 按指定区域数量弃置 power token（harness 对拍覆盖，替代 discardPowerTokens
 * 的规范化顺序；只动普通 token）。
 */
export function discardPowerTokensFrom(p: PlayerState, from: PowerAreaAmounts): void {
  const pw = p.power;
  const take = (bowl: 'bowl1' | 'bowl2' | 'bowl3', n: number): void => {
    if (n > pw[bowl]) {
      throw new IllegalActionError('insufficient-power', `${bowl} 不足: 需 ${n}，有 ${pw[bowl]}`);
    }
    pw[bowl] -= n;
    p.powerStats.discarded += n;
  };
  take('bowl1', from.area1 ?? 0);
  take('bowl2', from.area2 ?? 0);
  take('bowl3', from.area3 ?? 0);
}

/** 从供应堆获得 power token 入 I 区（计入 powerStats.gained）。 */
export function gainPowerTokens(p: PlayerState, n: number): void {
  p.power.bowl1 += n;
  p.powerStats.gained += n;
}

/** 直接放 power token 入 III 区（xenos-o-t3；计入 powerStats.gained）。 */
export function gainPowerTokensToBowl3(p: PlayerState, n: number): void {
  p.power.bowl3 += n;
  p.powerStats.gained += n;
}

/**
 * 烧脑（免费行动）：弃 II 区 1 个 token，II 区另 1 个→III。
 * brainstone 在 II 区时（参考引擎 burnPower）：弃 1 个普通 token，brainstone→III
 * （brainstone 不被 burn 弃置、优先于普通 token 移动）。itars：弃的 token 入 gaia 区（不算弃置）。
 */
export function burnPower(p: PlayerState): void {
  const pw = p.power;
  // 弃 1 个（itars 入 gaia 区，其余回供应堆）
  const discard = (): void => {
    if (p.faction === 'itars') {
      pw.gaia += 1;
    } else {
      p.powerStats.discarded += 1;
    }
  };
  if (pw.brainstone === 'bowl2' && pw.bowl2 >= 1) {
    // brainstone 优先：弃 1 普通 token，brainstone→III
    pw.bowl2 -= 1;
    pw.brainstone = 'bowl3';
    discard();
    return;
  }
  if (pw.bowl2 >= 2) {
    pw.bowl2 -= 2;
    pw.bowl3 += 1;
    discard();
    return;
  }
  throw new IllegalActionError('cannot-burn', `II 区 token 不足: ${pw.bowl2}（brainstone=${pw.brainstone}）`);
}

/**
 * 结算一份结构化奖励：资源（含上限/gleens）→ vp → power token → 充能 → gaiaformer。
 * 充能在 token 获得之后（收入自动充能按最大充入，顺序参照 reference income.ts
 * 的 auto-income：尽量减少浪费）。
 */
export function applyGain(state: GameState, idx: PlayerIndex, gain: ResourceGain): void {
  const p = player(state, idx);
  gainResources(p, gain);
  if (gain.vp !== undefined && gain.vp !== 0) {
    addVp(p, gain.vp);
  }
  if (gain.powerToken !== undefined && gain.powerToken > 0) {
    gainPowerTokens(p, gain.powerToken);
  }
  if (gain.chargePower !== undefined && gain.chargePower > 0) {
    chargePower(p, gain.chargePower);
  }
  if (gain.gaiaformer !== undefined && gain.gaiaformer > 0) {
    p.gaiaformers.total += gain.gaiaformer;
    p.gaiaformers.available += gain.gaiaformer;
  }
}
