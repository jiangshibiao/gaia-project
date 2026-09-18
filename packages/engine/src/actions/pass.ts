/**
 * pass 主行动：还当前 booster 回供应、拿 payload.booster（第 6 轮必须 null）；
 * 首个 pass 者设为 firstPlayer；pass 时结算 booster passVp（按玩家场上建筑数）。
 */
import { IllegalActionError } from '../errors.js';
import type { Action, BoosterId, GameState, PlayerIndex } from '../types.js';
import { BOOSTERS } from '../data/boosters.js';
import { addVp, player } from '../state.js';
import { onPass } from '../triggers.js';
import { countUnits } from '../score.js';

/** 枚举 pass 行动（第 6 轮只有 null；其余轮每块可用助推器一个）。 */
export function enumeratePass(state: GameState, _idx: PlayerIndex): Action[] {
  if (state.round >= 6) {
    return [{ type: 'pass', booster: null }];
  }
  return state.board.boosters.map((b) => ({ type: 'pass', booster: b }));
}

/** 应用 pass（原地修改）。 */
export function applyPass(state: GameState, idx: PlayerIndex, booster: BoosterId | null): void {
  const p = player(state, idx);
  const old = p.booster;

  // pass VP 结算（还回旧 booster 前按场上建筑数计）。
  if (old !== null) {
    const def = BOOSTERS[old];
    if (def.passVp !== undefined) {
      addVp(p, countUnits(state, idx, def.passVp.per) * def.passVp.vp);
    }
  }
  // 高级科技板 pass 触发（注册点；本轮高级板不可获得）。
  onPass(state, idx);

  // 拿新 booster（先拿后还：不能续用同款——旧 booster 此时不在供应中）。
  if (booster !== null) {
    const i = state.board.boosters.indexOf(booster);
    if (i < 0) {
      throw new IllegalActionError('booster-unavailable', `助推器不可选: ${booster}`);
    }
    state.board.boosters.splice(i, 1);
  }
  if (old !== null) {
    state.board.boosters.push(old);
  }
  p.booster = booster;

  // 首个 pass 者拿下轮先手。
  if (state.passedPlayers.length === 0) {
    state.firstPlayer = idx;
  }
  state.passedPlayers.push(idx);
}
