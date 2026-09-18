/**
 * 被动充能：邀约生成（建筑 power value、2 格范围、顺时针）与 charge/decline-charge 响应。
 */
import { IllegalActionError } from '../errors.js';
import type { ChargeOffer, GameState, HexState, PlayerIndex } from '../types.js';
import type { HexKey } from '../hex.js';
import { hexesWithin } from '../map.js';
import { BUILDING_POWER_VALUE } from '../data/prices.js';
import { chargePower, gainPowerTokens, player } from '../state.js';

/**
 * 建筑的 power value（被动充能邀约与联邦 pv 用）。
 * 基础值 + tech3（PI/学院变 4）+ bescods PI（钛星建筑 +1）+ Moweyds Power Ring（+2）。
 */
export function buildingPowerValue(state: GameState, idx: PlayerIndex, hex: HexState): number {
  const b = hex.building;
  if (b === undefined || b.player !== idx) {
    return 0;
  }
  let pv = BUILDING_POWER_VALUE[b.type];
  if (pv === 0) {
    return 0;
  }
  const p = state.players[idx]!;
  const covered = new Set(p.advTechTiles.map((a) => a.covers));
  if (pv === 3 && p.techTiles.includes('tech3') && !covered.has('tech3')) {
    pv = 4;
  }
  if (p.faction === 'bescods' && p.buildings.pi === 0 && hex.planet === 'titanium') {
    pv += 1;
  }
  if (hex.powerRing === true) {
    pv += 2;
  }
  return pv;
}

/** 从行动者开始的桌序（座位号）顺序（不含行动者；参考引擎 leech 用 playersInTableOrderFrom）。 */
function playersClockwiseFrom(state: GameState, actor: PlayerIndex): PlayerIndex[] {
  const n = state.players.length;
  const out: PlayerIndex[] = [];
  for (let i = 1; i < n; i++) {
    out.push((actor + i) % n);
  }
  return out;
}

/**
 * 生成被动充能邀约：2 格范围内有建筑（含 Lantids 附加矿、Lost Planet 卫星，
 * pv 1）的其他玩家，按范围内其最高 pv 建筑生成邀约，从行动者按桌序排序。
 * 建矿/升级/盖亚建矿/Lost Planet 放置均经此生成。
 * 无 token 可充的玩家不生成邀约（参考引擎 canLeech：chargePower(1) 模拟；
 * taklons 已建 PI 例外——只为拿 PI 的 +1 token 也可接受邀约）。
 */
export function makeChargeOffers(
  state: GameState,
  actor: PlayerIndex,
  hexKey: HexKey,
): ChargeOffer[] {
  const offers: ChargeOffer[] = [];
  const near = hexesWithin(state.map, hexKey, 2);
  for (const j of playersClockwiseFrom(state, actor)) {
    let maxPv = 0;
    for (const h of near) {
      const hex = state.map[h]!;
      maxPv = Math.max(maxPv, buildingPowerValue(state, j, hex));
      if (hex.additionalMine === j) {
        maxPv = Math.max(maxPv, 1);
      }
      if (hex.planet === 'lost' && hex.satelliteOf === j) {
        maxPv = Math.max(maxPv, 1);
      }
    }
    if (maxPv === 0) {
      continue;
    }
    const p = state.players[j]!;
    const chargeable =
      p.power.bowl1 + p.power.bowl2 + (p.power.brainstone === 'bowl1' || p.power.brainstone === 'bowl2' ? 1 : 0);
    const taklonsPi = p.faction === 'taklons' && p.buildings.pi === 0;
    if (chargeable === 0 && !taklonsPi) {
      continue;
    }
    offers.push({ player: j, amount: maxPv, vpCost: maxPv - 1 });
  }
  return offers;
}

/**
 * charge / decline-charge 响应（原地修改）。
 * charge：接受 queue[0] 邀约，付 vpCost（vp 不足时按可付的最大充——VP 不能为负），
 * chargePower 实际充入（碗容量不足部分作废），弹队列；空则 pending=null。
 * amount（harness 对拍覆盖）：部分接受量，缺省=邀约全量；vp 代价 = amount-1。
 * 回合推进由 apply 层在 pending 清空后统一处理。
 */
export function applyChargeResponse(state: GameState, accept: boolean, amount?: number): void {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'charge') {
    throw new IllegalActionError('no-pending-charge', '当前没有待决的充能邀约');
  }
  const offer = pending.queue[0];
  if (offer === undefined) {
    throw new IllegalActionError('no-pending-charge', '充能邀约队列为空');
  }
  if (accept) {
    const p = player(state, offer.player);
    // VP 不能为负：vp 不足 vpCost 时按可付的最大量充（amount = vp+1 时 cost = vp）。
    const effective = Math.min(amount ?? offer.amount, p.vp + 1);
    // taklons PI：被动充能时 +1 power token。规则允许自选先充能或先拿 token，
    // 固定为"先拿 token 再充能"（token 入 I 区后可能随即被充走，与先拿一致的最常见选择）。
    if (effective > 0 && p.faction === 'taklons' && p.buildings.pi === 0) {
      gainPowerTokens(p, 1);
    }
    if (effective > 0) {
      p.vp -= effective - 1;
      chargePower(p, effective);
    }
  }
  pending.queue.shift();
  if (pending.queue.length === 0) {
    state.pending = null;
  }
}
