/**
 * heuristic2 测试：decide 合法性与确定性、变体 cfg 差异、种族插件生效、
 * 强度表覆盖、叶估值单调性、前瞻剪枝契约。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createRng,
  enumerateActions,
  newGame,
  settleSetupSkips,
  type GameState,
  type PlayerIndex,
} from '@gaia/engine';
import { createAgent } from '../src/agents/registry.js';
import { BASE_CFG, LF_DELTA, cfgForVariant, mergeCfg } from '../src/heuristic2/cfg.js';
import { evalCtx } from '../src/heuristic2/context.js';
import { FACTION_STRENGTH, pickFactionByStrength } from '../src/heuristic2/factions.js';
import { pruneCandidates, scoredActions } from '../src/heuristic2/lookahead.js';
import { evaluateState } from '../src/heuristic2/position.js';

/** 当前应行动的玩家（与 engine playGame 同口径）。 */
function actingPlayer(state: GameState): PlayerIndex {
  const pending = state.pending;
  if (pending !== null) {
    return pending.kind === 'charge' ? pending.queue[0]!.player : pending.player;
  }
  if (state.phase === 'setup') return state.setupQueue[0]!;
  return state.currentPlayerIdx;
}

describe('heuristic2 decide 契约', () => {
  it('整局驱动：每步决策都在 legal 内，对局正常结束', async () => {
    let state = newGame({ playerCount: 2, seed: 3, factions: ['taklons', 'gleens'], lostFleet: true });
    const agents = [createAgent('builtin:heuristic2', { seat: 0 }), createAgent('builtin:heuristic2', { seat: 1 })];
    let steps = 0;
    for (; steps < 20000; steps++) {
      if (state.phase === 'game-over') break;
      const actor = actingPlayer(state);
      const legal = enumerateActions(state, actor);
      if (legal.length === 0) {
        const settled = settleSetupSkips(state);
        if (settled !== state) {
          state = settled;
          continue;
        }
        break;
      }
      const d = await agents[actor]!.decide(state, actor, legal);
      expect(legal.some((a) => a === d.action)).toBe(true);
      state = applyAction(state, d.action);
    }
    expect(state.phase).toBe('game-over');
    expect(steps).toBeGreaterThanOrEqual(50);
  });

  it('确定性：同局面同决策（含前瞻）', async () => {
    const state = newGame({ playerCount: 2, seed: 5, factions: ['terrans', 'xenos'], lostFleet: true });
    const actor = actingPlayer(state);
    const legal = enumerateActions(state, actor);
    const a1 = createAgent('builtin:heuristic2', { seat: actor });
    const a2 = createAgent('builtin:heuristic2', { seat: actor });
    const [d1, d2] = await Promise.all([a1.decide(state, actor, legal), a2.decide(state, actor, legal)]);
    expect(d1.action).toEqual(d2.action);
  });
});

describe('变体显式区分', () => {
  it('LF_DELTA 只在 lostFleet 时合并；base 与 LF 的估价 cfg 不同', () => {
    const lf = cfgForVariant('lostFleet');
    const base = cfgForVariant('base');
    expect(lf.mine.newPlanetType).not.toBe(base.mine.newPlanetType);
    expect(base.mine.newPlanetType).toBe(BASE_CFG.mine.newPlanetType);
    expect(lf.mine.newPlanetType).toBe(LF_DELTA.mine!.newPlanetType);
    // mergeCfg 不改原对象
    expect(BASE_CFG.mine.newPlanetType).toBe(2);
  });

  it('mergeCfg 深合并：只覆盖指定叶子', () => {
    const merged = mergeCfg(BASE_CFG, { resources: { ore: 9 }, lookahead: { enabled: false } });
    expect(merged.resources.ore).toBe(9);
    expect(merged.resources.qic).toBe(BASE_CFG.resources.qic);
    expect(merged.lookahead.enabled).toBe(false);
    expect(merged.lookahead.alpha).toBe(BASE_CFG.lookahead.alpha);
    expect(BASE_CFG.resources.ore).toBe(2.5); // 原对象不被改
  });

  it('evalCtx：base 局与 LF 局的 ctx.cfg 不同', () => {
    const lfState = newGame({ playerCount: 2, seed: 1, factions: ['terrans', 'xenos'], lostFleet: true });
    const baseState = newGame({ playerCount: 2, seed: 1, factions: ['terrans', 'xenos'], lostFleet: false });
    expect(evalCtx(lfState, 0).variant).toBe('lostFleet');
    expect(evalCtx(baseState, 0).variant).toBe('base');
    expect(evalCtx(lfState, 0).cfg.mine.newPlanetType).not.toBe(evalCtx(baseState, 0).cfg.mine.newPlanetType);
  });
});

