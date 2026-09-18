/**
 * build-mine 行为锚点：terraform 费用、qic 补程、gaia 星球居住费、
 * 被动充能邀约生成与 charge/decline 响应。
 * 全部从包根公共 API 导入；场景用 structuredClone + 局部手术构造。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  colonizedHexes,
  enumerateActions,
  hexesWithin,
  mapNeighbors,
  minDistanceToAny,
  newGame,
  terraformingSteps,
  FACTIONS,
  type Action,
  type GameConfig,
  type GameState,
  type HexKey,
  type PlanetType,
} from '../src/index.js';
import { actionPhase, legalOf } from './helpers.js';

const CONFIG_2P: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'lantids'], lostFleet: true };

/** 在若干 seed 中找到满足条件的行动阶段状态与目标行动。 */
function findScenario(
  pred: (state: GameState, action: Extract<Action, { type: 'build-mine' }>) => boolean,
): { state: GameState; action: Extract<Action, { type: 'build-mine' }> } {
  for (let seed = 1; seed < 60; seed++) {
    const state = actionPhase({ ...CONFIG_2P, seed });
    const mines = legalOf(state).filter((a): a is Extract<Action, { type: 'build-mine' }> => a.type === 'build-mine');
    for (const action of mines) {
      if (pred(state, action)) {
        return { state, action };
      }
    }
  }
  throw new Error('未找到满足条件的场景');
}

/** 计算玩家 0（terrans）对目标 hex 的独立预期成本（测试侧复算，作为锚点）。 */
function expectedCost(state: GameState, hex: HexKey): { ore: number; credits: number; qic: number; steps: number; dist: number } {
  const p = state.players[0]!;
  const home = FACTIONS[p.faction].homePlanet!;
  const planet = state.map[hex]!.planet;
  const steps = planet === 'gaia' ? 0 : terraformingSteps(home, planet);
  const sources = colonizedHexes(state.map, 0);
  const dist = minDistanceToAny(state.map, sources, hex);
  const range = 1; // nav L0–1
  const boost = Math.max(0, Math.ceil((dist - range) / 2));
  const gaiaFee = planet === 'gaia' ? 1 : 0;
  return { ore: steps * 3 + 1, credits: 2, qic: boost + gaiaFee, steps, dist };
}

