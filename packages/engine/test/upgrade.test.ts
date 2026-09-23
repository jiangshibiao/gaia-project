/**
 * upgrade 行为锚点：升级链费用、邻近对手折扣、建筑 supply 往返、
 * 升 lab/学院拿科技板（标准/高级/覆盖/升轨）、PI 解锁（gleens 标记）、
 * bescods 链、升级触发器与被动充能邀约。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  enumerateActions,
  hexesWithin,
  TECH_TILES,
  type Action,
  type GameConfig,
  type GameState,
  type HexKey,
  type ResearchTrack,
} from '../src/index.js';
import { actionPhase, legalOf } from './helpers.js';

const CONFIG_2P: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'lantids'], lostFleet: true };

const TRACKS: readonly ResearchTrack[] = ['terra', 'nav', 'int', 'gaia', 'eco', 'sci'];

/** 行动阶段状态 + 手术。 */
function rig(mutate: (s: GameState) => void, config: GameConfig = CONFIG_2P): GameState {
  const s = structuredClone(actionPhase(config));
  mutate(s);
  return s;
}

/** 玩家 0 的一个起始矿 hex。 */
function mineHexOf(state: GameState, idx = 0): HexKey {
  return (Object.keys(state.map) as HexKey[]).find(
    (k) => state.map[k]!.building?.type === 'mine' && state.map[k]!.building.player === idx,
  )!;
}

/** 玩家 0 场上指定类型的建筑 hex。 */
function buildingHexOf(state: GameState, type: string, idx = 0): HexKey {
  return (Object.keys(state.map) as HexKey[]).find(
    (k) => state.map[k]!.building?.type === type && state.map[k]!.building.player === idx,
  )!;
}

function upgradesOf(state: GameState): Extract<Action, { type: 'upgrade' }>[] {
  return legalOf(state).filter((a): a is Extract<Action, { type: 'upgrade' }> => a.type === 'upgrade');
}

