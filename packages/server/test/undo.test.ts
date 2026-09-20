/**
 * GameSession.undo：撤销座位最近的回合（截断重放）。
 * 验收：
 * - 撤销后状态 = newGame(config) + 截断日志重放（seq 回到回合起点）；
 * - 尾段含其他真人座位行动 → undo-unavailable 拒绝；AI 座位行动可一并回退；
 * - 无行动可撤 → nothing-to-undo；终局 → game-finished。
 */
import { describe, expect, it } from 'vitest';
import { newGame, stableStringify } from '@gaia/engine';
import type { FactionId, GameConfig, PlayerIndex } from '@gaia/engine';
import { actorOf } from '@gaia/protocol';
import { listActions, openDb, type Db } from '../src/db/repo.js';
import { GameSession, SessionError } from '../src/session.js';

const FACTION_POOL: FactionId[] = ['terrans', 'xenos', 'geodens', 'nevlas'];

function configFor(playerCount: 2 | 3 | 4, seed: number, lostFleet = true): GameConfig {
  return { playerCount, seed, factions: FACTION_POOL.slice(0, playerCount), lostFleet };
}

function seatsFor(playerCount: number, ai: readonly number[] = []) {
  return Array.from({ length: playerCount }, (_, i) => ({
    seat: i as PlayerIndex,
    nickname: `p${i}`,
    token: `tok-undo-${i}`,
    ...(ai.includes(i) ? { isAI: true } : {}),
  }));
}

/** 给当前应行动玩家提交第一个合法行动；返回行动者。 */
function actOnce(sess: GameSession): PlayerIndex {
  const actor = sess.actor;
  expect(actor).not.toBeNull();
  const snap = sess.snapshotFor(actor!);
  expect(snap.legalActions.length).toBeGreaterThan(0);
  sess.submitAction(actor!, snap.legalActions[0]!);
  return actor!;
}

function expectSessionError(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SessionError);
    expect((e as SessionError).code).toBe(code);
    return;
  }
  expect.unreachable(`应抛 SessionError(${code})`);
}

describe('GameSession.undo', () => {
  it('撤销到本回合起点：状态/落库/seq 同步还原，restore 与内存态一致', () => {
    const db: Db = openDb(':memory:');
    const config = configFor(2, 42);
    const sess = new GameSession(db, 'g-undo-1', config, seatsFor(2));

    // seat0 行动 → seat1 行动；seat1 撤销 → 回到 seat1 回合起点（seq=1）
    expect(sess.actor).toBe(0);
    actOnce(sess);
    expect(sess.actor).toBe(1);
    actOnce(sess);
    expect(sess.currentSeq).toBe(2);

    const r = sess.undo(1);
    expect(r.seq).toBe(1);
    expect(sess.currentSeq).toBe(1);
    expect(sess.actor).toBe(1);
    expect(listActions(db, 'g-undo-1').map((a) => a.seq)).toEqual([0]);

    // 落库重放与内存态逐字节一致
    const restored = GameSession.restore(db, 'g-undo-1');
    expect(restored).not.toBeNull();
    expect(stableStringify(restored!.state)).toBe(stableStringify(sess.state));

    // seat0 撤销（其回合起点是 seq 0，但尾段含 seat1 已撤销后的空尾？——seat0 行动仍在）
    // 当前 seat0 的行动在日志中，actor=seat1 已行动过一次（被撤）。seat0 undo：
    // 其最近回合起点 = seq 0，尾段 = seat0 自己的行动 → 允许
    const r2 = sess.undo(0);
    expect(r2.seq).toBe(0);
    expect(sess.currentSeq).toBe(0);
    expect(sess.actor).toBe(0);
    expect(listActions(db, 'g-undo-1')).toHaveLength(0);

    // 空日志再撤 → nothing-to-undo
    expectSessionError(() => sess.undo(0), 'nothing-to-undo');
  });

  it('尾段含其他真人座位行动 → undo-unavailable；AI 座位行动可一并回退', () => {
    const db: Db = openDb(':memory:');
    const config = configFor(2, 42);
    const sess = new GameSession(db, 'g-undo-2', config, seatsFor(2));
    actOnce(sess); // seat0
    actOnce(sess); // seat1（真人）
    // seat0 的回合起点之后有 seat1（真人）的行动 → 拒绝
    expectSessionError(() => sess.undo(0), 'undo-unavailable');

    const db2: Db = openDb(':memory:');
    const sess2 = new GameSession(db2, 'g-undo-3', config, seatsFor(2, [1]));
    actOnce(sess2); // seat0（真人）
    actOnce(sess2); // seat1（AI）
    const r = sess2.undo(0); // AI 行动一并回退
    expect(r.seq).toBe(0);
    expect(sess2.actor).toBe(0);
    expect(listActions(db2, 'g-undo-3')).toHaveLength(0);
  });

  it('终局不可撤销', () => {
    const db: Db = openDb(':memory:');
    const config = configFor(2, 7);
    const sess = new GameSession(db, 'g-undo-4', config, seatsFor(2));
    while (!sess.finished) actOnce(sess);
    expectSessionError(() => sess.undo(0), 'game-finished');
  });

  it('开局归一化：LF 新族在 seat 0 时会话创建即跳过空枚举队首（曾开局死锁）', () => {
    const db: Db = openDb(':memory:');
    const config: GameConfig = {
      playerCount: 4,
      seed: 303695223,
      factions: ['darkanians', 'terrans', 'taklons', 'xenos'],
      lostFleet: true,
    };
    const sess = new GameSession(db, 'g-undo-5', config, seatsFor(4));
    // darkanians(seat 0) 在 mines-1/2 无放置：会话创建后队首应已跳到 seat 1
    expect(sess.actor).toBe(1);
    expect(sess.snapshotFor(1).legalActions.length).toBeGreaterThan(0);
    // restore 重放一致性（空日志直接恢复；actor 必须一致）
    const restored = GameSession.restore(db, 'g-undo-5');
    expect(restored).not.toBeNull();
    expect(restored!.actor).toBe(1);
  });
});
