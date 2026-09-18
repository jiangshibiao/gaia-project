/**
 * 差分对拍（reference/harness）驱动的回归测试：每个在真实对局回放中
 * 发现并修复的引擎 bug 一条用例。覆盖：
 * 起始资源、ivits 起始 power、setup 无充能、收入板不立即结算、pass 顺序、空碗无邀约、
 * brainstone burn、score1 免费步、terrans 盖亚兑换、共享卫星格、
 * 部分充能 amount、powerFrom、times/brainstone 兑换覆盖、Lost Planet 卫星计数。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  enumerateActions,
  hexDistance,
  newGame,
  parseHexKey,
  terraformingSteps,
  type Action,
  type FactionId,
  type GameConfig,
  type GameState,
  type HexKey,
} from '../src/index.js';
import { actionPhase, completeSetup } from './helpers.js';

const CONFIG_2P: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'taklons'], lostFleet: false };
const CONFIG_3P: GameConfig = {
  playerCount: 3,
  seed: 7,
  factions: ['baltaks', 'bescods', 'ambas'],
  lostFleet: false,
};

/** 就地修改状态的 rig 辅助。 */
function rig(state: GameState, fn: (s: GameState) => void): GameState {
  fn(state);
  return state;
}

/** 两 hex 间距离（key 形式）。 */
function dist(a: HexKey, b: HexKey): number {
  return hexDistance(parseHexKey(a), parseHexKey(b));
}

/** 找一个 hex：无建筑、可建矿星球、距 playerA 建筑 ≤ rangeA、距 playerB 建筑 ≤ rangeB。 */
function findHex(
  state: GameState,
  opts: { planetIn?: string[]; nearA?: { player: number; range: number }; nearB?: { player: number; range: number } },
): HexKey | undefined {
  const planets = opts.planetIn ?? ['terra', 'desert', 'swamp', 'oxide', 'volcanic', 'titanium', 'ice', 'gaia'];
  const buildingsOf = (p: number): HexKey[] =>
    (Object.keys(state.map) as HexKey[]).filter((k) => state.map[k]!.building?.player === p);
  return (Object.keys(state.map) as HexKey[]).find((k) => {
    const h = state.map[k]!;
    if (!planets.includes(h.planet) || h.building !== undefined) {
      return false;
    }
    if (opts.nearA !== undefined && !buildingsOf(opts.nearA.player).some((b) => dist(b, k) <= opts.nearA!.range)) {
      return false;
    }
    if (opts.nearB !== undefined && !buildingsOf(opts.nearB.player).some((b) => dist(b, k) <= opts.nearB!.range)) {
      return false;
    }
    return true;
  });
}

describe('起始资源（fixture beginGame 核对）', () => {
  it('baltaks 起始 0q、bescods 起始 3k', () => {
    const s = newGame(CONFIG_3P);
    expect(s.players[0]!.resources.qic).toBe(0);
    expect(s.players[1]!.resources.knowledge).toBe(3);
  });

  it('ivits 起始 power 为 I 区 2 + II 区 2（基础局同 LF，参考 standard 板）', () => {
    for (const lostFleet of [false, true]) {
      const s = newGame({ playerCount: 2, seed: 42, factions: ['ivits', 'bescods'], lostFleet });
      expect([s.players[0]!.power.bowl1, s.players[0]!.power.bowl2]).toEqual([2, 2]);
    }
  });

  it('LF lantids +1 power token 是每轮收入而非起始 power（参考 lostFleetIncome "+t"）', () => {
    const total = (p: GameState['players'][number]): number =>
      p.power.bowl1 + p.power.bowl2 + p.power.bowl3 + p.power.gaia;
    const s0 = newGame({ playerCount: 2, seed: 42, factions: ['lantids', 'xenos'], lostFleet: true });
    expect(total(s0.players[0]!)).toBe(4); // 起始不加
    const s = completeSetup(s0); // setup 完成结算第 1 轮收入
    expect(total(s.players[0]!)).toBe(5); // 收入 +1t（充能只在碗间移动，总数不变）
    // 基础局无此收入
    const b = completeSetup(newGame({ playerCount: 2, seed: 42, factions: ['lantids', 'xenos'], lostFleet: false }));
    expect(total(b.players[0]!)).toBe(4);
  });
});