describe('upgrade 费用与 supply', () => {
  it('mine→ts：无对手邻近 6c+2o；旧建筑回 supply、新建筑出 supply', () => {
    const state = rig((s) => {
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 20;
      // 确保 2 格内无对手建筑（起始矿可能邻近对手矿，换一个无邻近的矿或清空对手建筑）
      for (const hex of Object.values(s.map)) {
        if (hex.building?.player === 1) {
          delete hex.building;
        }
      }
    });
    const hex = mineHexOf(state);
    const action = upgradesOf(state).find((a) => a.hex === hex && a.to === 'ts')!;
    expect(action).toBeDefined();
    const before = state.players[0]!;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(before.resources.ore - p.resources.ore).toBe(2);
    expect(before.resources.credits - p.resources.credits).toBe(6);
    expect(next.map[hex]!.building).toEqual({ type: 'ts', player: 0 });
    expect(p.buildings.mine).toBe(before.buildings.mine + 1);
    expect(p.buildings.ts).toBe(before.buildings.ts - 1);
  });

  it('mine→ts：2 格内有对手建筑折扣为 3c+2o', () => {
    const state = rig((s) => {
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 20;
      for (const hex of Object.values(s.map)) {
        if (hex.building?.player === 1) {
          delete hex.building;
        }
      }
      const hex = mineHexOf(s);
      const spot = hexesWithin(s.map, hex, 2).find((k) => k !== hex && s.map[k]!.building === undefined)!;
      s.map[spot]!.building = { type: 'mine', player: 1 };
    });
    const hex = mineHexOf(state);
    const action = upgradesOf(state).find((a) => a.hex === hex && a.to === 'ts')!;
    const before = state.players[0]!;
    const next = applyAction(state, action);
    expect(before.resources.credits - next.players[0]!.resources.credits).toBe(3);
  });

  it('升级触发对手被动充能邀约', () => {
    const state = rig((s) => {
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 20;
      for (const hex of Object.values(s.map)) {
        if (hex.building?.player === 1) {
          delete hex.building;
        }
      }
      const hex = mineHexOf(s);
      const spot = hexesWithin(s.map, hex, 2).find((k) => k !== hex && s.map[k]!.building === undefined)!;
      s.map[spot]!.building = { type: 'ts', player: 1 };
    });
    const action = upgradesOf(state).find((a) => a.hex === mineHexOf(state) && a.to === 'ts')!;
    const next = applyAction(state, action);
    expect(next.pending).toEqual({ kind: 'charge', queue: [{ player: 1, amount: 2, vpCost: 1 }] });
  });

  /** 充能邀约手术场景：对手 1 在我矿 2 格内有一个 ts。 */
  function chargeScenario(mutate?: (s: GameState) => void): GameState {
    return rig((s) => {
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 20;
      for (const hex of Object.values(s.map)) {
        if (hex.building?.player === 1) {
          delete hex.building;
        }
      }
      const hex = mineHexOf(s);
      const spot = hexesWithin(s.map, hex, 2).find((k) => k !== hex && s.map[k]!.building === undefined)!;
      s.map[spot]!.building = { type: 'ts', player: 1 };
      mutate?.(s);
    });
  }

  it('终轮已跳过的对手不再收到充能邀约', () => {
    const state = chargeScenario((s) => {
      s.round = 6;
      s.passedPlayers = [1];
    });
    const action = upgradesOf(state).find((a) => a.hex === mineHexOf(state) && a.to === 'ts')!;
    const next = applyAction(state, action);
    expect(next.pending).toBeNull();
  });

  it('非终轮已跳过的对手仍收到充能邀约（规则书：跳过后仍可充能）', () => {
    const state = chargeScenario((s) => {
      s.round = 3;
      s.passedPlayers = [1];
    });
    const action = upgradesOf(state).find((a) => a.hex === mineHexOf(state) && a.to === 'ts')!;
    const next = applyAction(state, action);
    expect(next.pending).toEqual({ kind: 'charge', queue: [{ player: 1, amount: 2, vpCost: 1 }] });
  });

  it('score5/score8 在场时升 ts 得分', () => {
    const state = rig((s) => {
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 20;
      for (const hex of Object.values(s.map)) {
        if (hex.building?.player === 1) {
          delete hex.building;
        }
      }
      s.board.roundScoring[s.round - 1] = 'score5';
    });
    const vpBefore = state.players[0]!.vp;
    const action = upgradesOf(state).find((a) => a.hex === mineHexOf(state) && a.to === 'ts')!;
    const next = applyAction(state, action);
    expect(next.players[0]!.vp).toBe(vpBefore + 4);
  });
});

