/**
 * 服务器端到端（ws 级对局）。
 *
 * 2 个真实 ws 客户端（真人）+ 2 个 AI 座位（agentFactoryFromSpec('builtin:random')，
 * GAIA_AI_PACE_MS=0 → aiPaceMs: 0）：建房 → 加入 → 开局 → 真人互打到 setup 结束
 * 再若干步，AI 座位由 driveAI 自动行动（ai_thinking true/false 成对、action_applied
 * 带 reason）；随后断线重连（resume），快照与另一客户端同 seq 快照一致。
 *
 * 单行动驱动防 flake：每一步等齐 2 端 seq 一致的 snapshot 再行动，天然无并发竞态。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { agentFactoryFromSpec } from '@gaia/llm';
import { createTestHarness, type Msg, type TestClient } from './helpers.js';

const harness = createTestHarness();

afterEach(async () => {
  await harness.cleanup();
});

const PV = 1;
const PER_STEP_TIMEOUT_MS = 30_000;
/** 进入行动阶段后再推进的步数。 */
const ACTION_PHASE_STEPS = 6;

/** 等某客户端收到 seq 的 snapshot。 */
function nextSnapshot(client: TestClient, seq: number): Promise<Msg> {
  return client.nextMessage('snapshot', (m) => m.seq === seq, PER_STEP_TIMEOUT_MS);
}

