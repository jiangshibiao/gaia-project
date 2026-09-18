/**
 * 启发式边界场景测试：联邦组建、L5 翻面、盖亚计划时机、飞船行动格、
 * Tinkering tile 估值、decide 健壮性（畸形行动兜底 + 全局面不抛异常）。
 * 局面来自 helpers.playUntil（真实对局推进）；偏好断言用构造行动（scoreAction
 * 是纯函数，不要求行动合法）。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  enumerateActions,
  newGame,
  settleSetupSkips,
  stableStringify,
  type Action,
  type GameConfig,
  type GameState,
  type HexKey,
  type PlayerIndex,
} from '@gaia/engine';
import { HeuristicAgent, prescreen, scoreAction } from '../src/heuristic.js';
import { playUntil } from './helpers.js';

/** 裸 pass 分数对照（第 6 轮外任何局面都应显著为负）。 */
function barePassScore(state: GameState, actor: PlayerIndex): number {
  return scoreAction(state, actor, { type: 'pass', booster: null });
}

describe('边界场景棋理', () => {
  it('联邦组建：能组时优于裸 pass；同形状高收益标记优先、卫星越少越好', () => {
    // 真实局面：能组联邦时最佳联邦 > 裸 pass（seed=1 第 3 轮命中）。
    const { state, actor, legal } = playUntil(
      (s, _a, l) => s.phase === 'action' && l.some((a) => a.type === 'form-federation'),
      { seed: 1 },
    );
    const feds = legal.filter((a) => a.type === 'form-federation');
    const bestFed = Math.max(...feds.map((a) => scoreAction(state, actor, a)));
    expect(bestFed).toBeGreaterThan(barePassScore(state, actor));

    // 构造行动：同形状下 fed1（12vp）> fed6（6vp+2k）；多卫星 < 少卫星。
    const shape = { hexes: ['1A1' as HexKey, '1A2' as HexKey], satellites: [] as HexKey[] };
    const fed1 = scoreAction(state, actor, { type: 'form-federation', ...shape, token: 'fed1' });
    const fed6 = scoreAction(state, actor, { type: 'form-federation', ...shape, token: 'fed6' });
    expect(fed1).toBeGreaterThan(fed6);
    const withSat = scoreAction(state, actor, {
      type: 'form-federation',
      ...shape,
      satellites: ['9Z9' as HexKey, '9Z8' as HexKey],
      token: 'fed1',
    });
    expect(withSat).toBeLessThan(fed1);
  });

  it('L5 研究：必带翻面标记，且优先翻低价值标记（fed6 先于 fed2）', () => {
    // 真实局面（seed=2 第 6 轮命中）：枚举个数 >0 且全部带 flipToken；最佳 L5 > 裸 pass。
    const { state, actor, legal } = playUntil(
      (_s, _a, l) => l.some((a) => a.type === 'research' && a.flipToken !== undefined),
      { seed: 2 },
    );
    const l5 = legal.filter((a) => a.type === 'research' && a.flipToken !== undefined);
    expect(l5.length).toBeGreaterThan(0);
    const best = Math.max(...l5.map((a) => scoreAction(state, actor, a)));
    expect(best).toBeGreaterThan(barePassScore(state, actor));

    // 构造行动：同一轨升 L5，翻 fed6（6vp+2k）比翻 fed2（8vp+1q）代价小。
    const { state: s2, actor: a2 } = playUntil((s) => s.phase === 'action');
    const flipFed6 = scoreAction(s2, a2, { type: 'research', track: 'sci', flipToken: 'fed6' });
    const flipFed2 = scoreAction(s2, a2, { type: 'research', track: 'sci', flipToken: 'fed2' });
    expect(flipFed6).toBeGreaterThan(flipFed2);
  });

  it('盖亚计划：gaiaformer 可用且非末轮时优于裸 pass', () => {
    const { state, actor, legal } = playUntil(
      (s, _a, l) => s.phase === 'action' && s.round < 6 && l.some((a) => a.type === 'start-gaia-project'),
      { seed: 1 },
    );
    const projects = legal.filter((a) => a.type === 'start-gaia-project');
    const best = Math.max(...projects.map((a) => scoreAction(state, actor, a)));
    expect(best).toBeGreaterThan(barePassScore(state, actor));
  });

  it('探索飞船后：飞船行动格可用时优于裸 pass', () => {
    const { state, actor, legal } = playUntil(
      (_s, _a, l) => l.some((a) => a.type === 'ship-action'),
      { seed: 1 },
    );
    expect(state.players[actor]!.exploredShips.length).toBeGreaterThan(0);
    const shipActions = legal.filter((a) => a.type === 'ship-action');
    const best = Math.max(...shipActions.map((a) => scoreAction(state, actor, a)));
    expect(best).toBeGreaterThan(barePassScore(state, actor));
  });

  it('Tinkering tile：建矿类 > 资源类 > 充能类', () => {
    const { state, actor } = playUntil((s) => s.phase === 'action');
    const v = (tile: 'tink1' | 'tink2' | 'tink3' | 'tink4' | 'tink5' | 'tink6'): number =>
      scoreAction(state, actor, { type: 'choose-tinkering', tile });
    expect(v('tink4')).toBeGreaterThan(v('tink5')); // 3 免费步建矿 > +3k
    expect(v('tink5')).toBeGreaterThan(v('tink1')); // +3k > 1 免费步建矿
    expect(v('tink1')).toBeGreaterThan(v('tink3')); // 建矿 > +1q
    expect(v('tink3')).toBeGreaterThan(v('tink2')); // +1q > 充能 4pw
  });
});