describe('升 lab/学院拿科技板', () => {
  /** 构造：玩家 0 场上一个 ts、资源充足。 */
  function tsScenario(mutate?: (s: GameState) => void): GameState {
    return rig((s) => {
      const hex = mineHexOf(s);
      s.map[hex]!.building = { type: 'ts', player: 0 };
      s.players[0]!.resources = { ore: 15, credits: 30, knowledge: 10, qic: 2 };
      mutate?.(s);
    });
  }

  it('ts→lab 5c+3o，立即拿标准板（供应-1、入手、一次性效果结算）', () => {
    const state = tsScenario();
    const hex = buildingHexOf(state, 'ts');
    // tech4：+7vp 一次性，便于观测。
    const action = upgradesOf(state).find((a) => a.hex === hex && a.to === 'lab' && a.techTile === 'tech4' && a.research === null)!;
    expect(action).toBeDefined();
    const before = state.players[0]!;
    const vpBefore = before.vp;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(before.resources.ore - p.resources.ore).toBe(3);
    expect(before.resources.credits - p.resources.credits).toBe(5);
    expect(next.map[hex]!.building).toEqual({ type: 'lab', player: 0 });
    expect(p.techTiles).toContain('tech4');
    expect(next.board.techTiles['tech4']).toBe(state.board.techTiles['tech4']! - 1);
    expect(p.vp).toBe(vpBefore + 7);
  });

  it('拿板后升对应轨 1 级（轨正下方板只能升该轨）', () => {
    const state = tsScenario();
    const hex = buildingHexOf(state, 'ts');
    // 找一块在轨正下方的板：位置即轨名。
    const entry = Object.entries(state.board.techTilePositions).find(([p]) =>
      TRACKS.includes(p as ResearchTrack),
    )!;
    const [track, tile] = entry as [ResearchTrack, (typeof state.board.techTilePositions)[ResearchTrack]];
    const lvlBefore = state.players[0]!.research[track];
    const action = upgradesOf(state).find(
      (a) => a.hex === hex && a.to === 'lab' && a.techTile === tile && a.research === track,
    )!;
    expect(action).toBeDefined();
    const next = applyAction(state, action);
    expect(next.players[0]!.research[track]).toBe(lvlBefore + 1);
  });

  it('高级板：对应轨 L4 + 翻标记 + 覆盖标准板（被覆盖失效）', () => {
    const state = tsScenario((s) => {
      // 找一个有板的高级槽位，把对应轨抬到 L4。
      const slot = s.board.advTechTiles.findIndex((t) => t !== null);
      s.players[0]!.research[TRACKS[slot]!] = 4;
      s.players[0]!.techTiles.push('tech8'); // 收入板，用于覆盖
      s.players[0]!.federationTokens.push({ id: 'fed2', flipped: false });
    });
    const slot = state.board.advTechTiles.findIndex((t) => t !== null);
    const advId = state.board.advTechTiles[slot]!;
    const hex = buildingHexOf(state, 'ts');
    const action = upgradesOf(state).find(
      (a) => a.hex === hex && a.to === 'lab' && a.advTechTile === advId && a.coverTechTile === 'tech8' && a.flipToken === 'fed2',
    )!;
    expect(action).toBeDefined();
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(p.advTechTiles).toContainEqual({ id: advId, covers: 'tech8' });
    expect(p.federationTokens[0]!.flipped).toBe(true);
    expect(next.board.advTechTiles[slot]).toBeNull();
    expect(p.techTiles).toContain('tech8'); // 被覆盖仍持有（失效由 covered 判定）
  });

  it('高级板+升 L5 双翻面：拿板翻一枚、升 L5 再翻一枚（researchFlipToken）', () => {
    const state = tsScenario((s) => {
      const slot = s.board.advTechTiles.findIndex((t) => t !== null);
      s.players[0]!.research[TRACKS[slot]!] = 4; // 高级板槽位条件
      s.players[0]!.research.sci = 4; // 升 L5 目标轨
      s.players[0]!.techTiles.push('tech8');
      s.players[0]!.federationTokens.push({ id: 'fed2', flipped: false }, { id: 'fed6', flipped: false });
    });
    const slot = state.board.advTechTiles.findIndex((t) => t !== null);
    const advId = state.board.advTechTiles[slot]!;
    const hex = buildingHexOf(state, 'ts');
    const action = upgradesOf(state).find(
      (a) =>
        a.hex === hex && a.to === 'lab' && a.advTechTile === advId && a.coverTechTile === 'tech8' &&
        a.flipToken === 'fed2' && a.research === 'sci' && a.researchFlipToken === 'fed6',
    )!;
    expect(action).toBeDefined();
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(p.research.sci).toBe(5);
    expect(p.advTechTiles).toContainEqual({ id: advId, covers: 'tech8' });
    // 两枚标记分别用于拿板与升 L5，全部翻面
    expect(p.federationTokens.every((t) => t.flipped)).toBe(true);
    expect(next.board.researchLevel5.sci).toBe(0);
  });

  it('无 L4/无可翻标记时不枚举高级板', () => {
    const state = tsScenario();
    expect(upgradesOf(state).every((a) => a.advTechTile === undefined)).toBe(true);
  });

  it('lab→ac1 6c+6o；ac1 供应出', () => {
    const state = tsScenario((s) => {
      const hex = buildingHexOf(s, 'ts');
      s.map[hex]!.building = { type: 'lab', player: 0 };
    });
    const hex = buildingHexOf(state, 'lab');
    const action = upgradesOf(state).find((a) => a.hex === hex && a.to === 'ac1' && a.techTile === 'tech4' && a.research === null)!;
    expect(action).toBeDefined();
    const before = state.players[0]!;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(before.resources.ore - p.resources.ore).toBe(6);
    expect(before.resources.credits - p.resources.credits).toBe(6);
    expect(p.buildings.lab).toBe(before.buildings.lab + 1);
    expect(p.buildings.ac1).toBe(0);
  });
});