describe('setup 放置不产生被动充能邀约', () => {
  it('起始矿放置后 pending 为 null', () => {
    let s = newGame(CONFIG_2P);
    const legal0 = enumerateActions(s, s.setupQueue[0]!);
    expect(legal0.length).toBeGreaterThan(0);
    s = applyAction(s, legal0[0]!);
    expect(s.pending).toBeNull();
    const legal1 = enumerateActions(s, s.setupQueue[0]!);
    s = applyAction(s, legal1[0]!);
    expect(s.pending).toBeNull();
  });
});

describe('拿收入类科技板不立即结算', () => {
  it('qic1 拿 tech6（income +1k+1c）后资源不变', () => {
    let s = actionPhase(CONFIG_2P);
    const idx = s.currentPlayerIdx;
    s = rig(s, (st) => {
      st.board.techTilePositions.free1 = 'tech6';
      st.players[idx]!.resources.qic = 4;
    });
    const before = { ...s.players[idx]!.resources };
    const next = applyAction(
      s,
      { type: 'qic-action', action: 'qic1', payload: { techTile: 'tech6' } },
      { assumeLegal: true },
    );
    const after = next.players[idx]!.resources;
    // 只有 qic 成本 -4，无立即 +1k+1c（income 每轮才结算）
    expect(after.qic).toBe(before.qic - 4);
    expect(after.knowledge).toBe(before.knowledge);
    expect(after.credits).toBe(before.credits);
  });
});

describe('轮末顺序 = pass 顺序', () => {
  it('pass 顺序 [2,0,1] 成为下轮 turnOrder', () => {
    let s = actionPhase(CONFIG_3P);
    s = rig(s, (st) => {
      st.currentPlayerIdx = 2;
    });
    const takeBooster = (st: GameState): Action => ({ type: 'pass', booster: st.board.boosters[0]! });
    s = applyAction(s, takeBooster(s));
    expect(s.currentPlayerIdx).toBe(0);
    s = applyAction(s, takeBooster(s));
    expect(s.currentPlayerIdx).toBe(1);
    s = applyAction(s, takeBooster(s));
    expect(s.round).toBe(2);
    expect(s.turnOrder).toEqual([2, 0, 1]);
    expect(s.currentPlayerIdx).toBe(2);
  });
});

describe('被动充能邀约：无 token 可充不生成', () => {
  it('对手碗空 → 无邀约；taklons 已建 PI 例外', () => {
    let s = actionPhase(CONFIG_2P);
    // terrans 在 taklons 建筑 2 格内、自己射程 1 内建矿（先在 terrans 矿旁摆一颗 taklons 矿）
    s = rig(s, (st) => {
      const t = st.players[1]!;
      t.power.bowl1 = 0;
      t.power.bowl2 = 0;
      t.power.bowl3 = 3;
      t.power.brainstone = 'bowl3';
      st.players[0]!.resources.ore = 15;
      st.players[0]!.resources.credits = 30;
      st.currentPlayerIdx = 0;
      const t0 = (Object.keys(st.map) as HexKey[]).find((k) => st.map[k]!.building?.player === 0)!;
      const spot = (Object.keys(st.map) as HexKey[]).find(
        (k) => st.map[k]!.planet !== 'empty' && st.map[k]!.building === undefined && dist(k, t0) === 1,
      )!;
      st.map[spot]!.building = { type: 'mine', player: 1 };
      st.players[0]!.research.nav = 2; // 射程 2，保证有候选格
    });
    const target = findHex(s, { nearA: { player: 0, range: 2 }, nearB: { player: 1, range: 2 } });
    expect(target).toBeDefined();
    let next = applyAction(s, { type: 'build-mine', hex: target! }, { assumeLegal: true });
    expect(next.pending).toBeNull();

    // taklons 已建 PI：同样空碗也生成邀约（可为 PI 的 +1 token 接受）
    next = rig(next, (st) => {
      st.players[1]!.buildings.pi = 0;
      st.players[0]!.resources.ore = 15;
      st.players[0]!.resources.credits = 30;
      st.currentPlayerIdx = 0;
      // 清掉刚才建的矿以便复用同一目标
      delete st.map[target!]!.building;
      st.players[0]!.buildings.mine += 1;
    });
    next = applyAction(next, { type: 'build-mine', hex: target! }, { assumeLegal: true });
    expect(next.pending?.kind).toBe('charge');
  });
});

