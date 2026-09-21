/**
 * 研究板 power/qic 行动 + 特殊行动锚点：每格每轮限 1 次、免费 terraform
 * 步建矿、qic 三板（拿板/重结算/计分）、tech9/ac2/booster 特殊格。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  enumerateActions,
  type Action,
  type GameConfig,
  type GameState,
} from '../src/index.js';
import { actionPhase, legalOf } from './helpers.js';

const CONFIG_2P: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'lantids'], lostFleet: true };

function rig(mutate: (s: GameState) => void, config: GameConfig = CONFIG_2P): GameState {
  const s = structuredClone(actionPhase(config));
  mutate(s);
  return s;
}

function boardActionsOf(state: GameState): Extract<Action, { type: 'power-action' | 'qic-action' }>[] {
  return legalOf(state).filter(
    (a): a is Extract<Action, { type: 'power-action' | 'qic-action' }> =>
      a.type === 'power-action' || a.type === 'qic-action',
  );
}

function specialsOf(state: GameState): Extract<Action, { type: 'special-action' }>[] {
  return legalOf(state).filter((a): a is Extract<Action, { type: 'special-action' }> => a.type === 'special-action');
}

describe('研究板 power 行动', () => {
  it('power1：7pw→3k；每格每轮全场 1 次', () => {
    const state = rig((s) => {
      s.players[0]!.power.bowl1 = 0;
      s.players[0]!.power.bowl2 = 0;
      s.players[0]!.power.bowl3 = 7;
    });
    const action = boardActionsOf(state).find((a) => a.action === 'power1')!;
    expect(action).toBeDefined();
    const before = state.players[0]!;
    const kBefore = before.resources.knowledge;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(p.resources.knowledge).toBe(kBefore + 3);
    expect(p.power.bowl3).toBe(0); // 7pw 从 III→I
    expect(p.power.bowl1).toBe(7);
    expect(next.board.boardActionsUsed).toContain('power1');
    // 同轮不再枚举（对双方都不枚举）
    expect(boardActionsOf(next).some((a) => a.action === 'power1')).toBe(false);
    expect(
      enumerateActions(next, 1).filter(
        (a) => (a.type === 'power-action' || a.type === 'qic-action') && a.action === 'power1',
      ),
    ).toHaveLength(0);
  });

  it('power6：3pw 建矿（1 免费 terraform 步——步费免、矿费照付）', () => {
    // terrans 在 1 步星球（如 oxide）邻格建矿：免费步抵消 1 步，只付 1o+2c。
    const state = rig((s) => {
      s.players[0]!.power.bowl1 = 0;
      s.players[0]!.power.bowl2 = 0;
      s.players[0]!.power.bowl3 = 3;
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
    });
    const actions = boardActionsOf(state).filter((a) => a.action === 'power6');
    // 找一个 1 步目标的（母星 terra 的邻居星球类型 1 步）
    const oneStep = actions.find((a) => {
      const planet = state.map[a.payload!.hex!]!.planet;
      return planet === 'oxide' || planet === 'ice';
    });
    expect(oneStep).toBeDefined();
    const before = state.players[0]!;
    const next = applyAction(state, oneStep!);
    const p = next.players[0]!;
    expect(before.resources.ore - p.resources.ore).toBe(1); // 只收矿费，terraform 步免费
    expect(before.resources.credits - p.resources.credits).toBe(2);
    expect(next.map[oneStep!.payload!.hex!]!.building).toEqual({ type: 'mine', player: 0 });
    expect(next.board.boardActionsUsed).toContain('power6');
  });

  it('power2：5pw 建矿（2 免费步）', () => {
    const state = rig((s) => {
      s.players[0]!.power.bowl1 = 0;
      s.players[0]!.power.bowl2 = 0;
      s.players[0]!.power.bowl3 = 5;
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
    });
    const actions = boardActionsOf(state).filter((a) => a.action === 'power2');
    // 2 步目标（volcanic/titanium 对 terrans）：2 免费步全免
    const twoStep = actions.find((a) => {
      const planet = state.map[a.payload!.hex!]!.planet;
      return planet === 'volcanic' || planet === 'titanium';
    });
    expect(twoStep).toBeDefined();
    const before = state.players[0]!;
    const next = applyAction(state, twoStep!);
    expect(before.resources.ore - next.players[0]!.resources.ore).toBe(1);
  });
});

describe('研究板 qic 行动（lostFleet=false：LF 中 QIC 格被覆盖板盖住）', () => {
  // 纯基础游戏配置（LF 下 qic1-3 不可用，由飞船行动格替代，见 lostfleet.test.ts）。
  const CONFIG_BASE: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'lantids'], lostFleet: false };
  it('qic1：4q 拿科技板（入手、供应-1、一次性效果）', () => {
    const state = rig((s) => {
      s.players[0]!.resources.qic = 4;
    }, CONFIG_BASE);
    const action = boardActionsOf(state).find((a) => a.action === 'qic1' && a.payload?.techTile === 'tech4')!;
    expect(action).toBeDefined();
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(p.resources.qic).toBe(0);
    expect(p.techTiles).toContain('tech4');
    expect(next.board.techTiles['tech4']).toBe(state.board.techTiles['tech4']! - 1);
    expect(p.vp).toBe(vpBefore + 7);
  });

  it('qic2：3q 重结算自己一枚联邦标记（不翻回）', () => {
    const state = rig((s) => {
      s.players[0]!.resources.qic = 3;
      s.players[0]!.federationTokens.push({ id: 'fed5', flipped: false });
    }, CONFIG_BASE);
    const action = boardActionsOf(state).find((a) => a.action === 'qic2' && a.payload?.federationToken === 'fed5')!;
    expect(action).toBeDefined();
    const before = state.players[0]!;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(p.vp).toBe(before.vp + 7); // fed5 = 7vp+6c
    expect(p.resources.credits).toBe(Math.min(30, before.resources.credits + 6));
    expect(p.federationTokens[0]!.flipped).toBe(false); // 不翻回
  });

  it('qic3：2q → 3vp + 每殖民星球类型 1vp', () => {
    const state = rig((s) => {
      s.players[0]!.resources.qic = 2;
    }, CONFIG_BASE);
    const action = boardActionsOf(state).find((a) => a.action === 'qic3')!;
    const types = state.players[0]!.colonizedPlanetTypes.length;
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, action);
    expect(next.players[0]!.vp).toBe(vpBefore + 3 + types);
  });
});

describe('特殊行动', () => {
  it('tech9：充能 4pw；每轮 1 次', () => {
    const state = rig((s) => {
      s.players[0]!.techTiles.push('tech9');
      s.players[0]!.power.bowl1 = 4;
      s.players[0]!.power.bowl2 = 0;
      s.players[0]!.power.bowl3 = 0;
    });
    const action = specialsOf(state).find((a) => a.action === 'tech9')!;
    expect(action).toBeDefined();
    const next = applyAction(state, action);
    const p = next.players[0]!;
    // 充能 4（I→II 优先：I 全转完才能 II→III）：I 4 全到 II
    expect(p.power.bowl1).toBe(0);
    expect(p.power.bowl2).toBe(4);
    expect(p.power.bowl3).toBe(0);
    expect(p.specialUsed).toContain('tech9');
    expect(specialsOf(next).some((a) => a.action === 'tech9')).toBe(false);
  });

  it('ac2：+1q（baltaks 为 +4c）', () => {
    const state = rig((s) => {
      s.players[0]!.buildings.ac2 = 0; // 已建 QIC 学院
    });
    const action = specialsOf(state).find((a) => a.action === 'ac2')!;
    expect(action).toBeDefined();
    const qBefore = state.players[0]!.resources.qic;
    const next = applyAction(state, action);
    expect(next.players[0]!.resources.qic).toBe(qBefore + 1);

    const config: GameConfig = { playerCount: 2, seed: 42, factions: ['baltaks', 'lantids'], lostFleet: true };
    const state2 = rig((s) => {
      s.players[0]!.buildings.ac2 = 0;
    }, config);
    const action2 = specialsOf(state2).find((a) => a.action === 'ac2')!;
    const cBefore = state2.players[0]!.resources.credits;
    const next2 = applyAction(state2, action2);
    expect(next2.players[0]!.resources.credits).toBe(cBefore + 4);
  });

  it('booster4：特殊格建矿（1 免费步）', () => {
    const state = rig((s) => {
      s.players[0]!.booster = 'booster4';
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
    });
    const actions = specialsOf(state).filter((a) => a.action === 'booster4');
    expect(actions.length).toBeGreaterThan(0);
    const oneStep = actions.find((a) => {
      const planet = state.map[a.payload!.hex!]!.planet;
      return planet === 'oxide' || planet === 'ice';
    })!;
    const before = state.players[0]!;
    const next = applyAction(state, oneStep);
    expect(before.resources.ore - next.players[0]!.resources.ore).toBe(1);
    expect(next.players[0]!.specialUsed).toContain('booster4');
  });

  it('booster5：射程 +3 建矿（远处目标可行）', () => {
    const state = rig((s) => {
      s.players[0]!.booster = 'booster5';
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
    });
    // 基本射程 1；booster5 射程 4 内的目标应出现
    const actions = specialsOf(state).filter((a) => a.action === 'booster5');
    expect(actions.length).toBeGreaterThan(0);
    // 普通 build-mine 射程外的目标也可经 booster5 到达（qic 补程另计，这里只断言枚举变多）
    const normalMines = legalOf(state).filter((a) => a.type === 'build-mine').length;
    expect(actions.length).toBeGreaterThanOrEqual(normalMines);
  });
});
