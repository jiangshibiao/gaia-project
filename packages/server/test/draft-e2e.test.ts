/**
 * draft（种族选取）阶段 e2e：ws 级两客户端。
 * - friendly：start_game 进 draft → 按座位序锁定 → 全员就绪 → draft_confirm 开局；
 * - auction：选空闲族 + 一次抬价挤人 → confirm 后起始 VP = 10 − 出价（引擎已结算）；
 * - random：不进入 draft（现状回归锚定）；
 * - friendly + AI 座位：AI 自动选族，真人确认即可开局。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createTestHarness, type Msg, type TestClient } from './helpers.js';

const harness = createTestHarness();

afterEach(async () => {
  await harness.cleanup();
});

const PV = 1;

interface Client {
  c: TestClient;
  token: string;
  seat: number;
}

/** 建房（2 人，指定 factionMode）+ 第二人加入。 */
async function setupRoom(mode: string, extraConfig: Record<string, unknown> = {}): Promise<{ code: string; a: Client; b: Client; port: number }> {
  const server = await harness.startServer({ aiPaceMs: 0 });
  const a = await harness.connect(server.port);
  const credA = await a.send(
    {
      type: 'create_room',
      protocolVersion: PV,
      nickname: 'A',
      config: { playerCount: 2, seed: 42, factionMode: mode, ...extraConfig },
    },
    'credentials',
  );
  const code = (await a.nextMessage('room_state')).room.code as string;
  const b = await harness.connect(server.port);
  const credB = await b.send({ type: 'join_room', protocolVersion: PV, code, nickname: 'B' }, 'credentials');
  return {
    code,
    port: server.port,
    a: { c: a, token: credA.token as string, seat: 0 },
    b: { c: b, token: credB.token as string, seat: 1 },
  };
}

function nextDraft(client: TestClient, pred?: (m: Msg) => boolean): Promise<Msg> {
  return client.nextMessage('draft_state', pred);
}