describe('brainstone 在 II 区的 burn', () => {
  it('弃 1 普通 token，brainstone→III（参考 burnPower）', () => {
    let s = actionPhase(CONFIG_2P);
    s = rig(s, (st) => {
      const t = st.players[1]!;
      t.power.bowl1 = 0;
      t.power.bowl2 = 5;
      t.power.bowl3 = 0;
      t.power.brainstone = 'bowl2';
      st.currentPlayerIdx = 1;
    });
    const next = applyAction(s, { type: 'burn' });
    const pw = next.players[1]!.power;
    expect(pw.bowl2).toBe(4);
    expect(pw.brainstone).toBe('bowl3');
    expect(pw.bowl3).toBe(0);
  });
});

describe('score1：免费 terraform 步也计分', () => {
  it('power2 建矿（2 免费步）在 2 步星球上 +4vp', () => {
    let s = actionPhase(CONFIG_2P);
    const idx = s.currentPlayerIdx;
    s = rig(s, (st) => {
      st.board.roundScoring = ['score1', 'score2', 'score3', 'score4', 'score5', 'score6'];
      const p = st.players[idx]!;
      p.power.bowl3 = 5;
      p.resources.ore = 15;
      p.resources.credits = 30;
    });
    const home = s.players[idx]!.faction;
    const legal = enumerateActions(s, idx).filter(
      (a): a is Extract<Action, { type: 'power-action' }> => a.type === 'power-action' && a.action === 'power2',
    );
    // 找一个恰好 2 terraform 步的目标
    const twoStep = legal.find((a) => {
      const hex = a.payload?.hex;
      return hex !== undefined && terraformingSteps(home === 'terrans' ? 'terra' : 'swamp', s.map[hex]!.planet as never) === 2;
    });
    expect(twoStep).toBeDefined();
    const vpBefore = s.players[idx]!.vp;
    const next = applyAction(s, twoStep!);
    // 2 步（含免费步）× 2vp
    expect(next.players[idx]!.vp).toBe(vpBefore + 4);
  });
});

describe('terrans PI 盖亚兑换：花掉的 gaia power 入 II 区', () => {
  it('terrans-gaia-o：3 gaia → bowl2（非弃置）', () => {
    let s = actionPhase(CONFIG_2P);
    s = rig(s, (st) => {
      const t = st.players[0]!;
      t.power.gaia = 6;
      t.power.bowl2 = 0;
    });
    const next = applyAction(
      s,
      { type: 'free-conversion', conversion: 'terrans-gaia-o', actor: 0 },
      { assumeLegal: true },
    );
    const pw = next.players[0]!.power;
    expect(pw.gaia).toBe(3);
    expect(pw.bowl2).toBe(3);
    expect(next.players[0]!.powerStats.discarded).toBe(0);
  });
});

describe('共享卫星格（参考 excludedHexes 只排除己方联邦格）', () => {
  it('对手卫星格可再作卫星，satelliteOf 记首个放置者', () => {
    let s = actionPhase(CONFIG_2P);
    // 找一颗双方都能搭桥的空格：两侧各放一矿
    const sat = (Object.keys(s.map) as HexKey[]).find((k) => s.map[k]!.planet === 'empty')!;
    const adjacent = (Object.keys(s.map) as HexKey[]).filter((k) => dist(k, sat) === 1);
    const [a, b] = adjacent;
    s = rig(s, (st) => {
      st.map[a!]!.building = { type: 'mine', player: 0 };
      st.map[b!]!.building = { type: 'mine', player: 1 };
      st.players[0]!.power.bowl1 = 6;
      st.players[1]!.power.bowl1 = 6;
      st.currentPlayerIdx = 0;
    });
    let next = applyAction(
      s,
      { type: 'form-federation', hexes: [a!], satellites: [sat], token: 'fed1' },
      { assumeLegal: true },
    );
    expect(next.map[sat]!.satelliteOf).toBe(0);
    expect(next.map[sat]!.federations).toEqual([0]);
    next = rig(next, (st) => {
      st.currentPlayerIdx = 1;
    });
    next = applyAction(
      next,
      { type: 'form-federation', hexes: [b!], satellites: [sat], token: 'fed1' },
      { assumeLegal: true },
    );
    expect(next.map[sat]!.satelliteOf).toBe(0); // 首个放置者保留
    expect(next.map[sat]!.federations).toEqual([0, 1]);
    expect(next.players[0]!.satellites).toBe(1);
    expect(next.players[1]!.satellites).toBe(1);
  });
});

