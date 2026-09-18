import { describe, expect, it } from 'vitest';
import { RoomError, RoomManager, drawFactions, toRoomState } from '../src/rooms.js';

const CODE_FORBIDDEN = new Set(['0', 'O', '1', 'I', 'L']);

describe('RoomManager', () => {
  it('createRoom：建房者坐 seat 0，返回 24 字符 token 与未开始房间', () => {
    const rm = new RoomManager();
    const { room, seat, token } = rm.createRoom({ playerCount: 4 }, 'alice');
    expect(seat).toBe(0);
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(room.started).toBe(false);
    expect(room.seats).toHaveLength(4);
    expect(room.seats[0]?.nickname).toBe('alice');
    expect(room.seats[1]).toBeNull();
    expect(rm.getRoom(room.code)).toBe(room);
  });

  it('房间号：6 位大写字母数字，排除混淆字符 0O1IL', () => {
    const rm = new RoomManager();
    for (let i = 0; i < 30; i++) {
      const { room } = rm.createRoom({ playerCount: 2 }, `h${i}`);
      expect(room.code).toHaveLength(6);
      for (const ch of room.code) {
        expect(ch).toMatch(/[A-Z0-9]/);
        expect(CODE_FORBIDDEN.has(ch)).toBe(false);
      }
    }
  });

  it('joinRoom：按顺序补位，token 互不相同', () => {
    const rm = new RoomManager();
    const { room } = rm.createRoom({ playerCount: 3 }, 'alice');
    const j1 = rm.joinRoom(room.code, 'bob');
    const j2 = rm.joinRoom(room.code, 'carol');
    expect(j1.seat).toBe(1);
    expect(j2.seat).toBe(2);
    const tokens = new Set([j1.token, j2.token]);
    expect(tokens.size).toBe(2);
  });

  it('joinRoom：满员拒绝（room-full）；房间不存在（room-not-found）', () => {
    const rm = new RoomManager();
    const { room } = rm.createRoom({ playerCount: 2 }, 'alice');
    rm.joinRoom(room.code, 'bob');
    expect(() => rm.joinRoom(room.code, 'carol')).toThrowError(
      expect.objectContaining({ code: 'room-full' }) as RoomError,
    );
    expect(() => rm.joinRoom('ZZZZZZ', 'carol')).toThrowError(
      expect.objectContaining({ code: 'room-not-found' }) as RoomError,
    );
  });

  it('token 唯一性：批量建房/加入无重复', () => {
    const rm = new RoomManager();
    const tokens = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const { room, token } = rm.createRoom({ playerCount: 2 }, `h${i}`);
      tokens.add(token);
      tokens.add(rm.joinRoom(room.code, `g${i}`).token);
    }
    expect(tokens.size).toBe(80);
  });

  it('startGame：满员后可开始；任意座位成员均可开始；人数不满拒绝', () => {
    const rm = new RoomManager();
    const { room } = rm.createRoom({ playerCount: 2 }, 'alice');
    const { token: bobToken } = rm.joinRoom(room.code, 'bob');
    expect(() => rm.startGame(bobToken)).not.toThrow();
    expect(room.started).toBe(true);

    const rm2 = new RoomManager();
    const { token } = rm2.createRoom({ playerCount: 3 }, 'alice');
    expect(() => rm2.startGame(token)).toThrowError(
      expect.objectContaining({ code: 'room-not-full' }) as RoomError,
    );
    expect(() => rm2.startGame('x'.repeat(24))).toThrowError(
      expect.objectContaining({ code: 'not-in-room' }) as RoomError,
    );
  });

  it('重复开始/已开始加入均拒绝（already-started）', () => {
    const rm = new RoomManager();
    const { room, token } = rm.createRoom({ playerCount: 2 }, 'alice');
    rm.joinRoom(room.code, 'bob');
    rm.startGame(token);
    expect(() => rm.startGame(token)).toThrowError(
      expect.objectContaining({ code: 'already-started' }) as RoomError,
    );
    expect(() => rm.joinRoom(room.code, 'carol')).toThrowError(
      expect.objectContaining({ code: 'already-started' }) as RoomError,
    );
  });

  it('种子：config.seed 给定则原样落地；未给则 crypto 随机生成', () => {
    const rm = new RoomManager();
    const { room, token } = rm.createRoom({ playerCount: 2, seed: 12345 }, 'alice');
    rm.joinRoom(room.code, 'bob');
    expect(room.seed).toBeNull();
    rm.startGame(token);
    expect(room.seed).toBe(12345);

    const rm2 = new RoomManager();
    const r2 = rm2.createRoom({ playerCount: 2 }, 'a');
    rm2.joinRoom(r2.room.code, 'b');
    rm2.startGame(r2.token);
    expect(typeof r2.room.seed).toBe('number');
    expect(Number.isInteger(r2.room.seed)).toBe(true);
  });

  it('种族：startGame 按 seed 抽取 playerCount 个不重复种族（同 seed 确定）', () => {
    const rm = new RoomManager();
    const { room, token } = rm.createRoom({ playerCount: 3, seed: 42 }, 'alice');
    rm.joinRoom(room.code, 'bob');
    rm.joinRoom(room.code, 'carol');
    rm.startGame(token);
    expect(room.factions).toHaveLength(3);
    expect(new Set(room.factions!).size).toBe(3);
    // 同 seed 同结果（确定性）
    expect(room.factions).toEqual(drawFactions(42, 3, true));
    // lostFleet=true（默认）：池含 LF 族；多次抽样应能抽到 LF 族
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      for (const f of drawFactions(seed, 4, true)) seen.add(f);
    }
    expect(seen.size).toBe(18);
    const seenBase = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      for (const f of drawFactions(seed, 4, false)) seenBase.add(f);
    }
    expect(seenBase.size).toBe(14);
  });

  it('AI 座位：startGame 填充空位（伪造 token 不进索引），昵称带难度', () => {
    const rm = new RoomManager();
    const { room, token } = rm.createRoom(
      { playerCount: 4, aiSeats: [{ difficulty: 'easy' }, { difficulty: 'hard' }] },
      'alice',
    );
    rm.joinRoom(room.code, 'bob');
    rm.startGame(token);
    const aiSeats = room.seats.filter((s): s is NonNullable<typeof s> => s !== null && s.isAI);
    expect(aiSeats).toHaveLength(2);
    expect(aiSeats[0]!.nickname).toContain('简单');
    expect(aiSeats[1]!.nickname).toContain('困难');
    expect(aiSeats.every((s) => s.connected)).toBe(true);
    // AI token 不进 tokenIndex：findByToken 不可达
    for (const s of aiSeats) {
      expect(rm.findByToken(s.token)).toBeNull();
    }
    // 座位 0..3 全部填满
    expect(room.seats.every((s) => s !== null)).toBe(true);
  });

  it('AI 座位：满员真人房填 0 个；aiSeats 超 playerCount-1 拒绝（invalid-config）', () => {
    const rm = new RoomManager();
    const { room, token } = rm.createRoom(
      { playerCount: 2, aiSeats: [{ difficulty: 'easy' }] },
      'alice',
    );
    rm.joinRoom(room.code, 'bob');
    rm.startGame(token);
    expect(room.seats.every((s) => s !== null && !s.isAI)).toBe(true);

    expect(() =>
      rm.createRoom({ playerCount: 2, aiSeats: [{ difficulty: 'easy' }, { difficulty: 'easy' }] }, 'x'),
    ).toThrowError(expect.objectContaining({ code: 'invalid-config' }) as RoomError);
    expect(() =>
      rm.createRoom({ playerCount: 3, aiSeats: [{ difficulty: 'nightmare' as 'easy' }] }, 'x'),
    ).toThrowError(expect.objectContaining({ code: 'invalid-config' }) as RoomError);
    expect(() =>
      rm.createRoom({ playerCount: 3, aiSeats: [{ difficulty: 'easy', spec: 'builtin:nope' }] }, 'x'),
    ).toThrowError(expect.objectContaining({ code: 'invalid-config' }) as RoomError);
  });

  it('昵称：空或超过 16 字符拒绝（invalid-nickname）', () => {
    const rm = new RoomManager();
    expect(() => rm.createRoom({ playerCount: 2 }, '')).toThrowError(
      expect.objectContaining({ code: 'invalid-nickname' }) as RoomError,
    );
    expect(() => rm.createRoom({ playerCount: 2 }, 'x'.repeat(17))).toThrowError(
      expect.objectContaining({ code: 'invalid-nickname' }) as RoomError,
    );
  });

  it('toRoomState：广播安全视图不含 token 与 seed；lostFleet 缺省 true', () => {
    const rm = new RoomManager();
    const { room } = rm.createRoom({ playerCount: 2, seed: 42 }, 'alice');
    rm.joinRoom(room.code, 'bob');
    const state = toRoomState(room);
    expect(state.config).toEqual({ playerCount: 2, lostFleet: true, factionMode: 'random' });
    expect(state.seats[0]).toEqual({ seat: 0, nickname: 'alice', isAI: false, connected: true });
    expect(JSON.stringify(state)).not.toContain('token');
    expect(JSON.stringify(state.config)).not.toContain('seed');
    expect(state.customSeed).toBe(true);
  });

  it('开局前离开（座位清空）：剩余玩家不能开一个含幽灵座位的局', () => {
    const rm = new RoomManager();
    const { room, token: aToken } = rm.createRoom({ playerCount: 2 }, 'A');
    const { seat: bSeat, token: bToken } = rm.joinRoom(room.code, 'B');
    // 模拟 handleLeave 的开局前分支：dropToken + 座位清空
    rm.dropToken(bToken);
    room.seats[bSeat] = null;
    expect(toRoomState(room).seats[1]).toBeNull();
    expect(() => rm.startGame(aToken)).toThrowError(
      expect.objectContaining({ code: 'room-not-full' }) as RoomError,
    );
  });

  it('开局前 resume：findByToken 恢复座位', () => {
    const rm = new RoomManager();
    const { room, token } = rm.createRoom({ playerCount: 2 }, 'alice');
    const found = rm.findByToken(token);
    expect(found).not.toBeNull();
    expect(found!.room).toBe(room);
    expect(found!.seat.seat).toBe(0);
    expect(rm.findByToken('x'.repeat(24))).toBeNull();
  });

  it('createRoom：config 浅拷贝，调用方后续 mutate 不影响房间', () => {
    const rm = new RoomManager();
    const config = { playerCount: 2 as const, seed: 9 };
    const { room } = rm.createRoom(config, 'alice');
    config.seed = 999;
    expect(room.config.seed).toBe(9);
  });
});
