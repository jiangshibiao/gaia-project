/**
 * bench 核心逻辑守护（不烧 token：只用 random/heuristic 插件跑 2 局）：
 * - driveGame 异步驱动完整对局（setup → 行动 → game-over），行动日志可重放；
 * - gameRecord 汇总形状（vps/winner/degraded/usage）。
 * 真 LLM 跑批是手动行为（npm run bench），不进测试。
 */
import { describe, expect, it } from 'vitest';
import { applyAction, newGame, stableStringify, type GameConfig } from '@gaia/engine';
import { createAgent } from '../src/agents/registry.js';
import { HeuristicAgent } from '../src/heuristic.js';
import { driveGame } from '../bench/drive-game.js';
import { gameRecord } from '../bench/trace.js';

const CONFIG: GameConfig = { playerCount: 2, seed: 1, factions: ['terrans', 'xenos'], lostFleet: true };

describe('bench driveGame', () => {
  it('heuristic vs random 完整对局跑通，日志可重放到逐字节一致终态', async () => {
    const agents = [
      createAgent('builtin:heuristic', { seat: 0 }),
      createAgent('builtin:random', { seat: 1 }),
    ];
    const game = await driveGame({ ...CONFIG }, agents);
    expect(game.state.phase).toBe('game-over');
    expect(game.state.winner).not.toBeNull();
    expect(game.decisions.length).toBeGreaterThan(50);
    expect(game.log.length).toBe(game.decisions.length);
    // 重放：newGame(同 config) + 逐条 applyAction → 逐字节一致。
    let replay = newGame({ ...CONFIG });
    for (const a of game.log) {
      replay = applyAction(replay, a);
    }
    expect(stableStringify(replay)).toBe(stableStringify(game.state));
    // 决策记录形状：chosenRank 0 起、usage 字段齐备。
    for (const d of game.decisions.slice(0, 20)) {
      expect(d.chosenRank).toBeGreaterThanOrEqual(0);
      expect(d.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    }
  }, 120_000);

  it('heuristic 内战跑通 + gameRecord 汇总', async () => {
    const agents = [new HeuristicAgent(), new HeuristicAgent()];
    const game = await driveGame({ ...CONFIG, seed: 2 }, agents);
    const record = gameRecord(game, ['heuristic', 'heuristic'], false, 123);
    expect(record.vps.length).toBe(2);
    expect(record.steps).toBe(game.decisions.length);
    expect(record.degraded[0]! + record.degraded[1]!).toBe(record.steps);
    expect(record.winner === null || record.winner === 0 || record.winner === 1).toBe(true);
    expect(record.usage).toEqual([
      { inputTokens: 0, outputTokens: 0 },
      { inputTokens: 0, outputTokens: 0 },
    ]);
  }, 120_000);
});
