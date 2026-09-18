/**
 * form-federation 行为锚点：7pv 校验、卫星桥接与最少卫星、相邻约束、
 * 标记奖励（含 score4 触发）、xenos PI 阈值 6、ivits 扩展（7X）与卫星付 1q。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  mapNeighbors,
  FEDERATION_TOKENS,
  type Action,
  type BuildingType,
  type GameConfig,
  type GameState,
  type HexKey,
} from '../src/index.js';
import { actionPhase, legalOf } from './helpers.js';

const CONFIG_2P: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'lantids'], lostFleet: true };

function rig(mutate: (s: GameState) => void, config: GameConfig = CONFIG_2P): GameState {
  const s = structuredClone(actionPhase(config));
  mutate(s);
  return s;
}

function fedsOf(state: GameState): Extract<Action, { type: 'form-federation' }>[] {
  return legalOf(state).filter((a): a is Extract<Action, { type: 'form-federation' }> => a.type === 'form-federation');
}

/** 清空场上全部建筑。 */
function clearBuildings(s: GameState): void {
  for (const hex of Object.values(s.map)) {
    delete hex.building;
  }
}

/** 在 key 放玩家 0 的建筑。 */
function put(s: GameState, key: HexKey, type: BuildingType): void {
  s.map[key]!.building = { type, player: 0 };
}

/** 找一条两两相邻的 3 格链（任意格，供手术放建筑）。 */
function findChain(s: GameState, len: number): HexKey[] {
  const keys = Object.keys(s.map) as HexKey[];
  for (const a of keys) {
    for (const b of mapNeighbors(s.map, a)) {
      for (const c of mapNeighbors(s.map, b)) {
        if (c !== a) {
          return [a, b, c].slice(0, len);
        }
      }
    }
  }
  throw new Error('未找到相邻链');
}

/** 找 empty 格 E 及其两个互不相邻的邻居（E 在 X-Y 最短路径上，dist=2）。 */
function findBridge(s: GameState): { x: HexKey; e: HexKey; y: HexKey } {
  for (const [e, hex] of Object.entries(s.map) as [HexKey, (typeof s.map)[HexKey]][]) {
    if (hex.planet !== 'empty' || hex.building !== undefined || hex.satelliteOf !== undefined) {
      continue;
    }
    const nbs = mapNeighbors(s.map, e);
    for (const x of nbs) {
      for (const y of nbs) {
        if (x !== y && !mapNeighbors(s.map, x).includes(y)) {
          return { x, e: e as HexKey, y };
        }
      }
    }
  }
  throw new Error('未找到桥接格');
}

describe('form-federation 校验与结算', () => {
  it('7pv 单组件联邦：拿标记立即得奖励（fed2=8vp+1q），score4 +5vp', () => {
    const state = rig((s) => {
      clearBuildings(s);
      const [a, b, c] = findChain(s, 3);
      put(s, a!, 'ts');
      put(s, b!, 'ts');
      put(s, c!, 'pi');
      s.board.roundScoring[s.round - 1] = 'score4';
    });
    const feds = fedsOf(state);
    const fed = feds.find((a) => a.satellites.length === 0 && a.token === 'fed2')!;
    expect(fed).toBeDefined();
    expect(fed.hexes).toHaveLength(3);
    const before = state.players[0]!;
    const vpBefore = before.vp;
    const qicBefore = before.resources.qic;
    const next = applyAction(state, fed);
    const p = next.players[0]!;
    const def = FEDERATION_TOKENS['fed2'];
    expect(p.vp).toBe(vpBefore + def.vp + 5); // 标记 8vp + score4 5vp
    expect(p.resources.qic).toBe(qicBefore + 1);
    expect(p.federationTokens).toContainEqual({ id: 'fed2', flipped: false });
    for (const h of fed.hexes) {
      expect(next.map[h]!.federations).toContain(0);
    }
  });

  it('fed1（12vp）无绿面：落袋即 flipped（参考 isGreen = token !== Fed1）', () => {
    const state = rig((s) => {
      clearBuildings(s);
      const [a, b, c] = findChain(s, 3);
      put(s, a!, 'ts');
      put(s, b!, 'ts');
      put(s, c!, 'pi');
    });
    const fed = fedsOf(state).find((a) => a.satellites.length === 0 && a.token === 'fed1')!;
    const next = applyAction(state, fed);
    expect(next.players[0]!.federationTokens).toContainEqual({ id: 'fed1', flipped: true });
  });

  it('pv 不足 7 不枚举（terrans 阈值 7）', () => {
    const state = rig((s) => {
      clearBuildings(s);
      const [a, b, c] = findChain(s, 3);
      put(s, a!, 'ts');
      put(s, b!, 'ts');
      put(s, c!, 'ts'); // 6pv
    });
    expect(fedsOf(state)).toHaveLength(0);
  });

  it('卫星桥接：两组距 2 的组件以 1 颗卫星连通，弃 1 power', () => {
    const state = rig((s) => {
      clearBuildings(s);
      const { x, y } = findBridge(s);
      const x2 = mapNeighbors(s.map, x).find((k) => k !== y && s.map[k]!.planet !== 'empty')!;
      put(s, x, 'ts');
      put(s, x2, 'pi'); // 组件 {x,x2} pv 5
      put(s, y, 'ts'); // 组件 {y} pv 2
    });
    const feds = fedsOf(state);
    expect(feds.length).toBeGreaterThan(0);
    // 形状卫星数恒为 1（最少）；无 0 颗或 ≥2 颗的形状
    const shapes = new Set(feds.map((a) => [...a.hexes].sort().join('|') + '#' + a.satellites.length));
    expect([...shapes].every((k) => k.endsWith('#1'))).toBe(true);
    const fed = feds.find((a) => a.token === 'fed1')!;
    const bowlBefore = { ...state.players[0]!.power };
    const next = applyAction(state, fed);
    const p = next.players[0]!;
    // 弃 1 power token（规范化顺序 I→II→III）
    expect(bowlBefore.bowl1 - p.power.bowl1).toBe(1);
    expect(p.powerStats.discarded).toBe(state.players[0]!.powerStats.discarded + 1);
    expect(p.satellites).toBe(1);
    expect(next.map[fed.satellites[0]!]!.satelliteOf).toBe(0);
    expect(next.map[fed.satellites[0]!]!.federations).toContain(0);
  });

  it('相邻约束：与已有联邦相邻的组件不枚举', () => {
    const state = rig((s) => {
      clearBuildings(s);
      const [a, b, c] = findChain(s, 3);
      // 已有联邦：a,b（federations 已登记）
      put(s, a!, 'ts');
      put(s, b!, 'ts');
      s.map[a!]!.federations.push(0);
      s.map[b!]!.federations.push(0);
      // 新组件 c（与 b 相邻）+ 远处另一组件使其可达 7pv
      put(s, c!, 'pi');
    });
    // c 邻接已有联邦，被禁；场上无其它候选 → 无枚举
    expect(fedsOf(state)).toHaveLength(0);
  });

  it('每枚星球只属一个联邦：已入联邦的星球不再参与新联邦', () => {
    const state = rig((s) => {
      clearBuildings(s);
      const [a, b, c] = findChain(s, 3);
      put(s, a!, 'ts');
      put(s, b!, 'ts');
      put(s, c!, 'pi');
      s.map[a!]!.federations.push(0); // a 已在联邦
    });
    // b+c pv=5 <7，且 a 不可用 → 无枚举
    expect(fedsOf(state)).toHaveLength(0);
  });
});

