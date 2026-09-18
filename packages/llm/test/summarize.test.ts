/**
 * 局势摘要测试：关键字段齐备、候选描述可读、prompt 卫生不变式
 * （昵称/日志原文永不进 prompt）。
 */
import { describe, expect, it } from 'vitest';
import { enumerateActions, newGame } from '@gaia/engine';
import {
  SYSTEM_PROMPT,
  buildDecisionPrompt,
  describeAction,
  lookaheadSection,
  summarizeState,
} from '../src/summarize.js';
import { playUntil } from './helpers.js';

function setupState() {
  return newGame({ playerCount: 2, seed: 42, factions: ['terrans', 'xenos'], lostFleet: true });
}

describe('summarizeState', () => {
  it('包含轮次/计分板/自己/对手关键字段', () => {
    const state = setupState();
    const text = summarizeState(state, 0);
    expect(text).toContain('第1/6轮');
    expect(text).toContain('【回合计分板】');
    expect(text).toContain('【终局计分板】');
    expect(text).toContain('【你 P0】Terrans');
    expect(text).toContain('power:I区');
    expect(text).toContain('【对手】P1:Xenos');
    expect(text).toContain('【己方建筑分布】');
    expect(text).toContain('【飞船】'); // lostFleet: true
  });

  it('行动阶段摘要含研究与建筑信息', () => {
    const { state, actor } = playUntil((s) => s.phase === 'action');
    const text = summarizeState(state, actor);
    expect(text).toContain('【你的面板】研究:');
    expect(text).toContain('【你的单位】建筑:');
    expect(text).toContain('【行动格】');
  });

  it('未知座位抛 RangeError', () => {
    expect(() => summarizeState(setupState(), 9)).toThrow(RangeError);
  });
});

describe('describeAction', () => {
  it('setup 与行动阶段全部合法行动都有一句话中文描述（无 undefined）', () => {
    const state = setupState();
    const seat = state.setupQueue[0]!;
    for (const a of enumerateActions(state, seat)) {
      const d = describeAction(state, seat, a);
      expect(d.length).toBeGreaterThan(0);
      expect(d).not.toContain('undefined');
    }
    const { state: s2, actor, legal } = playUntil((s) => s.phase === 'action');
    for (const a of legal) {
      const d = describeAction(s2, actor, a);
      expect(d.length).toBeGreaterThan(0);
      expect(d).not.toContain('undefined');
    }
  });

  it('build-mine 描述含费用与星球类型', () => {
    const { state, actor, legal } = playUntil(
      (s, _a, l) => s.phase === 'action' && l.some((a) => a.type === 'build-mine'),
    );
    const mine = legal.find((a) => a.type === 'build-mine')!;
    const d = describeAction(state, actor, mine);
    expect(d).toContain('建矿');
    expect(d).toContain('费1o+2c');
  });
});

describe('prompt 卫生不变式', () => {
  it('昵称与日志原文永不进 prompt', () => {
    const { state, actor, legal } = playUntil((s) => s.phase === 'action');
    // 注入标记串：日志（lastEvents）与伪造昵称字段（server 层数据，模拟污染）。
    state.lastEvents.push('SECRET-NICKNAME');
    (state.players[actor] as unknown as Record<string, unknown>)['nickname'] = 'SECRET-NICKNAME';
    const candidates = legal.slice(0, 5).map((action) => ({
      action,
      description: describeAction(state, actor, action),
    }));
    const { system, user } = buildDecisionPrompt(state, actor, candidates);
    expect(user).not.toContain('SECRET-NICKNAME');
    expect(system).not.toContain('SECRET-NICKNAME');
    expect(summarizeState(state, actor)).not.toContain('SECRET-NICKNAME');
  });
});

describe('buildDecisionPrompt', () => {
  it('system 完全静态；user 含 0-based 编号候选；lookahead 按需附加', () => {
    const { state, actor, legal } = playUntil((s) => s.phase === 'action');
    const candidates = legal.slice(0, 3).map((action) => ({
      action,
      description: describeAction(state, actor, action),
    }));
    const plain = buildDecisionPrompt(state, actor, candidates);
    expect(plain.system).toBe(SYSTEM_PROMPT);
    expect(plain.user).toContain('0. ');
    expect(plain.user).toContain('1. ');
    expect(plain.user).not.toContain('【前瞻');
    const withLookahead = buildDecisionPrompt(state, actor, candidates, { lookahead: true });
    expect(withLookahead.user).toContain('【前瞻');
    expect(lookaheadSection(state)).toContain(`当前第${state.round}/6轮`);
  });
});