describe('种族插件', () => {
  it('taklons 的充能价值高于默认（脑石循环）', () => {
    const state = newGame({ playerCount: 2, seed: 1, factions: ['taklons', 'xenos'], lostFleet: true });
    const taklonsCtx = evalCtx(state, 0);
    const xenosCtx = evalCtx(state, 1);
    expect(taklonsCtx.me.faction).toBe('taklons');
    expect(taklonsCtx.cfg.resources.chargePower).toBeGreaterThan(xenosCtx.cfg.resources.chargePower);
  });

  it('强度表：覆盖 base 14 族与 LF 18 族；terrans 在 LF 显著贬值', () => {
    expect(Object.keys(FACTION_STRENGTH.base)).toHaveLength(14);
    expect(Object.keys(FACTION_STRENGTH.lostFleet)).toHaveLength(18);
    expect(FACTION_STRENGTH.lostFleet['terrans']!).toBeLessThan(FACTION_STRENGTH.base['terrans']!);
    // draft 选族：LF 全池取 ivits（强度 9 最高档）
    expect(pickFactionByStrength(Object.keys(FACTION_STRENGTH.lostFleet), 'lostFleet')).toBe('ivits');
    // base 池里 taklons/itars/ivits 同档（9），取表中先出现者
    expect(['taklons', 'itars', 'ivits']).toContain(
      pickFactionByStrength(Object.keys(FACTION_STRENGTH.base), 'base'),
    );
  });
});

describe('叶估值与剪枝', () => {
  it('evaluateState：同种子开局两座位估值有限且相近（对称开局）', () => {
    const state = newGame({ playerCount: 2, seed: 2, factions: ['terrans', 'xenos'], lostFleet: true });
    const v0 = evaluateState(state, 0);
    const v1 = evaluateState(state, 1);
    expect(Number.isFinite(v0)).toBe(true);
    expect(Number.isFinite(v1)).toBe(true);
    expect(Math.abs(v0 - v1)).toBeLessThan(30);
  });

  it('pruneCandidates：每域不超 topK，free 域负分被剔除', () => {
    // 推进到行动阶段再测（setup 阶段 legal 域单一）。
    let state = newGame({ playerCount: 2, seed: 7, factions: ['terrans', 'xenos'], lostFleet: true });
    const rng = createRng(42);
    for (let i = 0; i < 200 && state.phase !== 'action'; i++) {
      const actor = actingPlayer(state);
      const legal = enumerateActions(state, actor);
      if (legal.length === 0) {
        const settled = settleSetupSkips(state);
        if (settled === state) break;
        state = settled;
        continue;
      }
      state = applyAction(state, legal[rng.nextInt(legal.length)]!);
    }
    expect(state.phase).toBe('action');
    const actor = actingPlayer(state);
    const legal = enumerateActions(state, actor);
    const ctx = evalCtx(state, actor);
    const scored = scoredActions(ctx, legal);
    const pruned = pruneCandidates(ctx, scored);
    expect(pruned.length).toBeGreaterThan(0);
    expect(pruned.length).toBeLessThanOrEqual(scored.length);
    const k = ctx.cfg.lookahead.topK;
    const mines = pruned.filter((s) => s.action.type === 'build-mine');
    expect(mines.length).toBeLessThanOrEqual(k.mine);
    const frees = pruned.filter((s) => s.action.type === 'free-conversion');
    for (const f of frees) expect(f.score).toBeGreaterThanOrEqual(-0.05);
  });
});