describe('健壮性', () => {
  it('decide 对混入畸形行动的 legal 不抛异常，且仍选合法行动', async () => {
    const { state, actor, legal } = playUntil((s) => s.phase === 'action');
    // 缺 hexes/satellites/token 的畸形行动：评分必抛 TypeError。
    const malformed = { type: 'form-federation' } as unknown as Action;
    const mixed = [malformed, ...legal];
    const d = await new HeuristicAgent().decide(state, actor, mixed);
    expect(d.action).not.toBe(malformed);
    expect(legal).toContainEqual(d.action);
    // prescreen 同样不抛。
    expect(prescreen(state, actor, mixed, 3)).toHaveLength(3);
  });

  /** 当前应行动的玩家（与 helpers/bench 同口径）。 */
  function actingPlayer(state: GameState): PlayerIndex {
    const pending = state.pending;
    if (pending !== null) {
      return pending.kind === 'charge' ? pending.queue[0]!.player : pending.player;
    }
    return state.phase === 'setup' ? state.setupQueue[0]! : state.currentPlayerIdx;
  }

  /** 全 heuristic 座位整局驱动：每步断言 decide 返回 legal 内行动。 */
  async function driveAllHeuristic(config: GameConfig): Promise<GameState> {
    let state = newGame(config);
    const agent = new HeuristicAgent();
    let steps = 0;
    while (state.phase !== 'game-over') {
      const actor = actingPlayer(state);
      const legal = enumerateActions(state, actor);
      if (legal.length === 0) {
        const settled = settleSetupSkips(state);
        if (settled !== state) {
          state = settled;
          continue;
        }
        throw new Error(`no legal actions (step ${steps})`);
      }
      const d = await agent.decide(state, actor, legal);
      const inLegal = legal.some((a) => a === d.action || stableStringify(a) === stableStringify(d.action));
      expect(inLegal).toBe(true);
      state = applyAction(state, d.action);
      if (++steps > 20_000) throw new Error('超出步数上限未终局');
    }
    return state;
  }

  it('全局面不抛异常且正常终局（基础/LF 新族/特殊族多组合）', async () => {
    const configs: GameConfig[] = [
      // 基础 2 人
      { playerCount: 2, seed: 11, factions: ['terrans', 'xenos'], lostFleet: false },
      // LF 4 新族（tinkering/ring/特殊建矿/darkanians 全覆盖）
      { playerCount: 4, seed: 12, factions: ['tinkeroids', 'moweyds', 'darkanians', 'space-giants'], lostFleet: true },
      // ivits 空间站 / hadsch PI 兑换 / nevlas 兑换 / geodens 被动
      { playerCount: 4, seed: 13, factions: ['ivits', 'hadsch-hallas', 'nevlas', 'geodens'], lostFleet: true },
      // baltaks gf 兑换 / firaks 降级 / bescods 升轨
      { playerCount: 3, seed: 14, factions: ['baltaks', 'firaks', 'bescods'], lostFleet: true },
    ];
    for (const config of configs) {
      const final = await driveAllHeuristic(config);
      expect(final.phase).toBe('game-over');
      expect(final.winner).not.toBeNull();
      expect(final.round).toBe(6);
    }
  }, 120_000);
});
