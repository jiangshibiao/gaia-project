/**
 * 收入充能顺序决策（pending income-order）：
 * 触发 = 收入同时含 token 与充能、充能 > II 区 token（顺序有实际影响）且无法转满；
 * 顺序无意义（≤ II 区）或加完 token 可转满时自动结算；
 * 旧日志/失同步场景下遗留待决由后续非 income-order 行动自动冲刷（tokens-first）。
 */
import { describe, expect, it } from 'vitest';
import { applyAction, enumerateActions } from '../src/index.js';
import type { GameConfig, GameState } from '../src/index.js';
import { actionPhase, flushIncome } from './helpers.js';

const CFG: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'nevlas'], lostFleet: true };

function passActionOf(state: GameState) {
  return enumerateActions(state, state.currentPlayerIdx).find((a) => a.type === 'pass')!;
}

/** 全员 pass 进入下一轮；terrans PI 收入 = 1 token + 充能 4（豆量由 mutate 指定）。 */
function rigIncome(mutate: (s: GameState) => void): GameState {
  const s = structuredClone(actionPhase(CFG));
  s.players[0]!.buildings.pi = 0;
  s.players[0]!.power.gaia = 0; // 不触发 terrans-gaia pending
  mutate(s);
  const s1 = applyAction(s, passActionOf(s));
  return applyAction(s1, passActionOf(s1));
}

function bowls(s: GameState): [number, number, number] {
  const pw = s.players[0]!.power;
  return [pw.bowl1, pw.bowl2, pw.bowl3];
}

describe('收入充能顺序（income-order）', () => {
  it('充能>II 区且无法转满 → 待决；两种顺序分布不同', () => {
    const s = rigIncome((x) => {
      x.players[0]!.power.bowl1 = 1;
      x.players[0]!.power.bowl2 = 1;
      x.players[0]!.power.bowl3 = 0;
    });
    expect(s.pending).toEqual({ kind: 'income-order', player: 0, tokens: 1, charge: 4 });
    // tokens-first：I=2 II=1 充 4（I→II 优先）→ I 全 2 个到 II，再 II→III 2 个
    const tf = flushIncome(applyAction(s, { type: 'income-order', order: 'tokens-first' }));
    expect(bowls(tf)).toEqual([0, 1, 2]);
    expect(tf.pending).toBeNull();
    // charge-first：I→II 1、II→III 2（1 点浪费），token 后落 I 区
    const cf = flushIncome(applyAction(s, { type: 'income-order', order: 'charge-first' }));
    expect(bowls(cf)).toEqual([1, 0, 2]);
  });

  it('充能 ≤ II 区（顺序结果一致）→ 自动结算不待决', () => {
    const s = rigIncome((x) => {
      x.players[0]!.power.bowl1 = 4;
      x.players[0]!.power.bowl2 = 4;
      x.players[0]!.power.bowl3 = 0;
    });
    expect(s.pending?.kind).not.toBe('income-order');
    expect(s.players[0]!.power.bowl1).toBe(1); // I=5 充 4 → 余 1
    expect(s.players[0]!.power.bowl2).toBe(8); // I→II 4 个
    expect(s.players[0]!.power.bowl3).toBe(0);
  });

  it('加完 token 能转满 → 自动全推 III 不待决', () => {
    const s = rigIncome((x) => {
      x.players[0]!.power.bowl1 = 1;
      x.players[0]!.power.bowl2 = 0;
      x.players[0]!.power.bowl3 = 0;
    });
    expect(s.pending?.kind).not.toBe('income-order');
    expect(s.players[0]!.power.bowl3).toBe(2); // 2 token 连跳共 4 步
  });

  it('遗留待决：非 income-order 行动到来时自动按 tokens-first 结清（旧日志重放兼容）', () => {
    const s = rigIncome((x) => {
      x.players[0]!.power.bowl1 = 1;
      x.players[0]!.power.bowl2 = 1;
      x.players[0]!.power.bowl3 = 0;
    });
    expect(s.pending?.kind).toBe('income-order');
    // 旧日志里紧随其后的正常行动（重放走 assumeLegal）
    const next = applyAction(s, { type: 'pass', booster: s.board.boosters[0]! }, { assumeLegal: true });
    // 已按 tokens-first 结清：I0 II1 III2；pass 照常生效
    expect(next.players[0]!.power.bowl3).toBe(2);
    expect(next.pending?.kind).not.toBe('income-order');
    expect(next.passedPlayers).toContain(0);
  });
});
