/**
 * 估价机制定向测试：
 * - vpPullMult：LF 登船费门槛拉力（vp<5 且有穿梭机 → VP 收益加权）；
 * - federationPotential：分量感知多簇并行（第 2 簇按 fedGroup2Mult 加权）。
 * 全部手术构造状态，不靠随机对局命中。
 */
import { describe, expect, it } from 'vitest';
import {
  hexesWithin,
  mapNeighbors,
  newGame,
  type GameState,
  type HexKey,
} from '@gaia/engine';
import { evalCtx } from '../src/heuristic2/context.js';
import { evaluateState } from '../src/heuristic2/position.js';
import { fedComponentValue, ownComponents } from '../src/heuristic2/score.js';
import { vpPullMult } from '../src/heuristic2/values.js';

function lfState(seed = 7): GameState {
  return newGame({ playerCount: 2, seed, factions: ['terrans', 'xenos'], lostFleet: true });
}

describe('vpPullMult（LF 登船费门槛拉力）', () => {
  // 机制默认中性（vpDeficitPull=0），测试显式注入 0.8 验证机制本身。
  const PULL = { explore: { vpDeficitPull: 0.8 } } as const;

  it('vp≥5 → 1；vp<5 且有剩余穿梭机 → >1 且随缺口增大', () => {
    const state = lfState();
    const ctx = evalCtx(state, 0, PULL);
    expect(vpPullMult(ctx)).toBe(1); // 初始 vp ≥ 5
    state.players[0]!.vp = 4;
    const m4 = vpPullMult(ctx);
    expect(m4).toBeGreaterThan(1);
    state.players[0]!.vp = 2;
    const m2 = vpPullMult(ctx);
    expect(m2).toBeGreaterThan(m4);
    // 精确公式：1 + pull×(cost−vp)/cost（cost=5）
    expect(m2).toBeCloseTo(1 + (0.8 * 3) / 5, 6);
  });

  it('穿梭机用完 → 1；基础变体 → 1；pull=0（默认）→ 1', () => {
    const state = lfState();
    const ctx = evalCtx(state, 0, PULL);
    state.players[0]!.vp = 3;
    expect(vpPullMult(ctx)).toBeGreaterThan(1);
    const [s0, s1] = state.board.ships;
    state.players[0]!.shuttles.push({ ship: s0!.id, slot: 1 }, { ship: s1!.id, slot: 1 }); // 2p 共 2 架
    expect(vpPullMult(ctx)).toBe(1);
    // 默认 cfg（pull=0）即使 vp<5 也是 1
    expect(vpPullMult(evalCtx(state, 0))).toBe(1);

    const base = newGame({ playerCount: 2, seed: 7, factions: ['terrans', 'xenos'], lostFleet: false });
    base.players[0]!.vp = 3;
    expect(vpPullMult(evalCtx(base, 0, PULL))).toBe(1);
  });
});

describe('federationPotential（分量感知多簇并行）', () => {
  /** 找两对互不相邻的相邻格（两簇种子）。 */
  function twoClusterPairs(state: GameState): [HexKey, HexKey, HexKey, HexKey] {
    const keys = Object.keys(state.map) as HexKey[];
    const hA = keys[0]!;
    const nA = mapNeighbors(state.map, hA)[0]!;
    const near = new Set<HexKey>([...hexesWithin(state.map, hA, 2), ...hexesWithin(state.map, nA, 2)]);
    const hB = keys.find((k) => !near.has(k))!;
    const nB = mapNeighbors(state.map, hB).find((k) => !near.has(k))!;
    return [hA, nA, hB, nB];
  }

  function withMines(state: GameState, hexes: HexKey[]): GameState {
    const s = structuredClone(state);
    for (const h of hexes) {
      s.map[h]!.building = { type: 'mine', player: 0 };
    }
    return s;
  }

  it('第 2 簇按 fedGroup2Mult 加权进入叶估值；mult=0 时消失', () => {
    const base = lfState(11);
    const [hA, nA, hB, nB] = twoClusterPairs(base);
    const oneCluster = withMines(base, [hA, nA]);
    const twoClusters = withMines(base, [hA, nA, hB, nB]);
    // 显式注入 mult=0.7（默认值随调参变化，机制测试不动）
    const noFinal = { final: { weight: 0 }, leaf: { fedGroup2Mult: 0.7 } } as const;
    const v1 = evaluateState(oneCluster, 0, noFinal);
    const v2 = evaluateState(twoClusters, 0, noFinal);
    // 期望增量 = fedComponentValue(2, clusterPv×0.5=20) × fedGroup2Mult(0.7)
    const expected = (2 / 7) ** 2 * 20 * 0.7;
    expect(v2 - v1).toBeCloseTo(expected, 3);
    // fedGroup2Mult=0 → 第 2 簇不贡献
    const v1z = evaluateState(oneCluster, 0, { final: { weight: 0 }, leaf: { fedGroup2Mult: 0 } });
    const v2z = evaluateState(twoClusters, 0, { final: { weight: 0 }, leaf: { fedGroup2Mult: 0 } });
    expect(v2z - v1z).toBeCloseTo(0, 6);
    // 单簇自身价值 = fedComponentValue(2, 20)
    const v0 = evaluateState(base, 0, noFinal);
    expect(v1 - v0).toBeCloseTo((2 / 7) ** 2 * 20, 3);
  });

  it('ownComponents excludeFedAdjacent：联邦邻格被排除', () => {
    const base = lfState(11);
    const [hA, nA] = twoClusterPairs(base);
    const s = withMines(base, [hA, nA]);
    expect(ownComponents(s, 0).pvs).toEqual([2]);
    s.map[hA]!.federations.push(0);
    expect(ownComponents(s, 0).pvs).toEqual([1]); // 联邦格自身永远排除
    expect(ownComponents(s, 0, { excludeFedAdjacent: true }).pvs).toEqual([]); // 邻格是禁入区
  });

  it('fedComponentValue 超 7 贬值（贴大惩罚）', () => {
    expect(fedComponentValue(8, 40)).toBeLessThan(fedComponentValue(7, 40));
    expect(fedComponentValue(7, 40)).toBe(40);
  });
});
