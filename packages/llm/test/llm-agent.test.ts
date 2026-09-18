/**
 * LLMAgent 决策链测试：fixture client 注入（不烧 token）。
 * 覆盖：正常选择 / 越界重试 / 重试仍失败降级 / API 异常降级 / degraded 标记 /
 * usage 累计 / 难度模型与 hard 前瞻段。
 */
import { describe, expect, it } from 'vitest';
import { enumerateActions, newGame } from '@gaia/engine';
import { HeuristicAgent, prescreen } from '../src/heuristic.js';
import { LLMAgent } from '../src/llm-agent.js';
import { FixtureClient, makeResponse } from './fixtures.js';

function fixtureState() {
  const state = newGame({ playerCount: 2, seed: 42, factions: ['terrans', 'xenos'], lostFleet: true });
  const seat = state.setupQueue[0]!;
  const legal = enumerateActions(state, seat);
  return { state, seat, legal };
}

describe('LLMAgent', () => {
  it('正常选择：返回 candidates[choiceIndex]，degraded=false，usage 记录', async () => {
    const { state, seat, legal } = fixtureState();
    const client = new FixtureClient(makeResponse(2, '选它'));
    const agent = new LLMAgent(client, 'normal');
    const d = await agent.decide(state, seat, legal);
    const candidates = prescreen(state, seat, legal, 20);
    expect(d.action).toEqual(candidates[2]);
    expect(d.reason).toBe('选它');
    expect(d.degraded).toBe(false);
    expect(d.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(client.requests.length).toBe(1);
    expect(client.requests[0]!.candidates).toBe(candidates.length);
  });

  it('难度表：easy 用 haiku/top8，hard 附前瞻段', async () => {
    const { state, seat, legal } = fixtureState();
    const easy = new FixtureClient();
    await new LLMAgent(easy, 'easy').decide(state, seat, legal);
    expect(easy.requests[0]!.model).toBe('claude-haiku-4-5');
    expect(easy.requests[0]!.candidates).toBe(Math.min(8, legal.length));

    const hard = new FixtureClient();
    await new LLMAgent(hard, 'hard').decide(state, seat, legal);
    expect(hard.requests[0]!.model).toBe('claude-sonnet-4-5');
    expect(hard.requests[0]!.user).toContain('【前瞻');

    const normal = new FixtureClient();
    await new LLMAgent(normal, 'normal').decide(state, seat, legal);
    expect(normal.requests[0]!.user).not.toContain('【前瞻');
  });

  it('choiceIndex 越界重试一次：第二次有效则正常返回', async () => {
    const { state, seat, legal } = fixtureState();
    const client = new FixtureClient(makeResponse(999), makeResponse(1, '改选'));
    const d = await new LLMAgent(client, 'normal').decide(state, seat, legal);
    const candidates = prescreen(state, seat, legal, 20);
    expect(d.action).toEqual(candidates[1]);
    expect(d.degraded).toBe(false);
    expect(client.requests.length).toBe(2);
    expect(client.requests[1]!.user).toContain('上次回复无效');
    // usage 为两次调用之和。
    expect(d.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
  });

  it('重试仍无效 → HeuristicAgent Top-1 兜底，degraded=true', async () => {
    const { state, seat, legal } = fixtureState();
    const client = new FixtureClient(makeResponse(-1), makeResponse(42));
    const d = await new LLMAgent(client, 'normal').decide(state, seat, legal);
    const fallback = await new HeuristicAgent().decide(state, seat, legal);
    expect(d.action).toEqual(fallback.action);
    expect(d.degraded).toBe(true);
    expect(d.reason).toContain('降级');
    expect(d.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
  });

  it('API 异常 → 降级兜底，reason 带异常原因，对局不卡死', async () => {
    const { state, seat, legal } = fixtureState();
    const client = new FixtureClient(new Error('boom timeout'));
    const d = await new LLMAgent(client, 'normal').decide(state, seat, legal);
    const fallback = await new HeuristicAgent().decide(state, seat, legal);
    expect(d.action).toEqual(fallback.action);
    expect(d.degraded).toBe(true);
    expect(d.reason).toContain('API 异常');
    expect(d.reason).toContain('boom timeout');
  });

  it('无合法行动时抛错', async () => {
    const { state, seat } = fixtureState();
    await expect(new LLMAgent(new FixtureClient()).decide(state, seat, [])).rejects.toThrow();
  });
});
