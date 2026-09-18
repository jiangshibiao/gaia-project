import { expect, it } from 'vitest';
import { newGame } from '@gaia/engine';
import type { GameConfig } from '@gaia/engine';
import { filterStateFor } from '../src/filter.js';

const CONFIG: GameConfig = {
  playerCount: 2,
  seed: 42,
  factions: ['terrans', 'xenos'],
  lostFleet: true,
};

it('rngState 被剥掉（防推算随机流），其余字段保留', () => {
  const s = newGame(CONFIG);
  const f = filterStateFor(s);
  expect('rngState' in f).toBe(false);
  expect(f.rngState).toBeUndefined();
  // 其余关键字段原样保留（浅拷贝共享引用）
  expect(f.players).toBe(s.players);
  expect(f.map).toBe(s.map);
  expect(f.phase).toBe('setup');
  // JSON 序列化后整串不含 rngState
  expect(JSON.stringify(f)).not.toContain('rngState');
});

it('过滤不修改原 state', () => {
  const s = newGame(CONFIG);
  const before = JSON.stringify(s);
  filterStateFor(s);
  expect(JSON.stringify(s)).toBe(before);
  expect(typeof s.rngState).toBe('number');
});
