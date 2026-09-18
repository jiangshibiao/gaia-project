/**
 * replay 测试：playGame 的行动日志用 newGame 同 config + 逐条 applyAction
 * （带合法性校验）重放，终态 stableStringify 逐字节相等。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  newGame,
  playGame,
  stableStringify,
  type FactionId,
  type GameConfig,
} from '../src/index.js';

const CASES: { name: string; config: GameConfig }[] = [
  {
    name: '2p seed42',
    config: { playerCount: 2, seed: 42, factions: ['terrans', 'lantids'], lostFleet: true },
  },
  {
    name: '2p seed7 gleens/taklons',
    config: { playerCount: 2, seed: 7, factions: ['gleens', 'taklons'], lostFleet: true },
  },
  {
    name: '3p ivits/xenos/tinkeroids（setup 空枚举跳过）',
    config: { playerCount: 3, seed: 5, factions: ['ivits', 'xenos', 'tinkeroids'], lostFleet: true },
  },
  {
    name: '3p seed11 baltaks/nevlas/ambas',
    config: { playerCount: 3, seed: 11, factions: ['baltaks', 'nevlas', 'ambas'], lostFleet: true },
  },
  {
    name: '4p seed42',
    config: {
      playerCount: 4,
      seed: 42,
      factions: ['terrans', 'taklons', 'nevlas', 'itars'] as FactionId[],
      lostFleet: true,
    },
  },
  {
    name: '4p seed23 LF 新族',
    config: {
      playerCount: 4,
      seed: 23,
      factions: ['tinkeroids', 'darkanians', 'moweyds', 'space-giants'] as FactionId[],
      lostFleet: true,
    },
  },
];

describe('replay：行动日志重放逐字节一致', () => {
  for (const { name, config } of CASES) {
    it(
      name,
      () => {
        const { state, log } = playGame(config);
        expect(state.phase).toBe('game-over');
        let replayed = newGame(config);
        for (const action of log) {
          replayed = applyAction(replayed, action);
        }
        expect(stableStringify(replayed)).toBe(stableStringify(state));
      },
      120_000,
    );
  }
});
