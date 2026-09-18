/**
 * 免费行动：free-conversion（data/prices.ts FREE_CONVERSIONS 全表）+ burn。
 * 不消耗回合，只在行动阶段为当前玩家枚举（回合外玩家无免费行动需求）。
 */
import type { Action, FreeConversionId, GameState, PlayerIndex, PlayerState } from '../types.js';
import { IllegalActionError } from '../errors.js';
import { FREE_CONVERSIONS, type FreeConversionDef } from '../data/prices.js';
import type { ResourceGain } from '../data/rewards.js';
import {
  applyGain,
  burnPower,
  gainPowerTokensToBowl3,
  player,
  spendPower,
  spendResources,
  spendablePower,
} from '../state.js';

/** 玩家是否负担得起某条兑换。 */
function canAffordConversion(p: PlayerState, def: FreeConversionDef): boolean {
  const c = def.cost;
  if (c.power !== undefined && spendablePower(p) < c.power) {
    return false;
  }
  if (c.gaiaPower !== undefined && p.power.gaia < c.gaiaPower) {
    return false;
  }
  const r = p.resources;
  if ((c.ore ?? 0) > r.ore || (c.credits ?? 0) > r.credits || (c.knowledge ?? 0) > r.knowledge || (c.qic ?? 0) > r.qic) {
    return false;
  }
  if (c.gaiaformer !== undefined && p.gaiaformers.available < c.gaiaformer) {
    return false;
  }
  if (c.powerTokenFromBowl3 !== undefined && p.power.bowl3 < c.powerTokenFromBowl3) {
    return false;
  }
  return true;
}

/** 枚举当前玩家可用的免费行动（能负担的 conversion 全集 + burn）。 */
export function enumerateFreeActions(state: GameState, idx: PlayerIndex): Action[] {
  const p = state.players[idx]!;
  const out: Action[] = [];
  for (const def of Object.values(FREE_CONVERSIONS)) {
    if (def.faction !== null && def.faction !== p.faction) {
      continue;
    }
    // requiresPI 的兑换（hadsch/nevlas/terrans PI）：PI 未建不可用。
    if (def.requiresPI === true && p.buildings.pi > 0) {
      continue;
    }
    // LF 新增兑换（xenos-o-t3）：lostFleet=false 时不可用。
    if (def.lostFleet === true && !state.config.lostFleet) {
      continue;
    }
    // terrans PI 盖亚阶段兑换：只在 pending terrans-gaia 期间枚举（enumerate.ts）。
    if (def.gaiaPhaseOnly === true) {
      continue;
    }
    if (!canAffordConversion(p, def)) {
      continue;
    }
    out.push({ type: 'free-conversion', conversion: def.id });
  }
  const pw = p.power;
  if (pw.bowl2 + (pw.brainstone === 'bowl2' ? 1 : 0) >= 2) {
    out.push({ type: 'burn' });
  }
  return out;
}

/** 应用 free-conversion（原地修改）：支付 cost（pw 走 III 区）+ 获得 gain。
 * opts.times：重复次数（费用与获得同倍）；opts.brainstone：pw 支付先用 brainstone 当 3。 */
export function applyFreeConversion(
  state: GameState,
  idx: PlayerIndex,
  id: FreeConversionId,
  opts?: { times?: number | undefined; brainstone?: boolean | undefined },
): void {
  const p = player(state, idx);
  const def = FREE_CONVERSIONS[id];
  if (def.lostFleet === true && !state.config.lostFleet) {
    throw new IllegalActionError('conversion-unavailable', `LF 未启用，该兑换不可用: ${id}`);
  }
  const times = opts?.times ?? 1;
  const c = def.cost;
  if (c.power !== undefined) {
    const total = c.power * times;
    if (opts?.brainstone === true && p.power.brainstone === 'bowl3' && p.power.bowl3 < total) {
      // III 区普通 token 不足：先用 brainstone 当 3（溢出作废），余下走普通 token。
      p.power.brainstone = 'bowl1';
      spendPower(p, Math.max(total - 3, 0));
    } else {
      spendPower(p, total);
    }
  }
  if (c.gaiaPower !== undefined) {
    // terrans PI 盖亚阶段兑换：花掉的 gaia power 按 terrans 能力移入 II 区
    // （参考引擎 "tg->t"；不是弃置回供应堆）。
    const total = c.gaiaPower * times;
    if (p.power.gaia < total) {
      throw new IllegalActionError('insufficient-gaia-power', `Gaia 区 power 不足: 需 ${total}，有 ${p.power.gaia}`);
    }
    p.power.gaia -= total;
    if (p.faction === 'terrans') {
      p.power.bowl2 += total;
    } else {
      p.powerStats.discarded += total;
    }
  }
  const resCost: { ore?: number; credits?: number; knowledge?: number; qic?: number } = {};
  if (c.ore !== undefined) resCost.ore = c.ore * times;
  if (c.credits !== undefined) resCost.credits = c.credits * times;
  if (c.knowledge !== undefined) resCost.knowledge = c.knowledge * times;
  if (c.qic !== undefined) resCost.qic = c.qic * times;
  spendResources(p, resCost);
  if (c.gaiaformer !== undefined) {
    // baltaks-gf-q：gaiaformer 移入 Gaia 区，下轮盖亚阶段返回面板。
    p.gaiaformers.available -= c.gaiaformer * times;
    p.gaiaformers.inGaia += c.gaiaformer * times;
  }
  if (c.powerTokenFromBowl3 !== undefined) {
    // nevlas-pw-k：III 区 token 移入 Gaia 区（不算花费、不算弃置）。
    p.power.bowl3 -= c.powerTokenFromBowl3 * times;
    p.power.gaia += c.powerTokenFromBowl3 * times;
  }
  if (def.gain.powerToken !== undefined && def.powerTokenToBowl3 === true) {
    // xenos-o-t3：power token 直接放 III 区。
    gainPowerTokensToBowl3(p, def.gain.powerToken * times);
    const { powerToken: _pt, ...rest } = def.gain;
    const scaled: typeof rest = {};
    for (const [k, v] of Object.entries(rest)) {
      (scaled as Record<string, number>)[k] = (v as number) * times;
    }
    applyGain(state, idx, scaled);
  } else {
    const scaled: ResourceGain = {};
    for (const [k, v] of Object.entries(def.gain)) {
      (scaled as Record<string, number>)[k] = (v as number) * times;
    }
    applyGain(state, idx, scaled);
  }
}

/** 应用 burn（原地修改）。 */
export function applyBurn(state: GameState, idx: PlayerIndex): void {
  burnPower(player(state, idx));
}
