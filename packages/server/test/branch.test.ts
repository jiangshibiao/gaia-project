/**
 * branch_game（残局开新局）端到端：
 * 本地造一段合法行动前缀 → ws 发 branch_game → 申请者以自选座位拿到 credentials，
 * 房间其余座位 AI 托管，snapshot seq = 前缀步数，行动权交接正常；
 * 终局面/空前缀/越界座位分别报 import-invalid / bad-message / invalid-seat。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { agentFactoryFromSpec } from '@gaia/llm';
import { applyAction, enumerateActions, newGame, settleSetupSkips } from '@gaia/engine';
import type { Action, FactionId, GameConfig, GameState } from '@gaia/engine';
import { actorOf } from '@gaia/protocol';
import { createTestHarness } from './helpers.js';

const harness = createTestHarness();

afterEach(async () => {
  await harness.cleanup();
});

const PV = 1;

/** 造 config 下前 n 步合法行动（每步取第一个合法行动）。 */
function makeRecord(config: GameConfig, n: number): { version: 1; config: GameConfig; actions: Action[]; finalState: GameState } {
  let s = settleSetupSkips(newGame(config));
  const actions: Action[] = [];
  for (let i = 0; i < n; i++) {
    const actor = actorOf(s);
    if (actor === null) break;
    const legal = enumerateActions(s, actor);
    const a = legal[0]!;
    actions.push(a);
    s = applyAction(s, a);
  }
  return { version: 1, config, actions, finalState: s };
}

describe('e2e: branch_game 残局开新局', () => {
  it('截断前缀开新房间：自选座位入座、其余 AI 托管、seq 接续', { timeout: 60_000 }, async () => {
    const server = await harness.startServer({ aiAgentFactory: agentFactoryFromSpec('builtin:random'), aiPaceMs: 0 });
    const config: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'xenos'] as FactionId[], lostFleet: true };
    const rec = makeRecord(config, 4);

    const c0 = await harness.connect(server.port);
    c0.send({ type: 'branch_game', protocolVersion: PV, record: { version: 1, config, actions: rec.actions }, seat: 1, nickname: '我' });
    const cred = await c0.nextMessage('credentials');
    expect(cred.seat).toBe(1);
    expect(typeof cred.token).toBe('string');

    const room = (await c0.nextMessage('room_state')).room;
    expect(room.started).toBe(true);
    const seats = room.seats as { isAI: boolean; nickname: string }[];
    expect(seats.filter((s) => s.isAI)).toHaveLength(1);
    expect(seats[1]?.isAI).toBe(false);

    const snap = await c0.nextMessage('snapshot', (m) => m.seq === rec.actions.length, 30_000);
    expect(snap.state.round).toBe(rec.finalState.round);
    // 后续可继续行动：若轮到 AI 则等其行动后 seq 前进；若轮到我则 legalActions 非空
    const actor = actorOf(rec.finalState);
    if (actor === 1) {
      expect(snap.legalActions.length).toBeGreaterThan(0);
    }
  });

  it('终局面/空前缀/越界座位拒绝', { timeout: 60_000 }, async () => {
    const server = await harness.startServer({ aiAgentFactory: agentFactoryFromSpec('builtin:random'), aiPaceMs: 0 });
    const config: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'xenos'] as FactionId[], lostFleet: true };
    const rec = makeRecord(config, 4);

    const c1 = await harness.connect(server.port);
    c1.send({ type: 'branch_game', protocolVersion: PV, record: { version: 1, config, actions: rec.actions }, seat: 5, nickname: 'x' });
    const err1 = await c1.nextMessage('error');
    expect(err1.code).toBe('invalid-seat');

    const c2 = await harness.connect(server.port);
    c2.send({ type: 'branch_game', protocolVersion: PV, record: { version: 1, config, actions: [] }, seat: 0, nickname: 'x' });
    const err2 = await c2.nextMessage('error');
    expect(err2.code).toBe('bad-message');

    // 终局面：打到对局结束再 branch
    const over = makeRecord(config, 100000);
    const c3 = await harness.connect(server.port);
    c3.send({ type: 'branch_game', protocolVersion: PV, record: { version: 1, config, actions: over.actions }, seat: 0, nickname: 'x' });
    const err3 = await c3.nextMessage('error');
    expect(err3.code).toBe('import-invalid');
  });
});
