/**
 * 14 基础族能力锚点：每族至少 1 个行为测试（PI 能力为主，含部分基础能力）。
 * 数据面核对见 data.test.ts；这里测行为。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  enumerateActions,
  mapNeighbors,
  type Action,
  type GameConfig,
  type GameState,
  type HexKey,
} from '../src/index.js';
import { actionPhase, flushIncome, legalOf } from './helpers.js';

function rig(config: GameConfig, mutate: (s: GameState) => void): GameState {
  const s = structuredClone(actionPhase(config));
  mutate(s);
  return s;
}

function cfg(f0: string, f1 = 'lantids'): GameConfig {
  return { playerCount: 2, seed: 42, factions: [f0, f1] as GameConfig['factions'], lostFleet: true };
}

function mineHexOf(state: GameState, idx: number): HexKey {
  return (Object.keys(state.map) as HexKey[]).find(
    (k) => state.map[k]!.building?.type === 'mine' && state.map[k]!.building.player === idx,
  )!;
}

function passActionOf(state: GameState): Action {
  return legalOf(state).find((a) => a.type === 'pass')!;
}

describe('taklons / lantids / nevlas PI', () => {
  it('taklons PI：被动充能接受时 +1 power token（先拿后充）', () => {
    const state = rig(cfg('taklons', 'terrans'), (s) => {
      s.players[0]!.buildings.pi = 0;
      s.players[0]!.power.bowl1 = 2;
      s.players[0]!.power.bowl2 = 0;
      s.players[0]!.power.brainstone = 'none';
      s.pending = { kind: 'charge', queue: [{ player: 0, amount: 2, vpCost: 1 }] };
    });
    const gainedBefore = state.players[0]!.powerStats.gained;
    const next = applyAction(state, { type: 'charge' });
    const p = next.players[0]!;
    expect(p.powerStats.gained).toBe(gainedBefore + 1);
    // 先拿 token（I 区 2+1=3）再充 2（I→II 优先）：I→II 2 个
    expect(p.power.bowl1).toBe(1);
    expect(p.power.bowl2).toBe(2);
  });

  it('lantids PI：在对手星球建矿 +2k', () => {
    const state = rig(cfg('lantids', 'terrans'), (s) => {
      s.players[0]!.buildings.pi = 0;
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
      s.players[0]!.resources.qic = 10; // 补程用
    });
    const opponentMine = mineHexOf(state, 1);
    const action = legalOf(state).find(
      (a): a is Extract<Action, { type: 'build-mine' }> => a.type === 'build-mine' && a.hex === opponentMine,
    )!;
    expect(action).toBeDefined();
    const kBefore = state.players[0]!.resources.knowledge;
    const next = applyAction(state, action);
    expect(next.map[opponentMine]!.additionalMine).toBe(0);
    expect(next.players[0]!.resources.knowledge).toBe(kBefore + 2);
  });

  it('nevlas PI：III 区 token 当 2 花（pw4-q 只耗 2 token）+ 专属兑换', () => {
    const state = rig(cfg('nevlas'), (s) => {
      s.players[0]!.buildings.pi = 0;
      s.players[0]!.power.bowl3 = 2;
    });
    const action = legalOf(state).find(
      (a) => a.type === 'free-conversion' && a.conversion === 'pw4-q',
    )!;
    expect(action).toBeDefined();
    // 专属兑换 nevlas-pw4-oc 同样可枚举（2 token 当 4）
    expect(
      legalOf(state).some((a) => a.type === 'free-conversion' && a.conversion === 'nevlas-pw4-oc'),
    ).toBe(true);
    const qBefore = state.players[0]!.resources.qic;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(p.power.bowl3).toBe(0); // 2 个 token 当 4 花
    expect(p.power.bowl1).toBe(state.players[0]!.power.bowl1 + 2);
    expect(p.resources.qic).toBe(qBefore + 1);
  });

  it('nevlas PI 便利兑换：nevlas-pw2-2c 耗 1 token 得 2c（参考 freeActionsNevlasPI）', () => {
    const state = rig(cfg('nevlas'), (s) => {
      s.players[0]!.buildings.pi = 0;
      s.players[0]!.power.bowl3 = 1;
    });
    const action = legalOf(state).find(
      (a) => a.type === 'free-conversion' && a.conversion === 'nevlas-pw2-2c',
    )!;
    expect(action).toBeDefined();
    const cBefore = state.players[0]!.resources.credits;
    const next = applyAction(state, action);
    expect(next.players[0]!.power.bowl3).toBe(0); // 1 token 当 2
    expect(next.players[0]!.resources.credits).toBe(cBefore + 2);
  });
});

describe('terrans / itars PI（盖亚阶段 pending）', () => {
  /** 全员 pass 推进到下一轮，触发盖亚阶段（收入若产生 income-order 先冲刷——
   *  收入顺序决策化后，tokens+charge 的收入会先出 income-order 再到盖亚阶段）。 */
  function passRound(state: GameState): GameState {
    let s = applyAction(state, passActionOf(state));
    s = applyAction(s, passActionOf(s));
    if (s.pending?.kind === 'income-order') s = flushIncome(s);
    return s;
  }

  it('terrans PI：盖亚阶段 pending 兑换（3→1o），结束后剩余 → II 区', () => {
    const state = rig(cfg('terrans'), (s) => {
      s.players[0]!.buildings.pi = 0;
      s.players[0]!.power.gaia = 5;
    });
    let next = passRound(state);
    expect(next.pending).toEqual({ kind: 'terrans-gaia', player: 0 });
    // 兑换 3 gaia → 1o（枚举里应含 terrans-gaia-* 与 done）
    const legal = enumerateActions(next, 0);
    expect(legal.some((a) => a.type === 'free-conversion' && a.conversion === 'terrans-gaia-o')).toBe(true);
    const oreBefore = next.players[0]!.resources.ore;
    next = applyAction(next, { type: 'free-conversion', conversion: 'terrans-gaia-o' });
    expect(next.players[0]!.power.gaia).toBe(2);
    expect(next.players[0]!.resources.ore).toBe(Math.min(15, oreBefore + 1));
    expect(next.pending).toEqual({ kind: 'terrans-gaia', player: 0 }); // 兑换后可继续
    const bowl2Before = next.players[0]!.power.bowl2;
    next = applyAction(next, { type: 'terrans-gaia-done' });
    expect(next.pending).toBeNull();
    expect(next.players[0]!.power.gaia).toBe(0);
    expect(next.players[0]!.power.bowl2).toBe(bowl2Before + 2); // 剩余 → II 区（terrans 能力）
  });

  it('itars PI：盖亚阶段弃 4 换科技板（可重复），结束后剩余 → I 区', () => {
    const state = rig(cfg('itars'), (s) => {
      s.players[0]!.buildings.pi = 0;
      s.players[0]!.power.gaia = 9;
    });
    let next = passRound(state);
    expect(next.pending).toEqual({ kind: 'itars-gaia', player: 0 });
    const legal = enumerateActions(next, 0);
    const takeTech = legal.find(
      (a): a is Extract<Action, { type: 'itars-gaia-tech' }> => a.type === 'itars-gaia-tech' && a.techTile === 'tech4',
    )!;
    expect(takeTech).toBeDefined();
    const vpBefore = next.players[0]!.vp;
    next = applyAction(next, takeTech);
    expect(next.players[0]!.power.gaia).toBe(5);
    expect(next.players[0]!.techTiles).toContain('tech4');
    expect(next.players[0]!.vp).toBe(vpBefore + 7);
    expect(next.pending).toEqual({ kind: 'itars-gaia', player: 0 }); // 可重复
    const bowl1Before = next.players[0]!.power.bowl1;
    next = applyAction(next, { type: 'itars-gaia-tech', techTile: null });
    expect(next.pending).toBeNull();
    expect(next.players[0]!.power.gaia).toBe(0);
    expect(next.players[0]!.power.bowl1).toBe(bowl1Before + 5); // 剩余 → I 区
  });
});