describe('对拍覆盖字段', () => {
  it('部分充能 charge.amount', () => {
    let s = actionPhase(CONFIG_2P);
    s = rig(s, (st) => {
      const t = st.players[1]!;
      t.power.bowl1 = 0;
      t.power.bowl2 = 2;
      t.power.bowl3 = 0;
      t.power.brainstone = 'bowl3'; // 避免 brainstone 参与充能，简化断言
      st.players[0]!.resources.ore = 15;
      st.players[0]!.resources.credits = 30;
      st.currentPlayerIdx = 0;
      // 在 terrans 矿旁摆一颗 taklons ts（pv 2，邀约 2pw）
      const t0 = (Object.keys(st.map) as HexKey[]).find((k) => st.map[k]!.building?.player === 0)!;
      const spot = (Object.keys(st.map) as HexKey[]).find(
        (k) => st.map[k]!.planet !== 'empty' && st.map[k]!.building === undefined && dist(k, t0) === 1,
      )!;
      st.map[spot]!.building = { type: 'ts', player: 1 };
      st.players[0]!.research.nav = 2; // 射程 2，保证有候选格
    });
    const near = findHex(s, { nearA: { player: 0, range: 2 }, nearB: { player: 1, range: 2 } });
    expect(near).toBeDefined();
    let next = applyAction(s, { type: 'build-mine', hex: near! }, { assumeLegal: true });
    expect(next.pending?.kind).toBe('charge');
    const offer = (next.pending as { kind: 'charge'; queue: { player: number; amount: number }[] }).queue[0]!;
    expect(offer.amount).toBeGreaterThan(1);
    const vpBefore = next.players[offer.player]!.vp;
    next = applyAction(next, { type: 'charge', amount: 1 }, { assumeLegal: true });
    // 1pw：vp 代价 0，充 1（II→III）
    expect(next.players[offer.player]!.vp).toBe(vpBefore);
    expect(next.players[offer.player]!.power.bowl2).toBe(1);
    expect(next.players[offer.player]!.power.bowl3).toBe(1);
  });

  it('start-gaia-project powerFrom 覆盖', () => {
    let s = actionPhase(CONFIG_2P);
    const idx = s.currentPlayerIdx;
    s = rig(s, (st) => {
      const p = st.players[idx]!;
      p.research.gaia = 1;
      p.gaiaformers = { total: 1, available: 1, lost: 0, inGaia: 0 };
      p.power.bowl1 = 3;
      p.power.bowl2 = 3;
      p.power.bowl3 = 0;
    });
    // 任意 transdim：qic 补程保证可达
    s = rig(s, (st) => {
      st.players[idx]!.resources.qic = 10;
    });
    const transdim = (Object.keys(s.map) as HexKey[]).find((k) => s.map[k]!.planet === 'transdim')!;
    expect(transdim).toBeDefined();
    const next = applyAction(
      s,
      { type: 'start-gaia-project', hex: transdim, powerFrom: { area1: 3, area2: 3 } },
      { assumeLegal: true },
    );
    const pw = next.players[idx]!.power;
    expect(pw.bowl1).toBe(0);
    expect(pw.bowl2).toBe(0);
    expect(pw.gaia).toBe(6);
  });

  it('free-conversion times + brainstone 覆盖', () => {
    let s = actionPhase(CONFIG_2P);
    const before = s.players[1]!.resources.credits;
    s = rig(s, (st) => {
      const t = st.players[1]!;
      t.power.bowl1 = 0;
      t.power.bowl2 = 0;
      t.power.bowl3 = 0;
      t.power.brainstone = 'bowl3';
      st.currentPlayerIdx = 1;
    });
    const next = applyAction(
      s,
      { type: 'free-conversion', conversion: 'pw1-c', actor: 1, times: 3, brainstone: true },
      { assumeLegal: true },
    );
    const pw = next.players[1]!.power;
    expect(pw.brainstone).toBe('bowl1');
    expect(next.players[1]!.resources.credits).toBe(before + 3);
  });

  it('主行动后的免费行动归属 actor（不随回合推进错位）', () => {
    let s = actionPhase(CONFIG_2P);
    const idx = s.currentPlayerIdx;
    const other = (idx + 1) % 2;
    s = rig(s, (st) => {
      const p = st.players[idx]!;
      p.resources.knowledge = 8;
      p.power.bowl3 = 1;
    });
    const c0 = s.players[idx]!.resources.credits;
    const c1 = s.players[other]!.resources.credits;
    // research 主行动（回合推进）后再做 pw→c 兑换：应仍属 idx
    let next = applyAction(s, { type: 'research', track: 'eco' });
    expect(next.currentPlayerIdx).toBe(other);
    next = applyAction(next, { type: 'free-conversion', conversion: 'pw1-c', actor: idx }, { assumeLegal: true });
    expect(next.players[idx]!.resources.credits).toBe(c0 + 1);
    expect(next.players[other]!.resources.credits).toBe(c1);
  });
});