describe('e2e: ws 级对局（2 真人 + 2 AI）', () => {
  it(
    '建房→加入→开局→setup 打完→AI 自动行动→断线重连快照一致',
    { timeout: 120_000 },
    async () => {
      const server = await harness.startServer({
        aiAgentFactory: agentFactoryFromSpec('builtin:random'),
        aiPaceMs: 0,
      });

      // ---- 建房：c0 create(4p, 固定种子, 2 AI 座位) + c1 join + c0 start ----
      const c0 = await harness.connect(server.port);
      const cred0 = await c0.send(
        {
          type: 'create_room',
          protocolVersion: PV,
          nickname: 'P0',
          config: { playerCount: 4, seed: 42, aiSeats: [{ difficulty: 'easy' }, { difficulty: 'easy' }] },
        },
        'credentials',
      );
      expect(cred0.seat).toBe(0);
      const code = (await c0.nextMessage('room_state')).room.code as string;

      const c1 = await harness.connect(server.port);
      const cred1 = await c1.send(
        { type: 'join_room', protocolVersion: PV, code, nickname: 'P1' },
        'credentials',
      );
      expect(cred1.seat).toBe(1);

      // 开局前 room_state：2 真人 + 2 空位
      const preStart = await c0.nextMessage('room_state', (m) => m.room.seats.filter((s: unknown) => s !== null).length === 2);
      expect(preStart.room.seats[2]).toBeNull();

      c0.send({ type: 'start_game', protocolVersion: PV, token: cred0.token });
      // 开局后 room_state：4 座位全满，2 个 AI
      const started = await c0.nextMessage('room_state', (m) => m.room.started === true);
      const aiSeats = (started.room.seats as { isAI: boolean }[]).filter((s) => s.isAI);
      expect(aiSeats).toHaveLength(2);

      const humans: { client: TestClient; token: string }[] = [
        { client: c0, token: cred0.token as string },
        { client: c1, token: cred1.token as string },
      ];

      // ---- 主循环：等齐 2 端 seq 一致的 snapshot → 真人行动方提交 → AI 行动则等播报 ----
      let seq = 0;
      let sawActionPhase = false;
      let actionPhaseSteps = 0;
      for (;;) {
        const snaps = await Promise.all(humans.map((h) => nextSnapshot(h.client, seq)));
        const phase = snaps[0]!.state.phase as string;
        if (phase === 'action') {
          sawActionPhase = true;
        }
        const actorIdx = snaps.findIndex((s) => (s.legalActions as unknown[]).length > 0);
        // 退出条件：行动阶段已推进足够步数，且当前停在真人回合（AI 驱动停稳，
        // ai_thinking 已全部成对——后续计数断言无竞态）
        if (sawActionPhase && actionPhaseSteps >= ACTION_PHASE_STEPS && actorIdx !== -1) break;
        if (actorIdx === -1) {
          // AI 座位行动中：等 action_applied 推进（setup 的 AI 放置/行动阶段的 AI 回合）
          const applied = await c0.nextMessage('action_applied', (m) => m.seq === seq, PER_STEP_TIMEOUT_MS);
          expect(applied.player).toBeGreaterThanOrEqual(2); // AI 座位是 2/3
          expect(typeof applied.reason).toBe('string'); // AI 行动带决策理由
          seq += 1;
        } else {
          const legal = snaps[actorIdx]!.legalActions as Record<string, unknown>[];
          humans[actorIdx]!.client.send({
            type: 'submit_action',
            protocolVersion: PV,
            token: humans[actorIdx]!.token,
            action: legal[0],
          });
          const applied = await humans[actorIdx]!.client.nextMessage(
            'action_applied',
            (m) => m.seq === seq,
            PER_STEP_TIMEOUT_MS,
          );
          expect(applied.player).toBe(actorIdx);
          seq += 1;
        }
        if (sawActionPhase) {
          actionPhaseSteps += 1;
        }
        if (seq > 400) throw new Error('runaway e2e game');
      }
      expect(sawActionPhase).toBe(true); // setup 已打完
      expect(seq).toBeGreaterThan(12); // 4p setup（两轮矿 + 助推器）+ 行动阶段若干步

      // ---- 断言 1：两端 action_applied seq 恰好 0..N-1 连续无重号 ----
      const expectedSeqs = Array.from({ length: seq }, (_, i) => i);
      for (const h of humans) {
        const seqs = h.client.received.filter((m) => m.type === 'action_applied').map((m) => m.seq);
        expect(seqs).toEqual(expectedSeqs);
      }

      // ---- 断言 2：ai_thinking true/false 成对，且 AI 座位行动带 reason ----
      for (const h of humans) {
        const thinking = h.client.received.filter((m) => m.type === 'ai_thinking');
        const trues = thinking.filter((m) => m.thinking === true);
        const falses = thinking.filter((m) => m.thinking === false);
        expect(trues.length).toBeGreaterThan(0);
        expect(trues.length).toBe(falses.length);
        expect(trues.every((m) => m.seat >= 2)).toBe(true);
        const aiApplied = h.client.received.filter((m) => m.type === 'action_applied' && m.player >= 2);
        expect(aiApplied.length).toBeGreaterThan(0);
        expect(aiApplied.every((m) => typeof m.reason === 'string')).toBe(true);
      }

      // ---- 断言 3：快照不泄漏 rngState ----
      for (const h of humans) {
        for (const m of h.client.received) {
          if (m.type !== 'snapshot') continue;
          expect(JSON.stringify(m.state)).not.toContain('rngState');
        }
      }

      // ---- 断线重连：c1 断开 → 新连接 resume → 快照与 c0 同 seq 快照一致 ----
      await c1.close();
      // c0 应收到 c1 断线的 room_state（connected=false）
      await c0.nextMessage(
        'room_state',
        (m) => m.room.seats[1] !== null && m.room.seats[1].connected === false,
        PER_STEP_TIMEOUT_MS,
      );
      const c1b = await harness.connect(server.port);
      c1b.send({ type: 'resume', protocolVersion: PV, token: cred1.token });
      const cred1b = await c1b.nextMessage('credentials');
      expect(cred1b.seat).toBe(1);
      const resumedSnap = await c1b.nextMessage('snapshot');
      // c0 已收广播中必有同 seq 快照；state 应逐字节一致（filterStateFor 确定性）
      const peer = c0.received.find((m) => m.type === 'snapshot' && m.seq === resumedSnap.seq);
      expect(peer).toBeDefined();
      expect(resumedSnap.state).toEqual(peer!.state);
      // resume 后 room_state 标记 c1 重新在线
      await c1b.nextMessage(
        'room_state',
        (m) => m.room.seats[1] !== null && m.room.seats[1].connected === true,
        PER_STEP_TIMEOUT_MS,
      );
    },
  );
});