describe('baltaks / ambas / firaks / bescods', () => {
  it('baltaks：未建 PI 禁 nav 推进，建 PI 后解锁', () => {
    const state = rig(cfg('baltaks'), (s) => {
      s.players[0]!.resources.knowledge = 8;
    });
    expect(
      legalOf(state).some((a) => a.type === 'research' && a.track === 'nav'),
    ).toBe(false);
    const state2 = rig(cfg('baltaks'), (s) => {
      s.players[0]!.resources.knowledge = 8;
      s.players[0]!.buildings.pi = 0;
    });
    expect(
      legalOf(state2).some((a) => a.type === 'research' && a.track === 'nav'),
    ).toBe(true);
  });

  it('baltaks-gf-q：gaiaformer 暂存 gaia 区换 1q', () => {
    const state = rig(cfg('baltaks'), (s) => {
      s.players[0]!.gaiaformers.total = 1;
      s.players[0]!.gaiaformers.available = 1;
    });
    const action = legalOf(state).find(
      (a) => a.type === 'free-conversion' && a.conversion === 'baltaks-gf-q',
    )!;
    expect(action).toBeDefined();
    const qBefore = state.players[0]!.resources.qic;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(p.gaiaformers.available).toBe(0);
    expect(p.gaiaformers.inGaia).toBe(1);
    expect(p.resources.qic).toBe(qBefore + 1);
  });

  it('ambas PI：交换 PI 与一个 mine 的位置（每轮一次）', () => {
    const state = rig(cfg('ambas'), (s) => {
      s.players[0]!.buildings.pi = 0;
      const mine = mineHexOf(s, 0);
      // 把一个起始矿改成 PI，保留另一个 mine
      s.map[mine]!.building = { type: 'pi', player: 0 };
    });
    const mine = mineHexOf(state, 0);
    const piHex = (Object.keys(state.map) as HexKey[]).find(
      (k) => state.map[k]!.building?.type === 'pi' && state.map[k]!.building.player === 0,
    )!;
    const action = legalOf(state).find(
      (a): a is Extract<Action, { type: 'special-action' }> =>
        a.type === 'special-action' && a.action === 'ambas-swap' && a.payload?.hex === mine,
    )!;
    expect(action).toBeDefined();
    const next = applyAction(state, action);
    expect(next.map[mine]!.building).toEqual({ type: 'pi', player: 0 });
    expect(next.map[piHex]!.building).toEqual({ type: 'mine', player: 0 });
    expect(next.players[0]!.roundAbilityUsed).toContain('ambas-swap');
    expect(
      legalOf(next).some((a) => a.type === 'special-action' && a.action === 'ambas-swap'),
    ).toBe(false);
  });

  it('firaks PI：lab 降级回 ts 并推进任意轨 1 级', () => {
    const state = rig(cfg('firaks'), (s) => {
      s.players[0]!.buildings.pi = 0;
      const mine = mineHexOf(s, 0);
      s.map[mine]!.building = { type: 'lab', player: 0 };
    });
    const labHex = (Object.keys(state.map) as HexKey[]).find(
      (k) => state.map[k]!.building?.type === 'lab' && state.map[k]!.building.player === 0,
    )!;
    const action = legalOf(state).find(
      (a): a is Extract<Action, { type: 'special-action' }> =>
        a.type === 'special-action' && a.action === 'firaks-down' && a.payload?.hex === labHex && a.payload?.track === 'sci',
    )!;
    expect(action).toBeDefined();
    const before = state.players[0]!;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(next.map[labHex]!.building).toEqual({ type: 'ts', player: 0 });
    expect(p.buildings.lab).toBe(before.buildings.lab + 1);
    expect(p.buildings.ts).toBe(before.buildings.ts - 1);
    expect(p.research.sci).toBe(before.research.sci + 1);
    expect(p.specialUsed).toContain('firaks-down');
  });

  it('firaks PI：可放弃升轨（参考 decline up）；降级的 ts 产生对手充能邀约', () => {
    const state = rig(cfg('firaks'), (s) => {
      s.players[0]!.buildings.pi = 0;
      const mine = mineHexOf(s, 0);
      s.map[mine]!.building = { type: 'lab', player: 0 };
      // 邻格放对手（玩家 1）的矿，应收 ts 的 1pw 邀约
      const nb = mapNeighbors(s.map, mine).find((k) => s.map[k]!.building === undefined)!;
      s.map[nb]!.building = { type: 'mine', player: 1 };
    });
    const labHex = (Object.keys(state.map) as HexKey[]).find(
      (k) => state.map[k]!.building?.type === 'lab' && state.map[k]!.building.player === 0,
    )!;
    // 放弃升轨变体已枚举（无 track）
    const decline = legalOf(state).find(
      (a): a is Extract<Action, { type: 'special-action' }> =>
        a.type === 'special-action' && a.action === 'firaks-down' && a.payload?.hex === labHex && a.payload?.track === undefined,
    )!;
    expect(decline).toBeDefined();
    const next = applyAction(state, decline);
    expect(next.map[labHex]!.building).toEqual({ type: 'ts', player: 0 });
    expect(next.players[0]!.research).toEqual(state.players[0]!.research); // 研究不变
    // 对手收到 ts（pv 1）的充能邀约
    expect(next.pending?.kind).toBe('charge');
    if (next.pending?.kind === 'charge') {
      expect(next.pending.queue[0]!.player).toBe(1);
      expect(next.pending.queue[0]!.amount).toBe(1);
    }
  });

  it('bescods-up：免费推进等级最低轨（每轮一次）', () => {
    const state = rig(cfg('bescods'), () => {
      // bescods 起始全 0 轨，最低轨任选
    });
    const actions = legalOf(state).filter(
      (a): a is Extract<Action, { type: 'special-action' }> =>
        a.type === 'special-action' && a.action === 'bescods-up',
    );
    expect(actions.length).toBe(7); // 6 条轨并列最低 + 1 个放弃升轨变体（参考 decline up）
    const next = applyAction(state, actions.find((a) => a.payload?.track === 'int')!);
    expect(next.players[0]!.research.int).toBe(1);
    expect(next.players[0]!.roundAbilityUsed).toContain('bescods-up');
    expect(
      legalOf(next).some((a) => a.type === 'special-action' && a.action === 'bescods-up'),
    ).toBe(false);
    // 放弃变体：研究不变但能力同样消耗
    const declined = applyAction(state, actions.find((a) => a.payload?.track === undefined)!);
    expect(declined.players[0]!.research.int).toBe(0);
    expect(declined.players[0]!.roundAbilityUsed).toContain('bescods-up');
  });
});