describe('Lost Planet 不占卫星计数', () => {
  it('nav L5 放 Lost Planet 后 satellites 不变', () => {
    let s = actionPhase(CONFIG_2P);
    const idx = s.currentPlayerIdx;
    s = rig(s, (st) => {
      const p = st.players[idx]!;
      p.research.nav = 4;
      p.resources.knowledge = 8;
      p.federationTokens.push({ id: 'fed2', flipped: false });
    });
    const legal = enumerateActions(s, idx).filter(
      (a): a is Extract<Action, { type: 'research' }> => a.type === 'research' && a.track === 'nav',
    );
    expect(legal.length).toBeGreaterThan(0);
    const satBefore = s.players[idx]!.satellites;
    const next = applyAction(s, legal[0]!);
    expect(next.players[idx]!.research.nav).toBe(5);
    expect(next.players[idx]!.satellites).toBe(satBefore);
  });
});

// ---------------------------------------------------------------------------
// Lost Fleet 对拍（lf-fixture-1/2）驱动的回归
// ---------------------------------------------------------------------------

const CONFIG_LF: GameConfig = {
  playerCount: 4,
  seed: 42,
  factions: ['tinkeroids', 'moweyds', 'baltaks', 'taklons'],
  lostFleet: true,
};

/** 在飞船上直接放穿梭机（绕过探索流程）。 */
function rigShuttleLf(state: GameState, ship: 'twilight' | 'rebellion' | 'tfmars' | 'eclipse', idx: number): void {
  const s = state.board.ships.find((x) => x.id === ship)!;
  const slot = s.shuttleSlots.indexOf(null);
  s.shuttleSlots[slot] = idx;
  state.players[idx]!.shuttles.push({ ship, slot });
  if (!state.players[idx]!.exploredShips.includes(ship)) {
    state.players[idx]!.exploredShips.push(ship);
  }
}

