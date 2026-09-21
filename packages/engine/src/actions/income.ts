/**
 * 收入充能顺序响应（pending income-order）。
 *
 * 触发条件（turn.ts settleIncome）：本轮收入同时含 power token 与充能，且
 * 加完 token 也无法全部推至 III 区（转满）——此时结算顺序影响最终分布，
 * 规则上收入各分项顺序由玩家自定，故交给玩家选择：
 * - tokens-first：先 +N token 入 I 区，再充能 M（贪心 II→III 连跳，III 最大化）；
 * - charge-first：先充能 M，再 +N token 入 I 区（新 token 不参与本轮充能）。
 */
import { IllegalActionError } from '../errors.js';
import type { Action, GameState, PlayerIndex } from '../types.js';
import { chargePower, gainPowerTokens, player } from '../state.js';
import { activateNextIncomePending } from '../turn.js';

/** 枚举 income-order 响应：两种顺序恒合法（tokens-first 在前——通常更优，AI 默认取它）。 */
export function enumerateIncomeOrder(state: GameState, idx: PlayerIndex): Action[] {
  const pending = state.pending;
  if (pending?.kind !== 'income-order' || pending.player !== idx) {
    return [];
  }
  return [
    { type: 'income-order', order: 'tokens-first' },
    { type: 'income-order', order: 'charge-first' },
  ];
}

/** 应用收入顺序选择：结算 token 与充能后串联下一个收入待决（空则进入盖亚阶段）。 */
export function applyIncomeOrder(state: GameState, order: 'tokens-first' | 'charge-first'): void {
  const pending = state.pending;
  if (pending?.kind !== 'income-order') {
    throw new IllegalActionError('no-such-pending', `当前无收入顺序待决: ${state.pending?.kind ?? 'null'}`);
  }
  const p = player(state, pending.player);
  if (order === 'tokens-first') {
    gainPowerTokens(p, pending.tokens);
    chargePower(p, pending.charge);
  } else {
    chargePower(p, pending.charge);
    gainPowerTokens(p, pending.tokens);
  }
  activateNextIncomePending(state);
}