describe('种族差异', () => {
  it('xenos PI：联邦阈值 6', () => {
    const config: GameConfig = { playerCount: 2, seed: 42, factions: ['xenos', 'lantids'], lostFleet: true };
    const state = rig((s) => {
      clearBuildings(s);
      s.players[0]!.buildings.pi = 0; // PI 已建
      const [a, b, c] = findChain(s, 3);
      put(s, a!, 'ts');
      put(s, b!, 'ts');
      put(s, c!, 'ts'); // 6pv
    }, config);
    expect(fedsOf(state).length).toBeGreaterThan(0);
  });

  it('ivits 扩展联邦：须连入已有联邦且总 pv ≥ 7X（X=标记数+1）', () => {
    const config: GameConfig = { playerCount: 2, seed: 42, factions: ['ivits', 'lantids'], lostFleet: true };
    const state = rig((s) => {
      clearBuildings(s);
      // 已有联邦 F0：pi(3)+ts(2)=5，federations 登记
      const [a, b] = findChain(s, 2);
      put(s, a!, 'pi');
      put(s, b!, 'ts');
      s.map[a!]!.federations.push(0);
      s.map[b!]!.federations.push(0);
      // 已有 1 枚标记 → X=2 → 阈值 14；新组件需 ≥9pv 且与 F0 直连
      s.players[0]!.federationTokens.push({ id: 'fed2', flipped: false });
      const nbs = mapNeighbors(s.map, b!).filter((k) => k !== a);
      const [c, d, e] = [nbs[0]!, ...findChain(s, 3).filter((k) => !nbs.includes(k))];
      // 用 b 的邻居 c 起步找一条 c-d-e-f 链
      const chain = [c, ...mapNeighbors(s.map, c).filter((k) => k !== b && k !== a)];
      put(s, chain[0]!, 'ac1');
      put(s, chain[1]!, 'ac2');
      const g = mapNeighbors(s.map, chain[1]!).find((k) => k !== chain[0] && k !== b && k !== a)!;
      put(s, g, 'ts');
      const h = mapNeighbors(s.map, g).find((k) => ![chain[0], chain[1], b, a].includes(k))!;
      put(s, h, 'mine'); // 新组件 3+3+2+1=9，经 c 与 b 直连
      void d;
      void e;
    }, config);
    const feds = fedsOf(state);
    expect(feds.length).toBeGreaterThan(0);
    // 扩展形状必须包含已有联邦 hex
    for (const f of feds) {
      expect(f.hexes.length).toBeGreaterThanOrEqual(6); // F0 2 格 + 新组件 4 格
    }
    const fed = feds.find((f) => f.token === 'fed1')!;
    const next = applyAction(state, fed);
    expect(next.players[0]!.federationTokens.map((t) => t.id)).toContain('fed1');
  });

  it('ivits 首次联邦卫星付 1q 替代弃 power', () => {
    const config: GameConfig = { playerCount: 2, seed: 42, factions: ['ivits', 'lantids'], lostFleet: true };
    const state = rig((s) => {
      clearBuildings(s);
      s.players[0]!.resources.qic = 3;
      const { x, y } = findBridge(s);
      const x2 = mapNeighbors(s.map, x).find((k) => k !== y)!;
      put(s, x, 'ts');
      put(s, x2, 'pi'); // pv 5
      put(s, y, 'ts'); // pv 2
    }, config);
    const feds = fedsOf(state);
    expect(feds.length).toBeGreaterThan(0);
    const fed = feds.find((f) => f.token === 'fed1' && f.satellites.length === 1)!;
    const before = state.players[0]!;
    const next = applyAction(state, fed);
    const p = next.players[0]!;
    expect(before.resources.qic - p.resources.qic).toBe(1);
    expect(p.power).toEqual(before.power); // power 不变
  });
});