describe('LF：booster5 射程 +3 可用于探索飞船', () => {
  it('special-action booster5 payload.ship 触发探索（参考 qicForExplorationDistance 用 temporaryRange）', () => {
    let s = actionPhase(CONFIG_LF);
    const idx = s.currentPlayerIdx;
    const ship = s.board.ships.find((x) => x.id === 'twilight')!;
    s = rig(s, (st) => {
      st.pending = null; // 清掉 Tinkeroids 的 tinkering 待决
      const p = st.players[idx]!;
      p.booster = 'booster5';
      p.resources.qic = 0;
      // 在 Twilight 附近 3 格放一矿，使 range+3 可达（基础射程 1 + 3 = 4）
      const near = (Object.keys(st.map) as HexKey[]).find(
        (k) => st.map[k]!.building === undefined && st.map[k]!.planet !== 'empty' && dist(k, ship.hex) <= 3,
      )!;
      st.map[near]!.building = { type: 'mine', player: idx };
    });
    const legal = enumerateActions(s, idx).filter(
      (a): a is Extract<Action, { type: 'special-action' }> =>
        a.type === 'special-action' && a.action === 'booster5' && a.payload?.ship === 'twilight',
    );
    expect(legal.length).toBeGreaterThan(0);
    const next = applyAction(s, legal[0]!);
    expect(next.players[idx]!.shuttles.some((x) => x.ship === 'twilight')).toBe(true);
  });
});

describe('LF：船上科技板 count 模型（每名玩家可拿 1 份）', () => {
  it('同一艘船的科技板可被两名玩家先后拿走（参考 spaceshipTechs count=人数）', () => {
    let s = actionPhase(CONFIG_LF);
    s = rig(s, (st) => {
      st.pending = null;
      rigShuttleLf(st, 'rebellion', 0);
      rigShuttleLf(st, 'rebellion', 1);
      st.players[0]!.resources.qic = 3;
      st.players[1]!.resources.ore = 15;
      st.players[1]!.resources.credits = 30;
      const ship = st.board.ships.find((x) => x.id === 'rebellion')!;
      ship.techTiles = ['techlf2'];
      // 玩家 1 放一个 lab 供升级拿板用
      const labHex = (Object.keys(st.map) as HexKey[]).find(
        (k) => st.map[k]!.building === undefined && st.map[k]!.planet !== 'empty',
      )!;
      st.map[labHex]!.building = { type: 'lab', player: 1 };
    });
    // 玩家 0 拿板（ship-action ship-tech-tile payload.ship=rebellion）
    const a0: Action = {
      type: 'ship-action',
      action: 'ship-tech-tile',
      ship: 'rebellion',
      payload: { techTile: 'techlf2', ship: 'rebellion' },
    };
    let next = applyAction(s, a0, { assumeLegal: true });
    expect(next.players[0]!.techTiles).toContain('techlf2');
    const ship = next.board.ships.find((x) => x.id === 'rebellion')!;
    expect(ship.techTiles).toEqual(['techlf2']); // 板仍留船上
    expect(ship.techTileClaims).toEqual([0]);
    // 玩家 1（回合已推进到 1）经升级拿板上同一块（旧的 splice 模型会把板拿走、拒绝第二次）
    const labHex = (Object.keys(next.map) as HexKey[]).find(
      (k) => next.map[k]!.building?.type === 'lab' && next.map[k]!.building.player === 1,
    )!;
    const a1: Action = { type: 'upgrade', hex: labHex, to: 'ac1', techTile: 'techlf2', ship: 'rebellion' };
    const next2 = applyAction(next, a1, { assumeLegal: true });
    expect(next2.players[1]!.techTiles).toContain('techlf2');
    expect(next2.board.ships.find((x) => x.id === 'rebellion')!.techTileClaims).toEqual([0, 1]);
  });
});

describe('LF：Twilight 免费升 ts→lab 与正常升级一样拿科技板', () => {
  it('ship-upgrade-ts-lab 的 payload 科技链生效（参考 placeBuilding 的 ChooseTechTile 流程）', () => {
    let s = actionPhase(CONFIG_LF);
    let tsHex!: HexKey;
    s = rig(s, (st) => {
      st.pending = null;
      rigShuttleLf(st, 'twilight', 0);
      st.players[0]!.power.bowl3 = 3;
      st.players[0]!.resources.ore = 4;
      tsHex = (Object.keys(st.map) as HexKey[]).find(
        (k) => st.map[k]!.building === undefined && st.map[k]!.planet !== 'empty',
      )!;
      st.map[tsHex]!.building = { type: 'ts', player: 0 };
    });
    const a: Action = {
      type: 'ship-action',
      action: 'ship-upgrade-ts-lab',
      ship: 'twilight',
      payload: { hex: tsHex, techTile: s.board.techTilePositions.sci },
    };
    const next = applyAction(s, a, { assumeLegal: true });
    expect(next.map[tsHex]!.building?.type).toBe('lab');
    expect(next.players[0]!.techTiles).toContain(s.board.techTilePositions.sci);
  });
});

