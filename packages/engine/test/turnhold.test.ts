/**
 * 回合完成闸（turnHold）：非 pass 主行动（含其 pending 响应完毕）后置闸——
 * 持闸玩家仍可免费行动/烧脑/confirm-turn；确认前下一玩家不得行动（枚举为空）；
 * 旧日志/失同步时非持闸玩家行动自动放闸。pass 不设闸。
 */
import { describe, expect, it } from 'vitest';
import { applyAction, enumerateActions } from '../src/index.js';
import type { GameConfig, GameState } from '../src/index.js';
import { actionPhase, endTurn, legalOf } from './helpers.js';

const CFG: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'nevlas'], lostFleet: true };

function passActionOf(state: GameState) {
  return enumerateActions(state, state.currentPlayerIdx).find((a) => a.type === 'pass')!;
}

describe('回合完成闸（turnHold）', () => {
  it('主行动后置闸：对方枚举为空，持闸者有免费行动+confirm-turn，确认后放行；pass 不设闸', () => {
    const s0 = actionPhase(CFG);
    const first = s0.currentPlayerIdx;
    const second = 1 - first;
    // 非 pass 主行动（研究推进）→ 置闸
    const research = legalOf(s0).find((a) => a.type === 'research')!;
    let s = applyAction(s0, research);
    expect(s.turnHold).toBe(first);
    expect(s.currentPlayerIdx).toBe(second); // 已推进，但对方按钮不亮
    expect(enumerateActions(s, second)).toEqual([]);
    const holdLegal = enumerateActions(s, first);
    expect(holdLegal.some((a) => a.type === 'confirm-turn')).toBe(true);
    expect(holdLegal.every((a) => a.type === 'confirm-turn' || a.type === 'free-conversion' || a.type === 'burn')).toBe(true);
    // 确认 → 放闸，对方可行动
    s = endTurn(s);
    expect(s.turnHold).toBeNull();
    expect(enumerateActions(s, second).length).toBeGreaterThan(0);
    // pass 不设闸
    s = applyAction(s, passActionOf(s));
    expect(s.turnHold).toBeNull();
    expect(s.currentPlayerIdx).toBe(first);
  });

  it('闸内免费行动合法（兑换不推进、确认后资源已结算）', () => {
    let s = actionPhase(CFG);
    const me = s.currentPlayerIdx;
    const other = 1 - me;
    s = structuredClone(s);
    s.players[me]!.power.bowl3 = 4;
    const research = legalOf(s).find((a) => a.type === 'research')!;
    s = applyAction(s, research);
    expect(s.turnHold).toBe(me);
    const conv = enumerateActions(s, me).find((a) => a.type === 'free-conversion' && a.conversion === 'pw1-c')!;
    const cBefore = s.players[me]!.resources.credits;
    s = applyAction(s, conv);
    expect(s.turnHold).toBe(me); // 免费行动不放闸
    expect(s.players[me]!.resources.credits).toBe(cBefore + 1);
    s = endTurn(s);
    expect(enumerateActions(s, other).length).toBeGreaterThan(0);
  });

  it('旧日志重放兼容：闸内到来对方行动自动放闸（assumeLegal）', () => {
    let s = actionPhase(CFG);
    const me = s.currentPlayerIdx;
    const other = 1 - me;
    const research = legalOf(s).find((a) => a.type === 'research')!;
    s = applyAction(s, research);
    expect(s.turnHold).toBe(me);
    // 旧日志中紧随其后的对方主行动（无 confirm-turn 记录）→ 自动放闸后生效
    const next = applyAction(s, { type: 'pass', booster: s.board.boosters[0]! }, { assumeLegal: true });
    expect(next.turnHold).toBeNull();
    expect(next.passedPlayers).toContain(other);
  });
});
