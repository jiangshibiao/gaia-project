/**
 * GameSession：权威对局会话（engine 裁决 + 落库 + 视角快照）。
 * 核心验收：整局随机对局经 session 推进，actions 表逐步落库（seq 从 0 连续），
 * 终局 final_state 落库且与"newGame(同 config) + 逐条重放 actions 表"逐字节一致；
 * GameSession.restore 重放恢复后与内存态 stableStringify 相等。
 */
import { describe, expect, it } from 'vitest';
import { applyAction, createRng, newGame, stableStringify } from '@gaia/engine';
import type { Action, FactionId, GameConfig, GameState, PlayerIndex } from '@gaia/engine';
import { actorOf } from '@gaia/protocol';
import { eq } from 'drizzle-orm';
import { listActions, openDb, type Db } from '../src/db/repo.js';
import { games } from '../src/db/schema.js';
import { GameSession, SessionError, generateGameId } from '../src/session.js';

const FACTION_POOL: FactionId[] = ['terrans', 'xenos', 'geodens', 'nevlas'];

function configFor(playerCount: 2 | 3 | 4, seed: number, lostFleet = true): GameConfig {
  return {
    playerCount,
    seed,
    factions: FACTION_POOL.slice(0, playerCount),
    lostFleet,
  };
}

function seatsFor(playerCount: number, tokenPrefix = 'tok') {
  return Array.from({ length: playerCount }, (_, i) => ({
    seat: i as PlayerIndex,
    nickname: `p${i}`,
    token: `${tokenPrefix}-${i}`, // seats.token 全局唯一：同库多局须加前缀
  }));
}

/** 用 rng 驱动整局随机对局直到终局；返回行动数。 */
function playRandomGame(sess: GameSession, rngSeed: number): number {
  const rng = createRng(rngSeed);
  let steps = 0;
  while (!sess.finished) {
    const actor = sess.actor;
    expect(actor).not.toBeNull();
    const snap = sess.snapshotFor(actor!);
    expect(snap.legalActions.length).toBeGreaterThan(0);
    const a = snap.legalActions[rng.nextInt(snap.legalActions.length)]!;
    sess.submitAction(actor!, a);
    steps += 1;
    if (steps > 20000) throw new Error('runaway game');
  }
  return steps;
}

function readGameRow(db: Db, gameId: string) {
  return db
    .select({ status: games.status, finalState: games.finalState })
    .from(games)
    .where(eq(games.id, gameId))
    .get();
}

/** 抓 SessionError 并断言 code；未抛或非 SessionError 则测试失败。 */
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

