/**
 * 启发式内核测试：scoreAction 棋理锚点、prescreen topK、HeuristicAgent 确定性。
 * 局面来自 test/helpers.ts playUntil（真实对局推进，不手搓 GameState）。
 */
import { describe, expect, it } from 'vitest';
import { enumerateActions, newGame } from '@gaia/engine';
import { HeuristicAgent, prescreen, scoreAction } from '../src/heuristic.js';
import { playUntil } from './helpers.js';

describe('scoreAction 锚点', () => {
  it('setup 首个起始矿：terrans 首选母星类型（0 terraform 步）', () => {
    const state = newGame({ playerCount: 2, seed: 7, factions: ['terrans', 'xenos'], lostFleet: true });
    const seat = state.setupQueue[0]!;
    const legal = enumerateActions(state, seat);
    const top = prescreen(state, seat, legal, 1)[0]!;
    expect(top.type).toBe('place-initial-mine');
    if (top.type === 'place-initial-mine') {
      expect(state.map[top.hex]?.planet).toBe('terra');
    }
  });

  it('拿板升级 > 裸 pass（第 6 轮 booster=null 的 pass 显著负分）', () => {
    // 行动阶段且有"升 lab/PI/学院拿板"候选的局面。
    const { state, actor, legal } = playUntil((s, _a, legal) => {
      if (s.phase !== 'action') return false;
      return legal.some(
        (a) => a.type === 'upgrade' && (a.to === 'lab' || a.to === 'pi' || a.to === 'ac1' || a.to === 'ac2'),
      );
    });
    const upgrades = legal.filter((a) => a.type === 'upgrade');
    const bestUpgrade = Math.max(...upgrades.map((a) => scoreAction(state, actor, a)));
    const barePass = scoreAction(state, actor, { type: 'pass', booster: null });
    expect(bestUpgrade).toBeGreaterThan(barePass);
  });

  it('有矿可建时最优 build-mine > burn（烧脑恒为负）', () => {
    const { state, actor, legal } = playUntil(
      (s, _a, legal) => s.phase === 'action' && legal.some((a) => a.type === 'build-mine'),
    );
    const mines = legal.filter((a) => a.type === 'build-mine');
    const bestMine = Math.max(...mines.map((a) => scoreAction(state, actor, a)));
    expect(bestMine).toBeGreaterThan(scoreAction(state, actor, { type: 'burn' }));
  });

  it('charge：amount=1（vpCost=0）接受优于拒绝；amount≥3 拒绝优于接受', () => {
    const low = playUntil(
      (s) => s.pending?.kind === 'charge' && s.pending.queue[0]!.vpCost === 0,
    );
    const acceptLow = scoreAction(low.state, low.actor, { type: 'charge' });
    expect(acceptLow).toBeGreaterThan(scoreAction(low.state, low.actor, { type: 'decline-charge' }));

    // vpCost≥2（amount≥3，PI/学院在对手建造 2 格内）单局难遇：跨种子搜索。
    let high: ReturnType<typeof playUntil> | null = null;
    for (let seed = 1; seed <= 40 && high === null; seed++) {
      try {
        high = playUntil(
          (s) => s.pending?.kind === 'charge' && s.pending.queue[0]!.vpCost >= 2,
          { seed },
        );
      } catch {
        // 该种子局内未出现，试下一种子
      }
    }
    expect(high).not.toBeNull();
    const acceptHigh = scoreAction(high!.state, high!.actor, { type: 'charge' });
    expect(acceptHigh).toBeLessThan(scoreAction(high!.state, high!.actor, { type: 'decline-charge' }));
  });

  it('免费兑换一般负分（q-o 换矿亏），pw1-c 微正', () => {
    const { state, actor } = playUntil((s) => s.phase === 'action');
    const qToOre = scoreAction(state, actor, { type: 'free-conversion', conversion: 'q-o' });
    expect(qToOre).toBeLessThan(0);
    const pwToCredit = scoreAction(state, actor, { type: 'free-conversion', conversion: 'pw1-c' });
    expect(pwToCredit).toBeGreaterThan(0);
  });
});

describe('prescreen', () => {
  it('按 scoreAction 降序取 Top K，并列确定性', () => {
    const { state, actor, legal } = playUntil((s) => s.phase === 'action');
    const k = 5;
    const top = prescreen(state, actor, legal, k);
    expect(top.length).toBe(Math.min(k, legal.length));
    const scores = top.map((a) => scoreAction(state, actor, a));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]!).toBeGreaterThanOrEqual(scores[i]!);
    }
    // 被截掉的都不高于 Top K 末位。
    const cut = legal.filter((a) => !top.includes(a));
    for (const a of cut) {
      expect(scoreAction(state, actor, a)).toBeLessThanOrEqual(scores[scores.length - 1]!);
    }
    // 确定性：同输入同输出（逐字节）。
    expect(prescreen(state, actor, legal, k)).toEqual(top);
  });

  it('k 超出 legal 长度时返回全部（仍按分排序）', () => {
    const { state, actor, legal } = playUntil((s) => s.phase === 'action');
    const all = prescreen(state, actor, legal, legal.length + 10);
    expect(all.length).toBe(legal.length);
  });
});

describe('HeuristicAgent', () => {
  it('确定性：同局面两次决策一致，且等于 prescreen Top-1', async () => {
    const { state, actor, legal } = playUntil((s) => s.phase === 'action');
    const agent = new HeuristicAgent();
    const d1 = await agent.decide(state, actor, legal);
    const d2 = await agent.decide(state, actor, legal);
    expect(d1.action).toEqual(d2.action);
    expect(d1.action).toEqual(prescreen(state, actor, legal, 1)[0]);
    expect(d1.degraded).toBe(true);
    expect(d1.reason).toContain('score=');
  });

  it('无合法行动时抛错', async () => {
    const { state, actor } = playUntil((s) => s.phase === 'action');
    await expect(new HeuristicAgent().decide(state, actor, [])).rejects.toThrow();
  });
});
