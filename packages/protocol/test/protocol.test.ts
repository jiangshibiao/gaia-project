import { describe, expect, it } from 'vitest';
import { newGame } from '@gaia/engine';
import type { Action, GameConfig, GameState, PlayerIndex } from '@gaia/engine';
import { filterStateFor } from '../src/filter.js';
import {
  PROTOCOL_VERSION,
  actorOf,
  type ClientMessage,
  type FilteredState,
  type RoomConfig,
  type RoomState,
  type SeatInfo,
  type ServerMessage,
} from '../src/index.js';

// 编译期断言辅助：condition 为 false 时该类型不可赋值，tsc 直接报错
type Assert<T extends true> = T;
type HasKey<T, K extends string> = K extends keyof T ? true : false;

type RoomStateMessage = Extract<ServerMessage, { type: 'room_state' }>;

// 广播安全：room_state 消息本体与其嵌套的 RoomState/SeatInfo/RoomConfig 均不得出现 token 字段
type _noToken1 = Assert<HasKey<RoomStateMessage, 'token'> extends false ? true : false>;
type _noToken2 = Assert<HasKey<RoomState, 'token'> extends false ? true : false>;
type _noToken3 = Assert<HasKey<SeatInfo, 'token'> extends false ? true : false>;
type _noToken4 = Assert<HasKey<RoomConfig, 'token'> extends false ? true : false>;

// FilteredState 的 rngState 被标为 never（不可持有值）
type _noRng = Assert<FilteredState['rngState'] extends undefined ? true : false>;

const CONFIG: GameConfig = {
  playerCount: 2,
  seed: 42,
  factions: ['terrans', 'xenos'],
  lostFleet: true,
};

describe('protocol', () => {
  it('PROTOCOL_VERSION === 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('actorOf：setup 阶段 → setupQueue[0]', () => {
    const s = newGame(CONFIG);
    expect(s.phase).toBe('setup');
    expect(actorOf(s)).toBe(s.setupQueue[0]!);
  });

  it('actorOf：pending 优先（charge 取队首；其余 kind 取 .player）', () => {
    const s = newGame(CONFIG);
    const charge: GameState = {
      ...s,
      pending: { kind: 'charge', queue: [{ player: 1, amount: 2, vpCost: 1 }, { player: 0, amount: 3, vpCost: 2 }] },
    };
    expect(actorOf(charge)).toBe(1);
    const tinkering: GameState = { ...s, pending: { kind: 'tinkering', player: 1 } };
    expect(actorOf(tinkering)).toBe(1);
    const freeMine: GameState = {
      ...s,
      pending: { kind: 'free-mine', player: 0, opts: {}, thenCharge: [] },
    };
    expect(actorOf(freeMine)).toBe(0);
  });

  it('actorOf：行动阶段 → currentPlayerIdx；终局 → null', () => {
    const s = newGame(CONFIG);
    const action: GameState = { ...s, phase: 'action', setupStage: null, setupQueue: [], currentPlayerIdx: 1 };
    expect(actorOf(action)).toBe(1);
    const over: GameState = { ...action, phase: 'game-over' };
    expect(actorOf(over)).toBeNull();
  });

  it('上下行消息可构造且可 JSON 序列化', () => {
    const s = newGame(CONFIG);
    const up: ClientMessage[] = [
      { type: 'create_room', protocolVersion: PROTOCOL_VERSION, nickname: 'a', config: { playerCount: 2, factionMode: 'friendly' } },
      { type: 'join_room', protocolVersion: PROTOCOL_VERSION, code: 'ABCD', nickname: 'b' },
      { type: 'start_game', protocolVersion: PROTOCOL_VERSION, token: 't' },
      { type: 'draft_pick', protocolVersion: PROTOCOL_VERSION, token: 't', faction: 'terrans' },
      { type: 'draft_bid', protocolVersion: PROTOCOL_VERSION, token: 't', faction: 'xenos', bid: 3 },
      { type: 'draft_confirm', protocolVersion: PROTOCOL_VERSION, token: 't' },
      { type: 'submit_action', protocolVersion: PROTOCOL_VERSION, token: 't', action: { type: 'burn' } },
      { type: 'resume', protocolVersion: PROTOCOL_VERSION, token: 't' },
      { type: 'leave', protocolVersion: PROTOCOL_VERSION, token: 't' },
      { type: 'export_game', protocolVersion: PROTOCOL_VERSION, token: 't' },
      { type: 'import_game', protocolVersion: PROTOCOL_VERSION, record: { version: 1, config: CONFIG, actions: [] }, seat: 0 },
      { type: 'list_agent_plugins', protocolVersion: PROTOCOL_VERSION },
      { type: 'ping', protocolVersion: PROTOCOL_VERSION },
    ];
    const down: ServerMessage[] = [
      {
        type: 'room_state',
        protocolVersion: PROTOCOL_VERSION,
        room: { code: 'ABCD', config: { playerCount: 2 }, customSeed: false, seats: [null, null], started: false, drafting: false },
        yourSeat: 0,
      },
      { type: 'credentials', protocolVersion: PROTOCOL_VERSION, seat: 0, token: 't' },
      {
        type: 'draft_state',
        protocolVersion: PROTOCOL_VERSION,
        draft: {
          mode: 'auction',
          turnOrder: [0, 1],
          currentActor: 1,
          picks: { 0: { faction: 'terrans', bid: 2 }, 1: null },
          available: ['xenos', 'geodens'],
          finished: false,
        },
      },
      { type: 'snapshot', protocolVersion: PROTOCOL_VERSION, seq: 0, state: filterStateFor(s), legalActions: [] },
      { type: 'action_applied', protocolVersion: PROTOCOL_VERSION, seq: 0, player: 0, action: { type: 'burn' }, events: [] },
      { type: 'ai_thinking', protocolVersion: PROTOCOL_VERSION, seat: 1, thinking: true },
      { type: 'game_over', protocolVersion: PROTOCOL_VERSION, winner: [0], finalScores: [100, 90] },
      { type: 'export_data', protocolVersion: PROTOCOL_VERSION, record: { version: 1, config: CONFIG, actions: [] } },
      { type: 'agent_plugins', protocolVersion: PROTOCOL_VERSION, plugins: [], defaultSpec: 'builtin:random' },
      { type: 'error', protocolVersion: PROTOCOL_VERSION, code: 'E', message: 'm' },
      { type: 'pong', protocolVersion: PROTOCOL_VERSION },
    ];
    for (const m of [...up, ...down]) {
      expect(JSON.parse(JSON.stringify(m))).toEqual(m);
    }
    // 类型锚定：Action/PlayerIndex 来自 engine
    const _anchor: { a?: Action; p?: PlayerIndex } = {};
    void _anchor;
  });
});