describe('build-mine 费用', () => {
  it('terraform 1 步：3o（L0 轨）+ 矿费 1o+2c', () => {
    const { state, action } = findScenario((s, a) => {
      const c = expectedCost(s, a.hex);
      return c.steps === 1 && c.dist <= 1 && s.map[a.hex]!.planet !== 'gaia';
    });
    const before = state.players[0]!.resources;
    const cost = expectedCost(state, action.hex);
    const next = applyAction(state, action);
    const after = next.players[0]!.resources;
    expect(before.ore - after.ore).toBe(cost.ore); // 3 + 1
    expect(before.credits - after.credits).toBe(2);
    expect(before.qic - after.qic).toBe(0);
    expect(next.map[action.hex]!.building).toEqual({ type: 'mine', player: 0 });
    expect(next.players[0]!.buildings.mine).toBe(state.players[0]!.buildings.mine - 1);
  });

  it('qic 补程：射程外目标按 ceil((dist-range)/2) 扣 qic', () => {
    const base = findScenario((s, a) => {
      const c = expectedCost(s, a.hex);
      return c.dist > 1 && s.map[a.hex]!.planet !== 'gaia';
    });
    // 手术：补足 qic 使行动可负担
    const state = structuredClone(base.state);
    state.players[0]!.resources.qic = 10;
    const cost = expectedCost(state, base.action.hex);
    expect(cost.qic).toBeGreaterThan(0);
    const legal = legalOf(state);
    expect(legal.some((a) => a.type === 'build-mine' && a.hex === base.action.hex)).toBe(true);
    const before = state.players[0]!.resources;
    const next = applyAction(state, base.action);
    const after = next.players[0]!.resources;
    expect(before.qic - after.qic).toBe(cost.qic);
    expect(before.ore - after.ore).toBe(cost.ore);
  });

  it('gaia 星球：付 1q 居住费，无 terraform 步', () => {
    const state0 = actionPhase(CONFIG_2P);
    // 手术：在 gaia 星球邻格放一个玩家 0 的矿作为射程起点
    const gaiaHex = (Object.keys(state0.map) as HexKey[]).find((k) => state0.map[k]!.planet === 'gaia')!;
    const near = mapNeighbors(state0.map, gaiaHex).find((k) => state0.map[k]!.building === undefined)!;
    const state = structuredClone(state0);
    state.map[near]!.building = { type: 'mine', player: 0 };
    const legal = legalOf(state);
    const action = legal.find(
      (a): a is Extract<Action, { type: 'build-mine' }> => a.type === 'build-mine' && a.hex === gaiaHex,
    );
    expect(action).toBeDefined();
    const before = state.players[0]!.resources;
    const next = applyAction(state, action!);
    const after = next.players[0]!.resources;
    expect(before.qic - after.qic).toBe(1);
    expect(before.ore - after.ore).toBe(1);
    expect(before.credits - after.credits).toBe(2);
    expect(next.players[0]!.colonizedPlanetTypes).toContain('gaia');
  });

  it('LF 新族 gaia 居住费：tinkeroids/moweyds 1q、darkanians/space-giants 2q（参考 gaiaFormingCost）', () => {
    const cases: { factions: GameConfig['factions']; fee: number }[] = [
      { factions: ['tinkeroids', 'moweyds'], fee: 1 },
      { factions: ['darkanians', 'space-giants'], fee: 2 },
    ];
    for (const { factions, fee } of cases) {
      let state0 = actionPhase({ playerCount: 2, seed: 42, factions, lostFleet: true });
      // tinkeroids 每轮开始须先选 Tinkering tile（pending 时无建矿枚举）
      const tink = legalOf(state0).find((a) => a.type === 'choose-tinkering');
      if (tink !== undefined) {
        state0 = applyAction(state0, tink);
      }
      const gaiaHex = (Object.keys(state0.map) as HexKey[]).find(
        (k) => state0.map[k]!.planet === 'gaia' && state0.map[k]!.ship === undefined,
      )!;
      const near = mapNeighbors(state0.map, gaiaHex).find(
        (k) => state0.map[k]!.building === undefined && state0.map[k]!.ship === undefined,
      )!;
      const state = structuredClone(state0);
      state.map[near]!.building = { type: 'mine', player: 0 };
      const action = legalOf(state).find(
        (a): a is Extract<Action, { type: 'build-mine' }> => a.type === 'build-mine' && a.hex === gaiaHex,
      );
      expect(action).toBeDefined();
      const before = state.players[0]!.resources;
      const next = applyAction(state, action!);
      expect(before.qic - next.players[0]!.resources.qic).toBe(fee);
    }
  });

  it('母星之外 2 步 terraform：6o + 矿费', () => {
    // terrans(terra) → desert/swamp 方向 2 步（terra→oxide→volcanic 或 terra→ice→titanium）
    const twoStep: PlanetType[] = ['volcanic', 'titanium'];
    const { state, action } = findScenario((s, a) => {
      const planet = s.map[a.hex]!.planet;
      const c = expectedCost(s, a.hex);
      return twoStep.includes(planet) && c.steps === 2 && c.dist <= 1;
    });
    const before = state.players[0]!.resources;
    const next = applyAction(state, action);
    expect(before.ore - next.players[0]!.resources.ore).toBe(2 * 3 + 1);
  });
});