describe('LF：新建筑并入邻近联邦', () => {
  it('建矿落在己联邦相邻格时该矿登记进联邦（参考 addBuildingToNearbyFederation）', () => {
    let s = actionPhase(CONFIG_LF);
    let h2!: HexKey;
    s = rig(s, (st) => {
      st.pending = null;
      // 手术构造三连格（直接改星球类型）：h0/h1 放矿组联邦，h2 建矿
      const anyPlanets = (Object.keys(st.map) as HexKey[]).filter((k) => st.map[k]!.building === undefined);
      const h0 = anyPlanets.find((k) => anyPlanets.filter((k2) => k2 !== k && dist(k, k2) <= 1).length >= 2)!;
      const pair = anyPlanets.filter((k) => k !== h0 && dist(k, h0) <= 1);
      const h1 = pair[0]!;
      const h3 = pair[1]!;
      for (const k of [h0, h1, h3] as HexKey[]) {
        st.map[k]!.planet = 'terra';
      }
      st.map[h0]!.building = { type: 'mine', player: 0 };
      st.map[h1]!.building = { type: 'mine', player: 0 };
      st.map[h0]!.federations = [0];
      st.map[h1]!.federations = [0];
      st.players[0]!.resources.ore = 15;
      st.players[0]!.resources.credits = 30;
      h2 = h3!;
    });
    const next = applyAction(s, { type: 'build-mine', hex: h2 }, { assumeLegal: true });
    expect(next.map[h2]!.federations).toContain(0);
  });
});

describe('LF：终局资源结算（burn → III 区换 credits → qic 换 ore）', () => {
  it('finalScoring 后 III 区清空、credits 按 spendablePower 增加（上限 30）、qic 归零', () => {
    let s = actionPhase(CONFIG_LF);
    const idx = 0;
    const bowl1Before = s.players[idx]!.power.bowl1;
    s = rig(s, (st) => {
      st.pending = null;
      const p = st.players[idx]!;
      p.power.bowl2 = 4;
      p.power.bowl3 = 5;
      p.resources.qic = 3;
      p.resources.credits = 28;
      p.resources.ore = 2;
      st.round = 6;
      st.passedPlayers = [1, 2, 3];
      st.currentPlayerIdx = idx;
    });
    const next = applyAction(s, { type: 'pass', booster: null });
    expect(next.phase).toBe('game-over');
    const p = next.players[idx]!;
    // burn 2（II 区 4 → III +2）：bowl3 5→7；III 区 7 → credits（28+7=35 → 上限 30）
    expect(p.power.bowl2).toBe(0);
    expect(p.power.bowl3).toBe(0);
    expect(p.power.bowl1).toBe(bowl1Before + 7); // 回流的 7 个 token
    expect(p.resources.credits).toBe(30);
    expect(p.resources.qic).toBe(0);
    expect(p.resources.ore).toBe(2 + 3);
  });
});

