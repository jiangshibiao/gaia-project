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

describe('联邦子集合并枚举（3+ 分量）', () => {
  /**
   * 2026-09-21 线上 bug 回归：分量 ac2+mine(4) / ts(2) / mine(1) 两两合并均不达标
   * （4+2=6、4+1=5），但三分量合并 4+2+1=7 合法——旧枚举只做两两/全体，漏掉
   * 部分合并解致"组建联邦"按钮全暗。同时验证卫星最少性（1 格共享桥接，
   * 不多枚举同星球的多卫星形状）。
   */
  it('3 分量合并 4+2+1=7：枚举出 1 卫星共享桥形状且无多卫星重复', () => {
    const state = rig((s) => {
      clearBuildings(s);
      // 找 empty 格 E、E 的 3 个互不相邻的星球邻居 N1/N2/N3、
      // 以及 N1 的外侧邻居 M（不与 N2/N3 相邻）——用户局面同构
      const found = (() => {
        for (const [e, hex] of Object.entries(s.map) as [HexKey, (typeof s.map)[HexKey]][]) {
          if (hex.planet !== 'empty' || hex.building !== undefined || hex.ship !== undefined) continue;
          const nbs = mapNeighbors(s.map, e).filter(
            (k) => s.map[k]!.planet !== 'empty' && s.map[k]!.building === undefined,
          );
          for (let i = 0; i < nbs.length; i++) {
            for (let j = i + 1; j < nbs.length; j++) {
              for (let k = j + 1; k < nbs.length; k++) {
                const trio = [nbs[i]!, nbs[j]!, nbs[k]!];
                const independent = trio.every((a, x) =>
                  trio.every((b, y) => x === y || !mapNeighbors(s.map, a).includes(b)),
                );
                if (!independent) continue;
                const outer = mapNeighbors(s.map, trio[0]!).find(
                  (o) =>
                    o !== e &&
                    s.map[o]!.planet !== 'empty' &&
                    s.map[o]!.building === undefined &&
                    !mapNeighbors(s.map, o).includes(trio[1]!) &&
                    !mapNeighbors(s.map, o).includes(trio[2]!),
                );
                if (outer !== undefined) {
                  return { e: e as HexKey, trio: trio as HexKey[], outer };
                }
              }
            }
          }
        }
        throw new Error('未找到桥三格');
      })();
      put(s, found.trio[0]!, 'ac2'); // 3
      put(s, found.outer, 'mine'); // +1 → A 分量 = 4
      put(s, found.trio[1]!, 'ts'); // B = 2
      put(s, found.trio[2]!, 'mine'); // C = 1
      (s as { __fedProbe?: unknown }).__fedProbe = found;
    });
    const found = (state as unknown as { __fedProbe: { e: HexKey; trio: HexKey[]; outer: HexKey } }).__fedProbe;
    const planets = [found.trio[0], found.outer, found.trio[1], found.trio[2]].sort().join(',');
    const feds = fedsOf(state);
    expect(feds.length).toBeGreaterThan(0);
    // 该 4 星球的形状存在且卫星恰为 {E}（1 颗，共享桥接）
    const same = feds.filter((f) => [...f.hexes].sort().join(',') === planets);
    expect(same.length).toBeGreaterThan(0);
    for (const f of same) {
      expect([...f.satellites].sort()).toEqual([found.e]);
    }
  });

  it('极小性：达标分量不得再并入多余分量（{7} 与 {7,1} 不同时为候选）', () => {
    const state = rig((s) => {
      clearBuildings(s);
      const [a, b, c] = findChain(s, 3);
      put(s, a!, 'pi'); // 3
      put(s, b!, 'ts'); // 2
      put(s, c!, 'ts'); // 2 → 单分量 7（a-b-c 直连）
      // 远处的孤立 mine（经卫星可桥，但并入即"多用星球"）
      const far = (Object.keys(s.map) as HexKey[]).find(
        (k) =>
          ![a, b, c].includes(k) &&
          s.map[k]!.planet !== 'empty' &&
          s.map[k]!.building === undefined &&
          ![a, b, c].some((x) => mapNeighbors(s.map, k).includes(x!)),
      )!;
      put(s, far, 'mine');
      (s as { __fedProbe2?: unknown }).__fedProbe2 = { chain: [a, b, c], far };
    });
    const { chain, far } = (state as unknown as { __fedProbe2: { chain: HexKey[]; far: HexKey } }).__fedProbe2;
    const chainKey = [...chain].sort().join(',');
    const feds = fedsOf(state);
    // 单分量 7 是候选
    expect(feds.some((f) => [...f.hexes].sort().join(',') === chainKey)).toBe(true);
    // 含 far 矿的超集形状一律不得存在
    expect(feds.every((f) => !f.hexes.includes(far))).toBe(true);
  });

  it('极小性保留"桥"：分量在连通要道上（去掉后卫星变多），pv 富余也不算多余', () => {
    // 布局：ac2-ts-mine-ts 四格直连链（A={ac2,ts}=5、X={mine}=1、B={ts}=2，pv 8）。
    // 规则书 920-923：少 1 星球**且**少 1 卫星才算违规——{A,X,B} 去掉 X 后 {A,B}
    // pv 7 仍达标但需卫星绕路（X 是桥，卫星变多）→ X 不多余、形状合法。
    // （旧口径"pv 富余即多余"会误删此形状——fed-diff 对拍发现并修正。）
    const state = rig((s) => {
      clearBuildings(s);
      const [a1, a2, x] = findChain(s, 3);
      const b = mapNeighbors(s.map, x!).find((k) => k !== a2 && s.map[k]!.planet !== 'empty')!;
      put(s, a1!, 'ac2');
      put(s, a2!, 'ts');
      put(s, x!, 'mine');
      put(s, b, 'ts');
      (s as { __fedBridge?: unknown }).__fedBridge = [a1, a2, x, b];
    });
    const [a1, a2, x, b] = (state as unknown as { __fedBridge: HexKey[] }).__fedBridge;
    const planets = [a1!, a2!, x!, b].sort().join(',');
    const shapes = fedsOf(state).filter((f) => [...f.hexes].sort().join(',') === planets);
    // 桥形状被枚举且 0 卫星（四格直连，X 在要道上）
    expect(shapes.length).toBeGreaterThan(0);
    for (const f of shapes) {
      expect(f.satellites).toEqual([]);
    }
  });
});