describe('被动充能', () => {
  /** 构造：玩家 0 建矿目标 T，玩家 1 在 T 的 2 格内有 ts（pv 2）。 */
  function chargeScenario(): { state: GameState; action: Extract<Action, { type: 'build-mine' }> } {
    const { state: s0, action } = findScenario((s, a) => expectedCost(s, a.hex).dist <= 1);
    const state = structuredClone(s0);
    const spot = hexesWithin(state.map, action.hex, 2).find(
      (k) => k !== action.hex && state.map[k]!.building === undefined,
    )!;
    state.map[spot]!.building = { type: 'ts', player: 1 };
    return { state, action };
  }

  it('建矿生成邀约（最高 pv=2、vpCost=1），pending 期间回合不推进', () => {
    const { state, action } = chargeScenario();
    const next = applyAction(state, action);
    expect(next.pending).toEqual({ kind: 'charge', queue: [{ player: 1, amount: 2, vpCost: 1 }] });
    expect(next.currentPlayerIdx).toBe(0); // pending 未清空，回合不推进
    // 只有被邀约玩家有行动
    expect(enumerateActions(next, 1)).toEqual([{ type: 'charge' }, { type: 'decline-charge' }]);
    expect(enumerateActions(next, 0)).toEqual([]);
  });

  it('charge：付 1vp 充 2 power（I→II 优先），随后回合推进', () => {
    const { state, action } = chargeScenario();
    let next = applyAction(state, action);
    const vpBefore = next.players[1]!.vp;
    const pwBefore = { ...next.players[1]!.power };
    next = applyAction(next, { type: 'charge' });
    expect(next.pending).toBeNull();
    expect(next.players[1]!.vp).toBe(vpBefore - 1);
    const pwAfter = next.players[1]!.power;
    expect(pwBefore.bowl1 - pwAfter.bowl1).toBe(2); // I 区 4 枚，充 2 到 II
    expect(pwAfter.bowl2 - pwBefore.bowl2).toBe(2);
    expect(next.currentPlayerIdx).toBe(1); // 回合推进给下一位
  });

  it('decline-charge：不充不扣 vp，回合推进', () => {
    const { state, action } = chargeScenario();
    let next = applyAction(state, action);
    const vpBefore = next.players[1]!.vp;
    const pwBefore = { ...next.players[1]!.power };
    next = applyAction(next, { type: 'decline-charge' });
    expect(next.pending).toBeNull();
    expect(next.players[1]!.vp).toBe(vpBefore);
    expect(next.players[1]!.power).toEqual(pwBefore);
    expect(next.currentPlayerIdx).toBe(1);
  });

  it('charge 时 vp 不足：按可付的最大充（VP 不能为负）', () => {
    const { state, action } = chargeScenario();
    let next = applyAction(state, action);
    next = structuredClone(next);
    next.players[1]!.vp = 0; // 手术：vp 为 0，最多免费充 1
    next = applyAction(next, { type: 'charge' });
    expect(next.players[1]!.vp).toBe(0);
    expect(next.players[1]!.power.bowl2).toBe(state.players[1]!.power.bowl2 + 1);
  });
});

describe('合法性框架', () => {
  it('非法行动抛 IllegalActionError（不在枚举集内）', () => {
    const state = actionPhase(CONFIG_2P);
    expect(() => applyAction(state, { type: 'build-mine', hex: '99,99' })).toThrowError(
      expect.objectContaining({ code: 'illegal-action' }) as Error,
    );
    // 无 pending 时的响应行动同样非法
    expect(() => applyAction(state, { type: 'charge' })).toThrowError(
      expect.objectContaining({ code: 'illegal-action' }) as Error,
    );
    // 第 1 轮 pass 不带助推器（第 6 轮才允许 null）同样非法
    expect(() => applyAction(state, { type: 'pass', booster: null })).toThrowError(
      expect.objectContaining({ code: 'illegal-action' }) as Error,
    );
  });

  it('newGame 确定性：行动序列重放终态一致（详见 replay.test）', () => {
    const a = actionPhase(CONFIG_2P);
    const b = actionPhase(CONFIG_2P);
    expect(a).toEqual(b);
  });
});