describe('PI 与种族差异', () => {
  it('ts→pi 6c+4o；gleens 建 PI 立即拿专属联邦标记（算组建联邦）', () => {
    const config: GameConfig = { playerCount: 2, seed: 42, factions: ['gleens', 'lantids'], lostFleet: true };
    const state = rig((s) => {
      const hex = mineHexOf(s);
      s.map[hex]!.building = { type: 'ts', player: 0 };
      s.players[0]!.resources = { ore: 15, credits: 30, knowledge: 10, qic: 2 };
      s.board.roundScoring[s.round - 1] = 'score4';
    }, config);
    const hex = buildingHexOf(state, 'ts');
    const action = upgradesOf(state).find((a) => a.hex === hex && a.to === 'pi')!;
    expect(action).toBeDefined();
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, action);
    const p = next.players[0]!;
    expect(next.map[hex]!.building).toEqual({ type: 'pi', player: 0 });
    expect(p.federationTokens).toContainEqual({ id: 'gleens', flipped: false });
    expect(next.board.federationTokens['gleens']).toBe(0);
    // gleens 标记：0vp + 1o+1k+2c；score4 +5vp（组建联邦触发）
    expect(p.vp).toBe(vpBefore + 5);
  });

  it('bescods 链：ts→ac1/ac2 与 lab→pi（无 ts→pi）', () => {
    const config: GameConfig = { playerCount: 2, seed: 42, factions: ['bescods', 'lantids'], lostFleet: true };
    const state = rig((s) => {
      const hex = mineHexOf(s);
      s.map[hex]!.building = { type: 'ts', player: 0 };
      s.players[0]!.resources = { ore: 15, credits: 30, knowledge: 10, qic: 2 };
    }, config);
    const hex = buildingHexOf(state, 'ts');
    const ups = upgradesOf(state).filter((a) => a.hex === hex);
    expect(ups.some((a) => a.to === 'ac1')).toBe(true);
    expect(ups.some((a) => a.to === 'ac2')).toBe(true);
    expect(ups.some((a) => a.to === 'pi')).toBe(false);
    // lab→pi 存在
    const state2 = rig((s) => {
      const h = mineHexOf(s);
      s.map[h]!.building = { type: 'lab', player: 0 };
      s.players[0]!.resources = { ore: 15, credits: 30, knowledge: 10, qic: 2 };
    }, config);
    expect(upgradesOf(state2).some((a) => a.hex === buildingHexOf(state2, 'lab') && a.to === 'pi')).toBe(true);
  });

  it('score7/score10 在场时升 PI/学院 +5vp', () => {
    const state = rig((s) => {
      const hex = mineHexOf(s);
      s.map[hex]!.building = { type: 'ts', player: 0 };
      s.players[0]!.resources = { ore: 15, credits: 30, knowledge: 10, qic: 2 };
      s.board.roundScoring[s.round - 1] = 'score7';
    });
    const action = upgradesOf(state).find((a) => a.hex === buildingHexOf(state, 'ts') && a.to === 'pi')!;
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, action);
    expect(next.players[0]!.vp).toBe(vpBefore + 5);
  });
});
