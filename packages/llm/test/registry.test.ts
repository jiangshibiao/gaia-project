import { describe, expect, it } from 'vitest';
import { enumerateActions, newGame } from '@gaia/engine';
import { DEFAULT_SPEC, agentFactoryFromSpec, listAgentPlugins, resolveAgentPlugin } from '../src/index.js';

describe('agent registry', () => {
  it('lists builtin plugins', () => {
    const specs = listAgentPlugins().map((p) => p.spec);
    expect(specs).toContain('builtin:random');
    expect(specs).toContain('builtin:first-legal');
    expect(specs).toContain('builtin:heuristic');
  });

  it('DEFAULT_SPEC 指向 heuristic2 插件', () => {
    expect(DEFAULT_SPEC).toBe('builtin:heuristic2');
    expect(resolveAgentPlugin(DEFAULT_SPEC).meta.name).toBe('heuristic2');
  });

  it('rejects unknown specs', () => {
    expect(() => resolveAgentPlugin('builtin:nope')).toThrow();
  });

  it('factory-created agent decides a legal action', async () => {
    const state = newGame({ playerCount: 2, seed: 42, factions: ['terrans', 'xenos'], lostFleet: true });
    const seat = state.phase === 'setup' ? state.setupQueue[0]! : state.currentPlayerIdx;
    const legal = enumerateActions(state, seat);
    const agent = agentFactoryFromSpec(DEFAULT_SPEC)(seat);
    const decision = await agent.decide(state, seat, legal);
    expect(legal.map((a) => JSON.stringify(a))).toContain(JSON.stringify(decision.action));
  });
});