describe('e2e: draft 种族选取', () => {
  it('friendly：两客户端按座位序锁定，confirm 后按所选族开局', async () => {
    const { a, b } = await setupRoom('friendly');
    a.c.send({ type: 'start_game', protocolVersion: PV, token: a.token });
    // 进入 draft：room_state.drafting=true + draft_state（座位 0 先行动）
    const drafting = await a.c.nextMessage('room_state', (m) => m.room.drafting === true);
    expect(drafting.room.started).toBe(false);
    const d0 = await nextDraft(a.c);
    expect(d0.draft.mode).toBe('friendly');
    expect(d0.draft.currentActor).toBe(0);
    expect(d0.draft.available).toHaveLength(18); // lostFleet 缺省 true

    // 座位 1 抢着行动 → not-your-turn
    b.c.send({ type: 'draft_pick', protocolVersion: PV, token: b.token, faction: 'xenos' });
    const err = await b.c.nextMessage('error');
    expect(err.code).toBe('not-your-turn');

    a.c.send({ type: 'draft_pick', protocolVersion: PV, token: a.token, faction: 'terrans' });
    const d1 = await nextDraft(b.c, (m) => m.draft.currentActor === 1);
    expect(d1.draft.picks['0']).toEqual({ faction: 'terrans', bid: 0 });
    expect(d1.draft.available).not.toContain('terrans');

    // 重复选取已被锁定的族 → invalid-faction
    b.c.send({ type: 'draft_pick', protocolVersion: PV, token: b.token, faction: 'terrans' });
    expect((await b.c.nextMessage('error')).code).toBe('invalid-faction');

    b.c.send({ type: 'draft_pick', protocolVersion: PV, token: b.token, faction: 'xenos' });
    const d2 = await nextDraft(a.c, (m) => m.draft.finished === true);
    expect(d2.draft.picks['1']).toEqual({ faction: 'xenos', bid: 0 });

    // confirm 开局：快照种族 = 所选，起始 VP 全 10
    b.c.send({ type: 'draft_confirm', protocolVersion: PV, token: b.token });
    const started = await a.c.nextMessage('room_state', (m) => m.room.started === true);
    expect(started.room.drafting).toBe(false);
    const snap = await a.c.nextMessage('snapshot');
    expect(snap.state.config.factions).toEqual(['terrans', 'xenos']);
    expect(snap.state.players.map((p: { vp: number }) => p.vp)).toEqual([10, 10]);
  });

  it('auction：抬价挤人后 confirm，起始 VP = 10 − 出价', async () => {
    const { a, b } = await setupRoom('auction');
    a.c.send({ type: 'start_game', protocolVersion: PV, token: a.token });
    const d0 = await nextDraft(a.c);
    expect(d0.draft.mode).toBe('auction');
    expect(d0.draft.currentActor).toBe(0);

    // 座位 0 出价 0 持有 terrans
    a.c.send({ type: 'draft_pick', protocolVersion: PV, token: a.token, faction: 'terrans' });
    await nextDraft(b.c, (m) => m.draft.currentActor === 1);

    // 座位 1 抬价 2 挤走座位 0 → 座位 0 回到未分配且成为下一行动者
    b.c.send({ type: 'draft_bid', protocolVersion: PV, token: b.token, faction: 'terrans', bid: 2 });
    const d2 = await nextDraft(a.c, (m) => m.draft.picks['0'] === null);
    expect(d2.draft.picks['1']).toEqual({ faction: 'terrans', bid: 2 });
    expect(d2.draft.currentActor).toBe(0);
    expect(d2.draft.available).not.toContain('terrans'); // terrans 现属座位 1，不在 available
    expect(d2.draft.available).toHaveLength(17);

    // 出价不高于当前价 → invalid-bid
    a.c.send({ type: 'draft_bid', protocolVersion: PV, token: a.token, faction: 'terrans', bid: 2 });
    expect((await a.c.nextMessage('error')).code).toBe('invalid-bid');

    // 座位 0 改选 xenos → 全员持有，finished
    a.c.send({ type: 'draft_pick', protocolVersion: PV, token: a.token, faction: 'xenos' });
    await nextDraft(a.c, (m) => m.draft.finished === true);

    a.c.send({ type: 'draft_confirm', protocolVersion: PV, token: a.token });
    const snap = await a.c.nextMessage('snapshot');
    expect(snap.state.config.factions).toEqual(['xenos', 'terrans']);
    // 起始 VP = 10 − 出价：座位 1 出 2 → 8
    expect(snap.state.players.map((p: { vp: number }) => p.vp)).toEqual([10, 8]);
  });

  it('random：不进入 draft，直接开局（现状回归）', async () => {
    const { a } = await setupRoom('random');
    a.c.send({ type: 'start_game', protocolVersion: PV, token: a.token });
    const started = await a.c.nextMessage('room_state', (m) => m.room.started === true);
    expect(started.room.drafting).toBe(false);
    const snap = await a.c.nextMessage('snapshot');
    expect(snap.state.config.factions).toHaveLength(2);
    // 未收到任何 draft_state
    expect(a.c.received.filter((m) => m.type === 'draft_state')).toHaveLength(0);
  });

  it('friendly + AI 座位：AI 自动选族，真人 confirm 开局', async () => {
    const server = await harness.startServer({ aiPaceMs: 0 });
    const a = await harness.connect(server.port);
    const credA = await a.send(
      {
        type: 'create_room',
        protocolVersion: PV,
        nickname: 'A',
        config: { playerCount: 2, seed: 42, factionMode: 'friendly', aiSeats: [{ difficulty: 'easy' }] },
      },
      'credentials',
    );
    a.send({ type: 'start_game', protocolVersion: PV, token: credA.token as string });
    const d0 = await nextDraft(a);
    expect(d0.draft.currentActor).toBe(0);
    // 真人（座位 0）锁定后，AI（座位 1）自动选族 → finished
    a.send({ type: 'draft_pick', protocolVersion: PV, token: credA.token as string, faction: 'itars' });
    const fin = await nextDraft(a, (m) => m.draft.finished === true);
    expect(fin.draft.picks['0']).toEqual({ faction: 'itars', bid: 0 });
    expect(fin.draft.picks['1']).not.toBeNull();
    a.send({ type: 'draft_confirm', protocolVersion: PV, token: credA.token as string });
    const snap = await a.nextMessage('snapshot');
    expect(snap.state.config.factions[0]).toBe('itars');
    expect(snap.state.players).toHaveLength(2);
  });
});