describe('GameSession', () => {
  it('整局随机对局：每步落库、seq 从 0 连续、final_state 与重放逐字节一致、restore 与内存态相等', () => {
    const db = openDb(':memory:');
    const config = configFor(2, 42);
    const sess = new GameSession(db, 'g1', config, seatsFor(2));
    const steps = playRandomGame(sess, 1);

    expect(sess.finished).toBe(true);
    expect(steps).toBeGreaterThan(50);

    const rows = listActions(db, 'g1');
    expect(rows.length).toBe(steps);
    rows.forEach((r, i) => expect(r.seq).toBe(i)); // seq 连续无洞

    // 重放：actions 表逐条 apply，player 列必须等于当时应行动玩家（含 pending/setup）
    let s: GameState = newGame(config);
    for (const row of rows) {
      expect(row.player).toBe(actorOf(s));
      s = applyAction(s, row.action);
    }

    // 终局落库：status finished + final_state 与重放终态/内存终态逐字节一致
    const row = readGameRow(db, 'g1');
    expect(row!.status).toBe('finished');
    expect(row!.finalState).not.toBeNull();
    expect(stableStringify(JSON.parse(row!.finalState!))).toBe(stableStringify(s));
    expect(stableStringify(JSON.parse(row!.finalState!))).toBe(stableStringify(sess.state));

    // restore：重放恢复后与内存态逐字节一致（含 setup 阶段行动）
    const restored = GameSession.restore(db, 'g1');
    expect(restored).not.toBeNull();
    expect(restored!.currentSeq).toBe(sess.currentSeq);
    expect(stableStringify(restored!.state)).toBe(stableStringify(sess.state));
  }, 120_000);

  it('非应行动玩家提交：not-your-turn，不落库', () => {
    const db = openDb(':memory:');
    const sess = new GameSession(db, 'g2', configFor(2, 7), seatsFor(2));
    const actor = sess.actor!;
    const other = (actor === 0 ? 1 : 0) as PlayerIndex;
    const a = sess.snapshotFor(actor).legalActions[0]!;

    expectSessionError(() => sess.submitAction(other, a), 'not-your-turn');
    expect(listActions(db, 'g2')).toHaveLength(0);
    expect(sess.snapshotFor(actor).seq).toBe(0);
  });

  it('非法行动：engine IllegalActionError 的 code 透传（illegal-action），不落库', () => {
    const db = openDb(':memory:');
    const sess = new GameSession(db, 'g3', configFor(2, 7), seatsFor(2));
    // setup 阶段 pass 不是合法行动
    const bogus: Action = { type: 'pass', booster: null };

    expectSessionError(() => sess.submitAction(sess.actor!, bogus), 'illegal-action');
    expect(listActions(db, 'g3')).toHaveLength(0);
  });

  it('终局后提交：game-finished', () => {
    const db = openDb(':memory:');
    const sess = new GameSession(db, 'g4', configFor(2, 7), seatsFor(2));
    playRandomGame(sess, 3);

    expectSessionError(
      () => sess.submitAction(sess.actor ?? 0, { type: 'burn' }),
      'game-finished',
    );
  }, 120_000);

  it('legalActions 仅应行动座位非空；snapshot 不含 rngState', () => {
    const db = openDb(':memory:');
    const sess = new GameSession(db, 'g5', configFor(3, 11), seatsFor(3));
    const actor = sess.actor!;

    expect(sess.snapshotFor(actor).legalActions.length).toBeGreaterThan(0);
    for (const seat of [0, 1, 2] as PlayerIndex[]) {
      if (seat === actor) continue;
      expect(sess.snapshotFor(seat).legalActions).toEqual([]);
    }
    expect(JSON.stringify(sess.snapshotFor(actor).state)).not.toContain('rngState');
  });

  it('submitAction 返回递增 seq（0 起）；snapshot.seq 同步推进', () => {
    const db = openDb(':memory:');
    const sess = new GameSession(db, 'g6', configFor(2, 7), seatsFor(2));

    for (let expected = 0; expected < 3; expected++) {
      const actor = sess.actor!;
      const a = sess.snapshotFor(actor).legalActions[0]!;
      expect(sess.submitAction(actor, a)).toEqual({ seq: expected });
      expect(sess.snapshotFor(sess.actor!).seq).toBe(expected + 1);
    }
    expect(listActions(db, 'g6').map((r) => r.seq)).toEqual([0, 1, 2]);
  });

  it('gameId 缺省时 crypto 生成（g_ 前缀），显式传入则原样使用', () => {
    const db = openDb(':memory:');
    const a = new GameSession(db, undefined, configFor(2, 7), seatsFor(2, 'ga'));
    const b = new GameSession(db, undefined, configFor(2, 8), seatsFor(2, 'gb'));
    expect(a.gameId).toMatch(/^g_[A-Za-z0-9_-]{11}$/);
    expect(b.gameId).toMatch(/^g_[A-Za-z0-9_-]{11}$/);
    expect(a.gameId).not.toBe(b.gameId);

    const c = new GameSession(db, 'explicit-id', configFor(2, 9), seatsFor(2, 'gc'));
    expect(c.gameId).toBe('explicit-id');
    expect(generateGameId()).toMatch(/^g_[A-Za-z0-9_-]{11}$/);
  });

  it('座位参数非法：seats 与 playerCount 不匹配抛 invalid-seats；越界 seat 抛 invalid-seat', () => {
    const db = openDb(':memory:');
    expectSessionError(
      () => new GameSession(db, 'g7', configFor(2, 7), seatsFor(3)),
      'invalid-seats',
    );
    const sess = new GameSession(db, 'g8', configFor(2, 7), seatsFor(2));
    expectSessionError(() => sess.snapshotFor(5 as PlayerIndex), 'invalid-seat');
    expectSessionError(() => sess.submitAction(5 as PlayerIndex, { type: 'burn' }), 'invalid-seat');
  });

  it('中途 restore：重放恢复与内存态 stableStringify 相等（含 setup 阶段）', () => {
    const db = openDb(':memory:');
    const sess = new GameSession(db, 'g9', configFor(2, 21), seatsFor(2));
    // 只走 setup 的若干步（2p：mines-1 两步 + mines-2 两步）
    for (let i = 0; i < 4; i++) {
      const actor = sess.actor!;
      sess.submitAction(actor, sess.snapshotFor(actor).legalActions[0]!);
    }
    const restored = GameSession.restore(db, 'g9');
    expect(restored).not.toBeNull();
    expect(restored!.currentSeq).toBe(4);
    expect(stableStringify(restored!.state)).toBe(stableStringify(sess.state));
    expect(restored!.state.phase).toBe(sess.state.phase);
  });

  it('restore：对局不存在返回 null', () => {
    const db = openDb(':memory:');
    expect(GameSession.restore(db, 'no-such-game')).toBeNull();
  });
});