describe('LF：ship-terraform-step 走参考 spaceship 建矿路径（shipCreditBuild）', () => {
  /** 己方矿邻格（无建筑/飞船），改造成指定星球类型。 */
  function rigNeighborPlanet(st: GameState, idx: number, planet: 'gaia' | 'proto' | 'asteroid'): HexKey {
    const colony = (Object.keys(st.map) as HexKey[]).find((k) => st.map[k]!.building?.player === idx)!;
    const near = (Object.keys(st.map) as HexKey[]).find(
      (k) =>
        st.map[k]!.building === undefined &&
        st.map[k]!.ship === undefined &&
        st.map[k]!.gaiaformerOf === undefined &&
        dist(k, colony) <= 1,
    )!;
    st.map[near]!.planet = planet;
    return near;
  }

  function rigTfmars(st: GameState, idx: number): void {
    st.pending = null;
    rigShuttleLf(st, 'tfmars', idx);
    const p = st.players[idx]!;
    p.resources = { ore: 12, credits: 12, knowledge: 0, qic: 0 };
    // 回合板换成与研究无关的，避免建矿 vp 干扰断言。
    st.board.roundScoring = ['score2', 'score2', 'score2', 'score2', 'score2', 'score2'];
  }

  it('Gaia 星球建矿不收居住费（qic=0 也可建；对比普通建矿收 1q）', () => {
    let s = actionPhase(CONFIG_LF);
    const idx = s.currentPlayerIdx;
    let gaiaHex!: HexKey;
    s = rig(s, (st) => {
      rigTfmars(st, idx);
      gaiaHex = rigNeighborPlanet(st, idx, 'gaia');
    });
    // 枚举应包含该 Gaia 目标（qic=0 也负担得起：无居住费、无补程）。
    const acts = enumerateActions(s, idx).filter(
      (a): a is Extract<Action, { type: 'ship-action' }> =>
        a.type === 'ship-action' && a.action === 'ship-terraform-step' && a.payload?.hex === gaiaHex,
    );
    expect(acts).toHaveLength(1);
    const next = applyAction(s, acts[0]!);
    const p = next.players[idx]!;
    expect(next.map[gaiaHex]!.building?.type).toBe('mine');
    expect(p.resources.qic).toBe(0); // 未收 1q 居住费
    expect(p.resources.ore).toBe(12 - 1); // 仅矿费 1o
    expect(p.resources.credits).toBe(12 - 3 - 2); // 船费 3c + 矿费 2c

    // 对照：同一局面普通 build-mine 仍收 1q（qic=0 不在枚举内）。
    const normalMines = enumerateActions(s, idx).filter(
      (a) => a.type === 'build-mine' && a.hex === gaiaHex,
    );
    expect(normalMines).toHaveLength(0);
  });

  it('proto 星球建矿不得 +6vp（普通建矿仍得）', () => {
    let s = actionPhase(CONFIG_LF);
    const idx = s.currentPlayerIdx;
    let protoHex!: HexKey;
    s = rig(s, (st) => {
      rigTfmars(st, idx);
      protoHex = rigNeighborPlanet(st, idx, 'proto');
    });
    const vpBefore = s.players[idx]!.vp;
    const act = enumerateActions(s, idx).find(
      (a): a is Extract<Action, { type: 'ship-action' }> =>
        a.type === 'ship-action' && a.action === 'ship-terraform-step' && a.payload?.hex === protoHex,
    );
    expect(act).toBeDefined();
    // proto 3 步 terraform，1 免费步 → 付 2 步 ×3o = 6o + 矿费 1o+2c。
    const next = applyAction(s, act!);
    const p = next.players[idx]!;
    expect(next.map[protoHex]!.building?.type).toBe('mine');
    expect(p.resources.ore).toBe(12 - 6 - 1);
    expect(p.vp).toBe(vpBefore); // 不得 proto +6vp

    // 对照：普通 build-mine 在 proto 上 +6vp（资源与 3 步费用备足）。
    let s2 = rig(s, (st) => {
      st.players[idx]!.resources = { ore: 20, credits: 12, knowledge: 0, qic: 0 };
    });
    s2 = applyAction(s2, { type: 'build-mine', hex: protoHex });
    expect(s2.players[idx]!.vp).toBe(vpBefore + 6);
  });

  it('asteroid 不可作为目标（即使有可用 gaiaformer）', () => {
    let s = actionPhase(CONFIG_LF);
    const idx = s.currentPlayerIdx;
    let astHex!: HexKey;
    s = rig(s, (st) => {
      rigTfmars(st, idx);
      astHex = rigNeighborPlanet(st, idx, 'asteroid');
      st.players[idx]!.gaiaformers = { total: 1, available: 1, lost: 0, inGaia: 0 };
    });
    const acts = enumerateActions(s, idx).filter(
      (a) => a.type === 'ship-action' && a.action === 'ship-terraform-step' && a.payload?.hex === astHex,
    );
    expect(acts).toHaveLength(0);
  });
});
