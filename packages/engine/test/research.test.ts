/**
 * research 行为锚点：4k 升级、L3 充能、L5 翻联邦标记与每轨限 1 人、
 * Terraforming L5 预设标记、Navigation L5 Lost Planet、score2 触发。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  FEDERATION_TOKENS,
  type Action,
  type GameConfig,
  type GameState,
} from '../src/index.js';
import { actionPhase, legalOf } from './helpers.js';

const CONFIG_2P: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'lantids'], lostFleet: true };

/** 行动阶段状态 + 玩家 0 研究/资源手术。 */
function rig(mutate: (s: GameState) => void): GameState {
  const s = structuredClone(actionPhase(CONFIG_2P));
  mutate(s);
  return s;
}

function researchActions(state: GameState): Extract<Action, { type: 'research' }>[] {
  return legalOf(state).filter((a): a is Extract<Action, { type: 'research' }> => a.type === 'research');
}

describe('research 升级', () => {
  it('4k 升 1 级；升 L3 充能 3pw（I→II 优先、I 空 II→III）；score2 触发 +2vp', () => {
    const state = rig((s) => {
      s.players[0]!.research.terra = 2;
      s.players[0]!.resources.knowledge = 8;
      s.players[0]!.power.bowl1 = 2;
      s.players[0]!.power.bowl2 = 0;
      s.players[0]!.power.bowl3 = 0;
      s.board.roundScoring[s.round - 1] = 'score2';
    });
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, { type: 'research', track: 'terra' });
    const p = next.players[0]!;
    expect(p.research.terra).toBe(3);
    expect(p.resources.knowledge).toBe(4);
    // 充能 3：I 区 2 → II，再 II→III 1
    expect(p.power.bowl1).toBe(0);
    expect(p.power.bowl2).toBe(1);
    expect(p.power.bowl3).toBe(1);
    expect(p.vp).toBe(vpBefore + 2); // score2：研究 +2vp
  });

  it('升 L5 需翻绿面联邦标记；每轨限 1 人', () => {
    const state = rig((s) => {
      s.players[0]!.research.sci = 4;
      s.players[0]!.resources.knowledge = 8;
      s.players[0]!.federationTokens.push({ id: 'fed2', flipped: false });
    });
    const actions = researchActions(state);
    const l5 = actions.find((a) => a.track === 'sci');
    expect(l5).toBeDefined();
    expect(l5!.flipToken).toBe('fed2');
    const next = applyAction(state, l5!);
    const p = next.players[0]!;
    expect(p.research.sci).toBe(5);
    expect(p.federationTokens[0]!.flipped).toBe(true);
    expect(next.board.researchLevel5.sci).toBe(0);
    expect(p.resources.knowledge).toBe(Math.min(15, 4 + 9)); // sci L5 一次性 +9k
  });

  it('无绿面联邦标记时 L5 不枚举', () => {
    const state = rig((s) => {
      s.players[0]!.research.sci = 4;
      s.players[0]!.resources.knowledge = 8;
    });
    expect(researchActions(state).some((a) => a.track === 'sci')).toBe(false);
    // 其它 <4 的轨仍正常枚举
    expect(researchActions(state).some((a) => a.track === 'nav')).toBe(true);
  });

  it('该轨已有人 L5 时不再枚举', () => {
    const state = rig((s) => {
      s.players[0]!.research.sci = 4;
      s.players[0]!.resources.knowledge = 8;
      s.players[0]!.federationTokens.push({ id: 'fed2', flipped: false });
      s.board.researchLevel5.sci = 1;
    });
    expect(researchActions(state).some((a) => a.track === 'sci')).toBe(false);
  });

  it('Terraforming L5：拿预设联邦标记（绿面、立即得奖励）', () => {
    const state = rig((s) => {
      s.players[0]!.research.terra = 4;
      s.players[0]!.resources.knowledge = 8;
      s.players[0]!.federationTokens.push({ id: 'fed2', flipped: false });
    });
    const preset = state.board.terraformingL5Token!;
    const def = FEDERATION_TOKENS[preset];
    const vpBefore = state.players[0]!.vp;
    const action = researchActions(state).find((a) => a.track === 'terra')!;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(p.research.terra).toBe(5);
    expect(next.board.terraformingL5Token).toBeNull();
    expect(p.federationTokens).toContainEqual({ id: preset, flipped: false, fromTerraformingL5: true });
    // 标记 vp + 其它即时奖励（score4 若在场另计，这里只断言下限）
    expect(p.vp).toBeGreaterThanOrEqual(vpBefore + def.vp);
  });

  it('Navigation L5：放 Lost Planet（卫星标记、独立星球类型、算建矿触发充能）', () => {
    const state = rig((s) => {
      s.players[0]!.research.nav = 4;
      s.players[0]!.resources.knowledge = 8;
      s.players[0]!.federationTokens.push({ id: 'fed2', flipped: false });
    });
    const actions = researchActions(state).filter((a) => a.track === 'nav');
    expect(actions.length).toBeGreaterThan(0);
    for (const a of actions) {
      expect(a.hex).toBeDefined();
      expect(state.map[a.hex!]!.planet).toBe('empty');
    }
    const action = actions[0]!;
    const hexKey = action.hex!;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(p.research.nav).toBe(5);
    expect(next.map[hexKey]!.planet).toBe('lost');
    expect(next.map[hexKey]!.satelliteOf).toBe(0);
    expect(next.map[hexKey]!.building).toBeUndefined(); // 不放矿结构
    // Lost Planet 不占卫星计数（参考引擎：放置视为矿但 data.satellites 不变）
    expect(p.satellites).toBe(state.players[0]!.satellites);
    expect(p.lostPlanetPlaced).toBe(true);
    expect(p.colonizedPlanetTypes).toContain('lost');
  });

  it('knowledge 不足 4 时不枚举 research', () => {
    const state = rig((s) => {
      s.players[0]!.resources.knowledge = 3;
    });
    expect(researchActions(state)).toHaveLength(0);
  });
});