describe('geodens / gleens / ivits / xenos / hadsch-hallas', () => {
  it('geodens PI：首次在每种星球类型建矿 +3k', () => {
    const state = rig(cfg('geodens'), (s) => {
      s.players[0]!.buildings.pi = 0;
      s.players[0]!.resources.ore = 15;
      s.players[0]!.resources.credits = 15;
      s.players[0]!.resources.qic = 10;
    });
    // 找一个非已殖民类型的建矿目标
    const colonized = state.players[0]!.colonizedPlanetTypes;
    const action = legalOf(state).find(
      (a): a is Extract<Action, { type: 'build-mine' }> =>
        a.type === 'build-mine' && !colonized.includes(state.map[a.hex]!.planet),
    )!;
    expect(action).toBeDefined();
    const kBefore = state.players[0]!.resources.knowledge;
    const next = applyAction(state, action);
    expect(next.players[0]!.resources.knowledge).toBe(Math.min(15, kBefore + 3));
    expect(next.players[0]!.geodensTriggered).toContain(state.map[action.hex]!.planet);
  });

  it('gleens：建 QIC 学院前获得 QIC 改为等量 ore（pw4-q 得 1o）', () => {
    const state = rig(cfg('gleens'), (s) => {
      s.players[0]!.power.bowl3 = 4;
      s.players[0]!.resources.ore = 5;
    });
    const action = legalOf(state).find(
      (a) => a.type === 'free-conversion' && a.conversion === 'pw4-q',
    )!;
    const oreBefore = state.players[0]!.resources.ore;
    const qBefore = state.players[0]!.resources.qic;
    const next = applyAction(state, action);
    expect(next.players[0]!.resources.ore).toBe(oreBefore + 1);
    expect(next.players[0]!.resources.qic).toBe(qBefore);
  });

  it('ivits PI：特殊行动放空间站（pv1、射程起点、不算殖民）', () => {
    const state = rig(cfg('ivits'), () => {
      // ivits setup 已放 PI（buildings.pi===0）
    });
    expect(state.players[0]!.buildings.pi).toBe(0);
    const actions = legalOf(state).filter(
      (a): a is Extract<Action, { type: 'special-action' }> =>
        a.type === 'special-action' && a.action === 'ivits-sp',
    );
    expect(actions.length).toBeGreaterThan(0);
    const hex = actions[0]!.payload!.hex!;
    expect(state.map[hex]!.planet).toBe('empty');
    const next = applyAction(state, actions[0]!);
    const p = next.players[0]!;
    expect(next.map[hex]!.building).toEqual({ type: 'sp', player: 0 });
    expect(p.spaceStations).toBe(1);
    expect(p.colonizedPlanetTypes).toEqual(state.players[0]!.colonizedPlanetTypes); // 不算殖民
    expect(p.specialUsed).toContain('ivits-sp');
  });

  it('xenos：1o→1 power token 直接 III 区（xenos-o-t3）', () => {
    const state = rig(cfg('xenos'), (s) => {
      s.players[0]!.resources.ore = 5;
    });
    const action = legalOf(state).find(
      (a) => a.type === 'free-conversion' && a.conversion === 'xenos-o-t3',
    )!;
    expect(action).toBeDefined();
    const before = state.players[0]!;
    const next = applyAction(state, action);
    expect(next.players[0]!.resources.ore).toBe(before.resources.ore - 1);
    expect(next.players[0]!.power.bowl3).toBe(before.power.bowl3 + 1);
  });

  it('hadsch-hallas PI：4c→1q 兑换', () => {
    const state = rig(cfg('hadsch-hallas'), (s) => {
      s.players[0]!.buildings.pi = 0;
      s.players[0]!.resources.credits = 10;
    });
    const action = legalOf(state).find(
      (a) => a.type === 'free-conversion' && a.conversion === 'hadsch-c4-q',
    )!;
    expect(action).toBeDefined();
    const before = state.players[0]!;
    const next = applyAction(state, action);
    expect(next.players[0]!.resources.credits).toBe(before.resources.credits - 4);
    expect(next.players[0]!.resources.qic).toBe(before.resources.qic + 1);
  });
});
