/**
 * 对局导出/导入集成测试：
 * - export_game 返回 GameConfig（种子+种族）+ 全量行动日志；
 * - 本地重放（newGame(config) + 逐条 applyAction）与服务器快照逐字节一致；
 * - import_game 重放校验后回终态 snapshot（复盘查看，不进房间）；
 * - 篡改的行动日志 → import-invalid。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { applyAction, newGame, stableStringify } from '@gaia/engine';
import { filterStateFor, type GameRecord } from '@gaia/protocol';
import { createTestHarness, type Msg, type TestClient } from './helpers.js';

const harness = createTestHarness();

afterEach(async () => {
  await harness.cleanup();
});

const PV = 1;
const PER_STEP_TIMEOUT_MS = 30_000;
/** 真人互打的步数（含 setup）。 */
const HUMAN_STEPS = 8;

/** 双真人客户端轮流行动 N 步；返回最终 seq。 */
async function playSteps(
  a: { client: TestClient; token: string },
  b: { client: TestClient; token: string },
  steps: number,
): Promise<number> {
  const humans = [a, b];
  for (let seq = 0; seq < steps; seq++) {
    const snaps = await Promise.all(
      humans.map((h) => h.client.nextMessage('snapshot', (m) => m.seq === seq, PER_STEP_TIMEOUT_MS)),
    );
    const actorIdx = snaps.findIndex((s) => (s.legalActions as unknown[]).length > 0);
    expect(actorIdx).toBeGreaterThanOrEqual(0);
    const legal = snaps[actorIdx]!.legalActions as Record<string, unknown>[];
    humans[actorIdx]!.client.send({
      type: 'submit_action',
      protocolVersion: PV,
      token: humans[actorIdx]!.token,
      action: legal[0],
    });
    await humans[actorIdx]!.client.nextMessage('action_applied', (m) => m.seq === seq, PER_STEP_TIMEOUT_MS);
  }
  return steps;
}

describe('对局导出/导入', () => {
  it('导出 GameRecord 重放等于当前态；导入回终态快照；篡改日志被拒', { timeout: 120_000 }, async () => {
    const server = await harness.startServer();

    // ---- 双真人 2p 局（固定种子），互打 HUMAN_STEPS 步 ----
    const a = await harness.connect(server.port);
    const credA = await a.send(
      { type: 'create_room', protocolVersion: PV, nickname: 'A', config: { playerCount: 2, seed: 7 } },
      'credentials',
    );
    const code = (await a.nextMessage('room_state')).room.code as string;
    const b = await harness.connect(server.port);
    const credB = await b.send(
      { type: 'join_room', protocolVersion: PV, code, nickname: 'B' },
      'credentials',
    );
    a.send({ type: 'start_game', protocolVersion: PV, token: credA.token });
    const totalSteps = await playSteps(
      { client: a, token: credA.token as string },
      { client: b, token: credB.token as string },
      HUMAN_STEPS,
    );

    // ---- 导出：record 含 config（种子+种族）与全量行动 ----
    a.send({ type: 'export_game', protocolVersion: PV, token: credA.token });
    const exp = await a.nextMessage('export_data');
    const record = exp.record as GameRecord;
    expect(record.version).toBe(1);
    expect(record.config.playerCount).toBe(2);
    expect(record.config.seed).toBe(7);
    expect(record.config.factions).toHaveLength(2);
    expect(record.config.lostFleet).toBe(true);
    expect(record.actions).toHaveLength(totalSteps);

    // ---- 本地重放：终态与服务器最新快照逐字节一致（剥 rngState 后） ----
    let s = newGame(record.config);
    for (const action of record.actions) {
      s = applyAction(s, action);
    }
    const latestSnap = a.received
      .filter((m: Msg) => m.type === 'snapshot')
      .at(-1)!;
    expect(latestSnap.seq).toBe(totalSteps);
    expect(stableStringify(latestSnap.state)).toBe(stableStringify(JSON.parse(JSON.stringify(filterStateFor(s)))));

    // ---- 导入：重放校验后回终态 snapshot（不进房间，连接房间归属不变） ----
    const c = await harness.connect(server.port);
    c.send({ type: 'import_game', protocolVersion: PV, record });
    const snap = await c.nextMessage('snapshot');
    expect(snap.seq).toBe(totalSteps);
    expect(stableStringify(snap.state)).toBe(stableStringify(latestSnap.state));
    // 导入不发 credentials/room_state（纯复盘查看）
    expect(c.received.every((m: Msg) => m.type !== 'credentials' && m.type !== 'room_state')).toBe(true);

    // ---- 篡改的行动日志：import-invalid ----
    const bad: GameRecord = {
      version: 1,
      config: record.config,
      actions: [{ type: 'pass', booster: null }], // setup 阶段 pass 非法
    };
    c.send({ type: 'import_game', protocolVersion: PV, record: bad });
    const err = await c.nextMessage('error');
    expect(err.code).toBe('import-invalid');
  });
});
