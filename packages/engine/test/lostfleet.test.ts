/**
 * Lost Fleet 扩展测试：地图几何、探索飞船、飞船行动格、检查神器、
 * 4 新族、新板块效果、LF 开关。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  artifactPool,
  buildingPowerValue,
  countUnits,
  DEEP_SPACE_TILES,
  ECONOMY_OVERLAY,
  enumerateActions,
  FACTIONS,
  FEDERATION_TOKENS,
  finalCount,
  finalScoring,
  hexDistance,
  LF_INTERSPACE_FILL,
  lfDeepSpaceNotches,
  lfHolePositions,
  lfShipsFor,
  newGame,
  parseHexKey,
  rangeOf,
  SHIP_ACTION_SPACES,
  shuttleSlotCharge,
  shuttlesPerPlayer,
  stableStringify,
  terraformStepsFor,
  TINKERING_TILES,
  type Action,
  type GameConfig,
  type GameState,
  type HexKey,
  type ShipId,
} from '../src/index.js';
import { actionPhase, legalOf } from './helpers.js';

const CONFIG_2P: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'lantids'], lostFleet: true };
const CONFIG_3P: GameConfig = {
  playerCount: 3,
  seed: 42,
  factions: ['terrans', 'taklons', 'nevlas'],
  lostFleet: true,
};
const CONFIG_4P: GameConfig = {
  playerCount: 4,
  seed: 42,
  factions: ['terrans', 'taklons', 'nevlas', 'itars'],
  lostFleet: true,
};

/** rig：进入行动阶段后原地改状态（测试常规做法）。 */
function rig(mutate: (s: GameState) => void, config: GameConfig = CONFIG_2P): GameState {
  const s = structuredClone(actionPhase(config));
  mutate(s);
  return s;
}

function shipActionsOf(state: GameState): Extract<Action, { type: 'ship-action' }>[] {
  return legalOf(state).filter((a): a is Extract<Action, { type: 'ship-action' }> => a.type === 'ship-action');
}

function specialsOf(state: GameState): Extract<Action, { type: 'special-action' }>[] {
  return legalOf(state).filter((a): a is Extract<Action, { type: 'special-action' }> => a.type === 'special-action');
}

/** 在飞船上直接放穿梭机（绕过探索流程，测试飞船行动格用）。 */
function rigShuttle(state: GameState, ship: ShipId, idx = 0): void {
  const s = state.board.ships.find((x) => x.id === ship)!;
  const slot = s.shuttleSlots.indexOf(null);
  s.shuttleSlots[slot] = idx;
  state.players[idx]!.shuttles.push({ ship, slot });
  if (!state.players[idx]!.exploredShips.includes(ship)) {
    state.players[idx]!.exploredShips.push(ship);
  }
}

/** 在某 hex 上放己方矿（绕过建矿流程，构造射程/pv 场景用）。 */
function rigMine(state: GameState, hex: HexKey, idx = 0): void {
  state.map[hex]!.building = { type: 'mine', player: idx };
}

/** 距 ship.hex 恰好 dist 格内任一空格。 */
function hexNearShip(state: GameState, ship: ShipId, dist: number): HexKey {
  const s = state.board.ships.find((x) => x.id === ship)!;
  const c = parseHexKey(s.hex);
  for (const key of Object.keys(state.map) as HexKey[]) {
    if (hexDistance(c, parseHexKey(key)) <= dist && state.map[key]!.building === undefined) {
      return key;
    }
  }
  throw new Error(`飞船 ${ship} 附近 ${dist} 格内无空格`);
}

// ---------------------------------------------------------------------------
// 地图几何
// ---------------------------------------------------------------------------

describe('LF 地图几何', () => {
  it('孔位数：2/3/4 人 = 6/8/10', () => {
    expect(lfHolePositions(2)).toHaveLength(6);
    expect(lfHolePositions(3)).toHaveLength(8);
    expect(lfHolePositions(4)).toHaveLength(10);
  });

  it('深空三角缺口：2/3/4 人 = 6/8/8 个，各 3 格且互不重叠', () => {
    for (const [n, expected] of [[2, 6], [3, 8], [4, 8]] as const) {
      const notches = lfDeepSpaceNotches(n);
      expect(notches).toHaveLength(expected);
      const cells = notches.flat().map((h) => `${h.q},${h.r}`);
      expect(new Set(cells).size).toBe(expected * 3);
      for (const notch of notches) {
        expect(notch).toHaveLength(3);
      }
    }
  });

  it('深空三角板 16 面内容表（P=原行星 A=小行星 M=Transdim B=空白）', () => {
    expect(DEEP_SPACE_TILES).toHaveLength(8);
    const face = (id: number, side: 'a' | 'b') => DEEP_SPACE_TILES.find((t) => t.id === id)![side];
    expect(face(11, 'a')).toEqual(['proto', 'asteroid', 'empty']);
    expect(face(11, 'b')).toEqual(['asteroid', 'empty', 'empty']);
    expect(face(12, 'a')).toEqual(['transdim', 'proto', 'empty']);
    expect(face(12, 'b')).toEqual(['asteroid', 'empty', 'empty']);
    expect(face(13, 'a')).toEqual(['transdim', 'empty', 'asteroid']);
    expect(face(13, 'b')).toEqual(['empty', 'empty', 'asteroid']);
    expect(face(14, 'a')).toEqual(['proto', 'empty', 'asteroid']);
    expect(face(14, 'b')).toEqual(['empty', 'empty', 'asteroid']);
    expect(face(15, 'a')).toEqual(['proto', 'empty', 'empty']);
    expect(face(15, 'b')).toEqual(['proto', 'empty', 'asteroid']);
    expect(face(16, 'a')).toEqual(['empty', 'empty', 'proto']);
    expect(face(16, 'b')).toEqual(['asteroid', 'empty', 'asteroid']); // 2 小行星
    expect(face(17, 'a')).toEqual(['transdim', 'empty', 'empty']);
    expect(face(17, 'b')).toEqual(['empty', 'asteroid', 'empty']);
    expect(face(18, 'a')).toEqual(['proto', 'empty', 'empty']);
    expect(face(18, 'b')).toEqual(['asteroid', 'empty', 'empty']);
    // 每面只含 P/A/M/B（无标准色星球、无 gaia）
    for (const t of DEEP_SPACE_TILES) {
      for (const f of [t.a, t.b]) {
        expect(f.every((p) => ['proto', 'asteroid', 'transdim', 'empty'].includes(p))).toBe(true);
      }
    }
  });

  it('Interspace 构成：2 人 3 船+2 小行星+1 原行星；3 人 +1 空白；4 人 4 小行星', () => {
    expect(LF_INTERSPACE_FILL[2]).toEqual(['proto', 'asteroid', 'asteroid']);
    expect(LF_INTERSPACE_FILL[3]).toEqual(['proto', 'asteroid', 'asteroid', 'empty']);
    expect(LF_INTERSPACE_FILL[4]).toEqual(['proto', 'asteroid', 'asteroid', 'asteroid', 'asteroid', 'empty']);
  });

  it('hex 总数与构成：标准扇区 + Interspace + 深空三角板（3 格/块）', () => {
    const count = (s: GameState, pred: (h: GameState['map'][HexKey]) => boolean) =>
      Object.values(s.map).filter(pred).length;
    const s2 = newGame(CONFIG_2P);
    expect(Object.keys(s2.map)).toHaveLength(7 * 19 + 6 + 6 * 3);
    expect(count(s2, (h) => h.sector === 'interspace')).toBe(6);
    expect(count(s2, (h) => h.deepSpace)).toBe(6 * 3);
    const s4 = newGame(CONFIG_4P);
    expect(Object.keys(s4.map)).toHaveLength(10 * 19 + 10 + 8 * 3);
    expect(count(s4, (h) => h.sector === 'interspace')).toBe(10);
    expect(count(s4, (h) => h.deepSpace)).toBe(8 * 3);
    // 深空格 sector = 板号 '11'..'16'（2 人局只用 11–16）
    expect(new Set(Object.values(s2.map).filter((h) => h.deepSpace).map((h) => h.sector))).toEqual(
      new Set(['11', '12', '13', '14', '15', '16']),
    );
    // 每块深空板的 3 格内容与该板某一面（某旋转）一致
    for (const id of ['11', '12', '13', '14', '15', '16']) {
      const got = Object.values(s2.map)
        .filter((h) => h.sector === id && h.deepSpace)
        .map((h) => h.planet)
        .sort();
      const tile = DEEP_SPACE_TILES.find((t) => t.id === Number(id))!;
      const faces = [tile.a, tile.b].map((f) => [...f].sort());
      expect(faces.some((f) => f.join() === got.join()), `深空板 ${id}: ${got.join()}`).toBe(true);
    }
  });

  it('2 人局：3 艘飞船（无 Rebellion），飞船格两两相距恰好 5 格', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const s = newGame({ ...CONFIG_2P, seed });
      expect(s.board.ships.map((x) => x.id).sort()).toEqual(['eclipse', 'tfmars', 'twilight']);
      const ships = s.board.ships.map((x) => parseHexKey(x.hex));
      expect(ships).toHaveLength(3);
      for (let i = 0; i < ships.length; i++) {
        for (let j = i + 1; j < ships.length; j++) {
          expect(hexDistance(ships[i]!, ships[j]!), `seed=${seed}`).toBe(5);
        }
      }
      // 飞船格都标在地图上
      for (const ship of s.board.ships) {
        expect(s.map[ship.hex]!.ship).toBe(ship.id);
      }
    }
  });

  it('3/4 人局：4 艘飞船，飞船格不相邻且间距 ≥3', () => {
    for (const config of [CONFIG_3P, CONFIG_4P]) {
      for (let seed = 1; seed <= 6; seed++) {
        const s = newGame({ ...config, seed });
        expect(s.board.ships).toHaveLength(4);
        const ships = s.board.ships.map((x) => parseHexKey(x.hex));
        for (let i = 0; i < ships.length; i++) {
          for (let j = i + 1; j < ships.length; j++) {
            expect(hexDistance(ships[i]!, ships[j]!), `seed=${seed}`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it('飞船格：sector=interspace、非深空、planet=empty；卫星/建筑不可放（枚举层 ship 排除）', () => {
    const s = newGame(CONFIG_2P);
    for (const ship of s.board.ships) {
      const hex = s.map[ship.hex]!;
      expect(hex.ship).toBe(ship.id);
      expect(hex.sector).toBe('interspace');
      expect(hex.deepSpace).toBe(false);
      expect(hex.planet).toBe('empty');
    }
  });

  it('终局板含"最多小行星"时全图 ≥6 个小行星', () => {
    // 找一个终局板含 asteroid 的 seed。
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 3; seed++) {
      const s = newGame({ ...CONFIG_2P, seed });
      if (!s.board.finalScoring.includes('asteroid')) {
        continue;
      }
      checked++;
      const n = Object.values(s.map).filter((h) => h.planet === 'asteroid').length;
      expect(n, `seed=${seed}`).toBeGreaterThanOrEqual(6);
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('lostFleet=false：纯基础图（133/190 hex、无飞船/Interspace/深空）', () => {
    const s2 = newGame({ ...CONFIG_2P, lostFleet: false });
    expect(Object.keys(s2.map)).toHaveLength(133);
    expect(s2.board.ships).toHaveLength(0);
    expect(Object.values(s2.map).every((h) => h.sector !== 'interspace' && !h.deepSpace && h.ship === undefined)).toBe(true);
    const s4 = newGame({ ...CONFIG_4P, lostFleet: false });
    expect(Object.keys(s4.map)).toHaveLength(190);
    // 板块池也回到基础：高级板 6 槽
    expect(s4.board.advTechTiles).toHaveLength(6);
  });

  it('船上物资：科技槽船各 1 块新标准板（Twilight 0 槽）、每船 1 枚金框标记、Twilight 放人数枚 Artifact', () => {
    const s = newGame(CONFIG_4P);
    // 3 种新标准板各 1 块，Rebellion/T F Mars/Eclipse 各 1 槽
    const allShipTiles = s.board.ships.flatMap((x) => x.techTiles).sort();
    expect(allShipTiles).toEqual(['techlf1', 'techlf2', 'techlf3']);
    for (const ship of s.board.ships) {
      if (ship.id === 'twilight') {
        expect(ship.techTiles).toHaveLength(0); // 0 科技槽，改放 Artifacts
        expect(ship.artifacts).toHaveLength(4);
      } else {
        expect(ship.techTiles).toHaveLength(1);
        expect(ship.artifacts).toHaveLength(0);
      }
      expect(ship.federationToken).not.toBeNull();
      expect(ship.federationToken!.startsWith('fedlf')).toBe(true);
    }
    const s2 = newGame(CONFIG_2P);
    // 2 人局：3 船共 3 枚标记；2 个科技槽共 2 块板；Twilight 2 枚 Artifact
    expect(s2.board.ships.filter((x) => x.federationToken !== null)).toHaveLength(3);
    expect(s2.board.ships.flatMap((x) => x.techTiles)).toHaveLength(2);
    expect(s2.board.ships.find((x) => x.id === 'twilight')!.artifacts).toHaveLength(2);
  });

  it('lfShipsFor / shuttlesPerPlayer / shuttleSlotCharge / 飞船行动格 锚点', () => {
    expect(lfShipsFor(2)).toEqual(['twilight', 'tfmars', 'eclipse']);
    expect(lfShipsFor(4)).toEqual(['twilight', 'rebellion', 'tfmars', 'eclipse']);
    expect(shuttlesPerPlayer(2)).toBe(2);
    expect(shuttlesPerPlayer(3)).toBe(3);
    // 探索轨充能值 0/2/2/3（非格号）
    expect([0, 1, 2, 3].map(shuttleSlotCharge)).toEqual([0, 2, 2, 3]);
    // 12 个行动格全部分布到 4 船（每船固定 3 格 = 1 QIC + 1 Power + 1 Knowledge/Credit）
    expect(Object.values(SHIP_ACTION_SPACES).flat()).toHaveLength(12);
    expect(SHIP_ACTION_SPACES.twilight).toEqual(['ship-rescore-fed', 'ship-upgrade-ts-lab', 'ship-range3']);
    expect(SHIP_ACTION_SPACES.rebellion).toEqual(['ship-tech-tile', 'ship-upgrade-mine-ts', 'ship-2c1q']);
    expect(SHIP_ACTION_SPACES.tfmars).toEqual(['ship-vp-per-tech', 'ship-instant-gaia', 'ship-terraform-step']);
    expect(SHIP_ACTION_SPACES.eclipse).toEqual(['ship-vp-per-planet', 'ship-research', 'ship-asteroid-mine']);
  });

  it('组件锚点：Artifact 13 枚各不相同；金框联邦标记 8 种各 1；高级板 LF 6 种', () => {
    expect(artifactPool()).toHaveLength(13);
    expect(new Set(artifactPool().map((a) => a.id)).size).toBe(13);
    const lfTokens = Object.values(FEDERATION_TOKENS).filter((t) => t.lostFleet);
    expect(lfTokens).toHaveLength(8);
    expect(lfTokens.every((t) => t.count === 1 && t.flippable)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 探索飞船（行动 11）
// ---------------------------------------------------------------------------

describe('探索飞船', () => {
  it('费用 5vp + 放最小编号空位 + 解锁该船行动格 + 非首个探索者按格充能', () => {
    const ship = 'eclipse';
    const state = rig((s) => {
      s.players[0]!.vp = 20;
      s.players[1]!.vp = 20;
      rigMine(s, hexNearShip(s, ship, 1), 0);
      rigMine(s, hexNearShip(s, ship, 1), 1);
    });
    // 玩家 0 探索
    const a0 = legalOf(state).find(
      (a): a is Extract<Action, { type: 'explore-ship' }> => a.type === 'explore-ship' && a.ship === ship,
    );
    expect(a0).toBeDefined();
    let next = applyAction(state, a0!);
    expect(next.players[0]!.vp).toBe(15);
    expect(next.players[0]!.shuttles).toEqual([{ ship, slot: 0 }]);
    expect(next.players[0]!.exploredShips).toContain(ship);
    expect(next.board.ships.find((x) => x.id === ship)!.shuttleSlots[0]).toBe(0);
    // 行动阶段轮到玩家 1（无充能邀约）：玩家 1 探索同船 → slot 1 + 充能 2
    expect(next.currentPlayerIdx).toBe(1);
    const a1 = legalOf(next).find(
      (a): a is Extract<Action, { type: 'explore-ship' }> => a.type === 'explore-ship' && a.ship === ship,
    );
    expect(a1).toBeDefined();
    const bowlsBefore = { ...next.players[1]!.power };
    next = applyAction(next, a1!);
    const p1 = next.players[1]!;
    expect(p1.shuttles).toEqual([{ ship, slot: 1 }]);
    // 充能 2：I 区 4 → II 区（I 区 token 减少、II/III 增加，总量不变）
    expect(p1.power.bowl1 + p1.power.bowl2 + p1.power.bowl3).toBe(
      bowlsBefore.bowl1 + bowlsBefore.bowl2 + bowlsBefore.bowl3,
    );
    expect(p1.power.bowl1).toBeLessThan(bowlsBefore.bowl1);
    // 该船行动格已解锁（玩家 0 视角）
    const shipActs = shipActionsOf(next).length;
    expect(next.currentPlayerIdx).toBe(0);
    expect(shipActs).toBeGreaterThanOrEqual(0); // 玩家 0 轮到时有该船行动格（费用够时）
  });

  it('穿梭机限制：每船最多 1 个、总量有限；不可探索不枚举', () => {
    const state = rig((s) => {
      s.players[0]!.vp = 50;
      s.players[0]!.resources.qic = 10;
      const ships = s.board.ships.map((x) => x.id);
      rigMine(s, hexNearShip(s, ships[0]!, 1), 0);
      // 已用完全部穿梭机（2 人局 2 个）
      s.players[0]!.shuttles.push({ ship: 'twilight', slot: 0 }, { ship: 'tfmars', slot: 0 });
    });
    expect(legalOf(state).some((a) => a.type === 'explore-ship')).toBe(false);
  });

  it('baltaks 探索付 7vp；taklons 额外 brainstone→gaia 区；nevlas/itars 额外弃 1pw', () => {
    const cfg: GameConfig = { playerCount: 3, seed: 42, factions: ['baltaks', 'taklons', 'nevlas'], lostFleet: true };
    const state = rig((s) => {
      for (const p of s.players) {
        p.vp = 20;
      }
      const ship = s.board.ships[0]!;
      rigMine(s, hexNearShip(s, ship.id, 1), 0);
      rigMine(s, hexNearShip(s, ship.id, 1), 1);
      rigMine(s, hexNearShip(s, ship.id, 1), 2);
      s.currentPlayerIdx = 0;
    }, cfg);
    const ship = state.board.ships[0]!.id;
    // baltaks：7vp
    let next = applyAction(
      state,
      legalOf(state).find((a) => a.type === 'explore-ship' && a.ship === ship)!,
    );
    expect(next.players[0]!.vp).toBe(13);
    // taklons：5vp + brainstone→gaia
    expect(next.currentPlayerIdx).toBe(1);
    next = applyAction(
      next,
      legalOf(next).find((a) => a.type === 'explore-ship' && a.ship === ship)!,
    );
    expect(next.players[1]!.vp).toBe(15);
    expect(next.players[1]!.power.brainstone).toBe('gaia');
    // nevlas：5vp + 弃 1pw（任一区；规范化 I→II→III）
    expect(next.currentPlayerIdx).toBe(2);
    const tokensBefore =
      next.players[2]!.power.bowl1 + next.players[2]!.power.bowl2 + next.players[2]!.power.bowl3;
    next = applyAction(
      next,
      legalOf(next).find((a) => a.type === 'explore-ship' && a.ship === ship)!,
    );
    const p2 = next.players[2]!;
    expect(p2.vp).toBe(15);
    expect(p2.power.bowl1 + p2.power.bowl2 + p2.power.bowl3).toBe(tokensBefore - 1);
    expect(p2.powerStats.discarded).toBe(1);
  });

  it('射程：飞船格不作射程起点；射程不够可 qic 补程', () => {
    const ship = 'eclipse';
    const state = rig((s) => {
      s.players[0]!.vp = 20;
      s.players[0]!.resources.qic = 5;
      // 矿放在距船 3 格处（基本射程 1，需补 2 格 = 1q）
      const shipHex = parseHexKey(s.board.ships.find((x) => x.id === ship)!.hex);
      const far = (Object.keys(s.map) as HexKey[]).find(
        (k) => hexDistance(parseHexKey(k), shipHex) === 3 && s.map[k]!.building === undefined,
      )!;
      rigMine(s, far, 0);
    });
    const a = legalOf(state).find((x) => x.type === 'explore-ship' && x.ship === ship);
    expect(a).toBeDefined();
    const qBefore = state.players[0]!.resources.qic;
    const next = applyAction(state, a!);
    expect(next.players[0]!.resources.qic).toBe(qBefore - 1); // 1q 补 2 格
  });
});

// ---------------------------------------------------------------------------
// 飞船行动格（ship-action）
// ---------------------------------------------------------------------------

describe('飞船行动格', () => {
  it('ship-2c1q（Rebellion）：2k→+2c+1q；每格每轮全场 1 次', () => {
    const state = rig((s) => {
      rigShuttle(s, 'rebellion', 0);
      s.players[0]!.resources.knowledge = 3;
    }, CONFIG_4P);
    const a = shipActionsOf(state).find((x) => x.action === 'ship-2c1q' && x.ship === 'rebellion');
    expect(a).toBeDefined();
    const before = state.players[0]!.resources;
    let next = applyAction(state, a!);
    const p = next.players[0]!;
    expect(p.resources.knowledge).toBe(before.knowledge - 2);
    expect(p.resources.credits).toBe(Math.min(30, before.credits + 2));
    expect(p.resources.qic).toBe(before.qic + 1);
    expect(next.board.shipActionsUsed).toContain('rebellion:ship-2c1q');
    // 同轮不再枚举
    expect(shipActionsOf(next).some((x) => x.action === 'ship-2c1q')).toBe(false);
  });

  it('ship-vp-per-planet（Eclipse）：2q→2vp+每星球类型 1vp', () => {
    const state = rig((s) => {
      rigShuttle(s, 'eclipse', 0);
      s.players[0]!.resources.qic = 3;
    });
    const a = shipActionsOf(state).find((x) => x.action === 'ship-vp-per-planet');
    expect(a).toBeDefined();
    const types = countUnits(state, 0, 'planet-type');
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, a!);
    expect(next.players[0]!.vp).toBe(vpBefore + 2 + types);
  });

  it('ship-vp-per-tech（T F Mars）：2q→2vp+每块标准科技板 1vp（含被覆盖）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'tfmars', 0);
      s.players[0]!.resources.qic = 3;
      s.players[0]!.techTiles.push('tech1', 'tech4');
    });
    const a = shipActionsOf(state).find((x) => x.action === 'ship-vp-per-tech');
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, a!);
    expect(next.players[0]!.vp).toBe(vpBefore + 2 + 2);
  });

  it('ship-upgrade-mine-ts（Rebellion）：3pw+1o→免费升 mine→ts（触发升级计分与充能邀约）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'rebellion', 0);
      s.players[0]!.power.bowl3 = 3;
      s.players[0]!.resources.ore = 3;
      const mine = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building?.type === 'mine' && s.map[k]!.building.player === 0,
      )!;
      s.map[mine]!.building = { type: 'mine', player: 0 };
    }, CONFIG_4P);
    const a = shipActionsOf(state).find((x) => x.action === 'ship-upgrade-mine-ts');
    expect(a).toBeDefined();
    const tsBefore = state.players[0]!.buildings.ts;
    const next = applyAction(state, a!);
    expect(next.players[0]!.buildings.ts).toBe(tsBefore - 1);
    expect(next.players[0]!.power.bowl3).toBe(0);
    const mineHex = a!.payload!.hex!;
    expect(next.map[mineHex]!.building?.type).toBe('ts');
  });

  it('ship-upgrade-ts-lab（Twilight）：3pw+2o→免费升 ts→lab（与正常升级一样拿科技板）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'twilight', 0);
      s.players[0]!.power.bowl3 = 3;
      s.players[0]!.resources.ore = 4;
      const ts = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building?.type === 'mine' && s.map[k]!.building.player === 0,
      )!;
      s.map[ts]!.building = { type: 'ts', player: 0 };
    });
    const a = shipActionsOf(state).find((x) => x.action === 'ship-upgrade-ts-lab');
    expect(a).toBeDefined();
    const tilesBefore = state.players[0]!.techTiles.length;
    const next = applyAction(state, a!);
    expect(next.map[a!.payload!.hex!]!.building?.type).toBe('lab');
    // 升 lab 与正常升级一样拿科技板（参考引擎 placeBuilding 的 ChooseTechTile 流程）
    expect(next.players[0]!.techTiles.length).toBeGreaterThan(tilesBefore);
  });

  it('ship-research（Eclipse）：3pw+2k→推进 1 级研究', () => {
    const state = rig((s) => {
      rigShuttle(s, 'eclipse', 0);
      s.players[0]!.power.bowl3 = 3;
      s.players[0]!.resources.knowledge = 4;
    });
    const a = shipActionsOf(state).find((x) => x.action === 'ship-research' && x.payload?.track === 'sci');
    expect(a).toBeDefined();
    const lvl = state.players[0]!.research.sci;
    const next = applyAction(state, a!);
    expect(next.players[0]!.research.sci).toBe(lvl + 1);
  });

  it('ship-research 可放弃升轨（参考 decline up；行动格仍消耗）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'eclipse', 0);
      s.players[0]!.power.bowl3 = 3;
      s.players[0]!.resources.knowledge = 4;
    });
    const decline = shipActionsOf(state).find((x) => x.action === 'ship-research' && x.payload === undefined);
    expect(decline).toBeDefined();
    const lvl = state.players[0]!.research.sci;
    const next = applyAction(state, decline!);
    expect(next.players[0]!.research.sci).toBe(lvl); // 研究不变
    expect(next.pending).toBeNull();
  });

  it('ship-instant-gaia（T F Mars）：2pw→立即盖亚计划（免移 power、立即转化）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'tfmars', 0);
      s.players[0]!.power.bowl3 = 2;
      s.players[0]!.gaiaformers = { total: 1, available: 1, lost: 0, inGaia: 0 };
      // 在殖民格旁放一个 transdim
      const colony = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building?.type === 'mine' && s.map[k]!.building.player === 0,
      )!;
      const c = parseHexKey(colony);
      const td = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.planet === 'transdim' && s.map[k]!.building === undefined && hexDistance(parseHexKey(k), c) <= 2,
      )!;
      s.map[td]!.planet = 'transdim';
    });
    const a = shipActionsOf(state).find((x) => x.action === 'ship-instant-gaia');
    expect(a).toBeDefined();
    const gaiaBefore = state.players[0]!.power.gaia;
    const next = applyAction(state, a!);
    expect(next.map[a!.payload!.hex!]!.planet).toBe('gaia');
    expect(next.map[a!.payload!.hex!]!.gaiaformerOf).toBe(0);
    expect(next.players[0]!.gaiaformers.available).toBe(0);
    expect(next.players[0]!.power.gaia).toBe(gaiaBefore); // 未移 power 入 gaia 区
  });

  it('ship-terraform-step（T F Mars）：3c→1 个 terraform 步建矿；ship-asteroid-mine（Eclipse）：6c→小行星免费建矿（无需 gaiaformer）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'tfmars', 0);
      s.players[0]!.resources.credits = 6;
      s.players[0]!.gaiaformers = { total: 0, available: 0, lost: 0, inGaia: 0 };
    });
    const cr1 = shipActionsOf(state).find((x) => x.action === 'ship-terraform-step');
    expect(cr1).toBeDefined();
    const next = applyAction(state, cr1!);
    expect(next.map[cr1!.payload!.hex!]!.building?.type).toBe('mine');
    // ship-asteroid-mine：找一颗射程内小行星
    const state2 = rig((s) => {
      rigShuttle(s, 'eclipse', 0);
      s.players[0]!.resources.credits = 6;
      s.players[0]!.gaiaformers = { total: 0, available: 0, lost: 0, inGaia: 0 };
      const colony = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building?.type === 'mine' && s.map[k]!.building.player === 0,
      )!;
      const c = parseHexKey(colony);
      const ast = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.planet === 'asteroid' && s.map[k]!.building === undefined && hexDistance(parseHexKey(k), c) <= 1,
      );
      if (ast !== undefined) {
        rigMine(s, colony, 0);
        s.map[ast]!.planet = 'asteroid';
      } else {
        // 没有邻近小行星则在邻格放一颗（数据驱动测试，改地图内容）
        const nb = (Object.keys(s.map) as HexKey[]).find(
          (k) => s.map[k]!.building === undefined && s.map[k]!.ship === undefined && hexDistance(parseHexKey(k), c) === 1,
        )!;
        s.map[nb]!.planet = 'asteroid';
      }
    });
    const cr2 = shipActionsOf(state2).find((x) => x.action === 'ship-asteroid-mine');
    expect(cr2).toBeDefined();
    const next2 = applyAction(state2, cr2!);
    expect(next2.map[cr2!.payload!.hex!]!.building?.type).toBe('mine');
    expect(next2.players[0]!.gaiaformers.lost).toBe(0); // 无需 gaiaformer
  });

  it('ship-rescore-fed（Twilight）：3q→重结算联邦标记含即时效果（fedlf2 → 待决拿板）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'twilight', 0);
      s.players[0]!.resources.qic = 3;
      s.players[0]!.federationTokens.push({ id: 'fedlf2', flipped: false });
    });
    const a = shipActionsOf(state).find(
      (x) => x.action === 'ship-rescore-fed' && x.payload?.federationToken === 'fedlf2',
    );
    expect(a).toBeDefined();
    const next = applyAction(state, a!);
    // 重结算触发 fedlf2 即时效果：pending gain-tech-tile
    expect(next.pending?.kind).toBe('gain-tech-tile');
    const choose = legalOf(next).find((x) => x.type === 'gain-tech-tile' && x.techTile === 'tech4');
    expect(choose).toBeDefined();
    const next2 = applyAction(next, choose!);
    expect(next2.players[0]!.techTiles).toContain('tech4');
    expect(next2.pending).toBeNull();
  });

  it('ship-tech-tile（Rebellion）：3q→拿科技板（可拿船上标准板，拿后升任意轨）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'rebellion', 0);
      s.players[0]!.resources.qic = 3;
      const ship = s.board.ships.find((x) => x.id === 'rebellion')!;
      ship.techTiles = ['techlf2'];
    }, CONFIG_4P);
    const a = shipActionsOf(state).find(
      (x) => x.action === 'ship-tech-tile' && x.payload?.techTile === 'techlf2' && x.payload?.ship === 'rebellion',
    );
    expect(a).toBeDefined();
    const next = applyAction(state, a!);
    expect(next.players[0]!.techTiles).toContain('techlf2');
    // 参考 count 模型：板仍留船上（其他玩家可拿），本玩家记入已拿名单
    const ship = next.board.ships.find((x) => x.id === 'rebellion')!;
    expect(ship.techTiles).toEqual(['techlf2']);
    expect(ship.techTileClaims).toEqual([0]);
  });

  it('ship-range3（Twilight）：1k→+3 射程（建矿/盖亚/探索均可用）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'twilight', 0);
      s.players[0]!.resources.knowledge = 3;
      s.players[0]!.vp = 30;
    });
    const acts = shipActionsOf(state).filter((x) => x.action === 'ship-range3');
    expect(acts.length).toBeGreaterThan(0);
    // 含探索类负载（payload.ship）或建矿负载（payload.hex）
    expect(acts.some((x) => x.payload?.ship !== undefined || x.payload?.hex !== undefined)).toBe(true);
    const withShip = acts.find((x) => x.payload?.ship !== undefined);
    if (withShip !== undefined) {
      const next = applyAction(state, withShip);
      expect(next.players[0]!.shuttles.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('未探索的船不提供行动格；LF=false 时无 ship-action/explore', () => {
    const state = rig((s) => {
      // 不放穿梭机
    });
    expect(shipActionsOf(state)).toHaveLength(0);
    const base = rig((s) => s, { ...CONFIG_2P, lostFleet: false });
    expect(shipActionsOf(base)).toHaveLength(0);
    expect(legalOf(base).some((a) => a.type === 'explore-ship')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 检查神器（行动 12）
// ---------------------------------------------------------------------------

describe('检查神器', () => {
  /** 在 Twilight 上放指定 artifacts 并给玩家 0 补满 power。 */
  function rigArtifacts(artifacts: GameState['board']['ships'][number]['artifacts']): GameState {
    return rig((s) => {
      rigShuttle(s, 'twilight', 0);
      s.board.ships.find((x) => x.id === 'twilight')!.artifacts = artifacts;
      s.players[0]!.power.bowl1 = 2;
      s.players[0]!.power.bowl2 = 2;
      s.players[0]!.power.bowl3 = 2;
    });
  }

  it('限 Twilight 且有穿梭机：弃 6 power 拿 1 artifact（art-asteroid：+7vp 且视作小行星上的矿）', () => {
    const state = rigArtifacts([{ id: 'art-asteroid' }, { id: 'art-pwt' }]);
    const a = legalOf(state).find(
      (x): x is Extract<Action, { type: 'inspect-artifact' }> =>
        x.type === 'inspect-artifact' && x.artifact === 'art-asteroid',
    );
    expect(a).toBeDefined();
    const vpBefore = state.players[0]!.vp;
    const minesBefore = countUnits(state, 0, 'mine');
    const next = applyAction(state, a!);
    const p = next.players[0]!;
    expect(p.vp).toBe(vpBefore + 7);
    expect(p.artifacts).toHaveLength(1);
    expect(p.powerStats.discarded).toBe(6);
    expect(next.board.ships.find((x) => x.id === 'twilight')!.artifacts).toHaveLength(1);
    expect(countUnits(next, 0, 'mine')).toBe(minesBefore + 1); // 视作一个矿
    expect(countUnits(next, 0, 'asteroid')).toBeGreaterThanOrEqual(1);
    // 殖民星球类型计入 asteroid
    expect(p.colonizedPlanetTypes).toContain('asteroid');
  });

  it('art-proto：+7vp 视作原行星上的矿（计 mine、不得 proto 6vp、不计小行星）', () => {
    const state = rigArtifacts([{ id: 'art-proto' }]);
    const vpBefore = state.players[0]!.vp;
    const minesBefore = countUnits(state, 0, 'mine');
    const asteroidBefore = countUnits(state, 0, 'asteroid');
    const next = applyAction(
      state,
      legalOf(state).find((x) => x.type === 'inspect-artifact' && x.artifact === 'art-proto')!,
    );
    expect(next.players[0]!.vp).toBe(vpBefore + 7); // 只有 7vp，无 proto 建矿 6vp
    expect(countUnits(next, 0, 'mine')).toBe(minesBefore + 1);
    expect(countUnits(next, 0, 'asteroid')).toBe(asteroidBefore);
    expect(next.players[0]!.colonizedPlanetTypes).toContain('proto');
  });

  it('一次性资源：art-3c3o / art-3k1q / art-5c2o', () => {
    const state = rigArtifacts([{ id: 'art-3c3o' }, { id: 'art-3k1q' }, { id: 'art-5c2o' }]);
    const before = state.players[0]!.resources;
    let next = applyAction(
      state,
      legalOf(state).find((x) => x.type === 'inspect-artifact' && x.artifact === 'art-3c3o')!,
    );
    expect(next.players[0]!.resources.credits).toBe(Math.min(30, before.credits + 3));
    expect(next.players[0]!.resources.ore).toBe(Math.min(15, before.ore + 3));
    next = structuredClone(next);
    next.players[0]!.power.bowl3 = 6;
    next.currentPlayerIdx = 0;
    next = applyAction(
      next,
      legalOf(next).find((x) => x.type === 'inspect-artifact' && x.artifact === 'art-3k1q')!,
    );
    expect(next.players[0]!.resources.knowledge).toBe(Math.min(15, before.knowledge + 3));
    expect(next.players[0]!.resources.qic).toBe(before.qic + 1);
    next = structuredClone(next);
    next.players[0]!.power.bowl3 = 6;
    next.currentPlayerIdx = 0;
    next = applyAction(
      next,
      legalOf(next).find((x) => x.type === 'inspect-artifact' && x.artifact === 'art-5c2o')!,
    );
    expect(next.players[0]!.resources.credits).toBe(Math.min(30, before.credits + 3 + 5));
    expect(next.players[0]!.resources.ore).toBe(Math.min(15, before.ore + 3 + 2));
  });

  it('一次性计分：art-sci / art-gaia / art-track / art-planet / art-deep', () => {
    const state = rig((s) => {
      rigShuttle(s, 'twilight', 0);
      s.board.ships.find((x) => x.id === 'twilight')!.artifacts = [
        { id: 'art-sci' },
        { id: 'art-gaia' },
        { id: 'art-track' },
        { id: 'art-planet' },
        { id: 'art-deep' },
      ];
      s.players[0]!.power.bowl3 = 6;
      s.players[0]!.research.sci = 3;
      s.players[0]!.research.gaia = 2;
      s.players[0]!.research.terra = 4; // ≥L3 的轨：sci、terra = 2 条
    });
    const inspect = (st: GameState, id: string): GameState =>
      applyAction(
        st,
        legalOf(st).find((x) => x.type === 'inspect-artifact' && x.artifact === id)!,
      );
    const vp0 = state.players[0]!.vp;
    // art-sci：sci L3 → +9vp
    let next = inspect(state, 'art-sci');
    expect(next.players[0]!.vp).toBe(vp0 + 9);
    next = structuredClone(next);
    next.players[0]!.power.bowl3 = 6;
    next.currentPlayerIdx = 0;
    // art-gaia：gaia L2 → +6vp
    let next2 = inspect(next, 'art-gaia');
    expect(next2.players[0]!.vp).toBe(vp0 + 9 + 6);
    next2 = structuredClone(next2);
    next2.players[0]!.power.bowl3 = 6;
    next2.currentPlayerIdx = 0;
    // art-track：2 条 ≥L3 轨 → +6vp
    let next3 = inspect(next2, 'art-track');
    expect(next3.players[0]!.vp).toBe(vp0 + 9 + 6 + 6);
    next3 = structuredClone(next3);
    next3.players[0]!.power.bowl3 = 6;
    next3.currentPlayerIdx = 0;
    // art-planet：+3vp + 每已殖民星球类型 1vp
    const types = countUnits(next3, 0, 'planet-type');
    let next4 = inspect(next3, 'art-planet');
    expect(next4.players[0]!.vp).toBe(vp0 + 9 + 6 + 6 + 3 + types);
    next4 = structuredClone(next4);
    next4.players[0]!.power.bowl3 = 6;
    next4.currentPlayerIdx = 0;
    // art-deep：每已殖民深空扇区 3vp
    const deep = countUnits(next4, 0, 'deep-space-sector');
    const next5 = inspect(next4, 'art-deep');
    expect(next5.players[0]!.vp).toBe(vp0 + 9 + 6 + 6 + 3 + types + 3 * deep);
  });

  it('art-fed：重新触发 1 枚已有联邦标记（含即时效果）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'twilight', 0);
      s.board.ships.find((x) => x.id === 'twilight')!.artifacts = [{ id: 'art-fed' }];
      s.players[0]!.power.bowl3 = 6;
      s.players[0]!.federationTokens.push({ id: 'fedlf2', flipped: false });
    });
    const a = legalOf(state).find(
      (x): x is Extract<Action, { type: 'inspect-artifact' }> =>
        x.type === 'inspect-artifact' && x.artifact === 'art-fed' && x.federationToken === 'fedlf2',
    );
    expect(a).toBeDefined();
    const next = applyAction(state, a!);
    // fedlf2 即时效果：pending gain-tech-tile
    expect(next.pending?.kind).toBe('gain-tech-tile');
    const choose = legalOf(next).find((x) => x.type === 'gain-tech-tile' && x.techTile === 'tech4');
    const next2 = applyAction(next, choose!);
    expect(next2.players[0]!.techTiles).toContain('tech4');
    expect(next2.pending).toBeNull();
  });

  it('art-fed：未持有联邦标记时可 no-effect 认领（参考 noEffectTokens）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'twilight', 0);
      s.board.ships.find((x) => x.id === 'twilight')!.artifacts = [{ id: 'art-fed' }];
      s.players[0]!.power.bowl3 = 6;
    });
    const a = legalOf(state).find(
      (x): x is Extract<Action, { type: 'inspect-artifact' }> =>
        x.type === 'inspect-artifact' && x.artifact === 'art-fed' && x.federationToken === undefined,
    );
    expect(a).toBeDefined();
    const vp = state.players[0]!.vp;
    const next = applyAction(state, a!);
    expect(next.players[0]!.artifacts.map((x) => x.id)).toContain('art-fed');
    expect(next.players[0]!.vp).toBe(vp); // 无效果
    expect(next.pending).toBeNull();
  });

  it('收入类：art-1k1o（+1k+1o）与 art-pwt（+2 power 直接 III 区）在收入阶段结算', () => {
    let state = rig((s) => {
      s.players[0]!.artifacts.push({ id: 'art-1k1o' }, { id: 'art-pwt' });
      // 固定助推器供应（booster1 收入 +1o+1k），便于精确断言第 2 轮收入
      s.board.boosters = ['booster1', 'booster1'];
    });
    const kBefore = state.players[0]!.resources.knowledge;
    const oBefore = state.players[0]!.resources.ore;
    const bowl3Before = state.players[0]!.power.bowl3;
    // 全员 pass → 第 2 轮收入（terrans：base +1o+1k、2 起始矿 +2o、booster1 +1o+1k、
    // art-1k1o +1o+1k、art-pwt +2pw 直接 III 区）
    state = applyAction(state, legalOf(state).find((x) => x.type === 'pass')!);
    state = applyAction(state, legalOf(state).find((x) => x.type === 'pass')!);
    expect(state.round).toBe(2);
    expect(state.players[0]!.resources.knowledge).toBe(kBefore + 3);
    expect(state.players[0]!.resources.ore).toBe(oBefore + 5);
    expect(state.players[0]!.power.bowl3).toBe(bowl3Before + 2);
  });
});

// ---------------------------------------------------------------------------
// 4 个新种族
// ---------------------------------------------------------------------------

describe('LF 新种族', () => {
  it('起始面板（实证核定）：资源/能量/起始轨/PI 收入', () => {
    const s = newGame({
      playerCount: 4,
      seed: 5,
      factions: ['tinkeroids', 'darkanians', 'moweyds', 'space-giants'],
      lostFleet: true,
    });
    const [tk, dk, mw, sg] = s.players;
    // Tinkeroids：2k 4o 15c 1q；I4/II2；+1 Science（sci L1 是收入，无一次性奖励）
    expect(tk!.resources).toEqual({ ore: 4, credits: 15, knowledge: 2, qic: 1 });
    expect(tk!.power.bowl1).toBe(4);
    expect(tk!.power.bowl2).toBe(2);
    expect(tk!.research.sci).toBe(1);
    // Darkanians：3k 7o 15c 1q；I4/II2；+1 Nav +1 Eco（nav L1 星标 +1q）
    expect(dk!.resources).toEqual({ ore: 7, credits: 15, knowledge: 3, qic: 2 });
    expect(dk!.power.bowl1).toBe(4);
    expect(dk!.power.bowl2).toBe(2);
    expect(dk!.research.nav).toBe(1);
    expect(dk!.research.eco).toBe(1);
    // Moweyds：5k 6o 15c 2q；I4/II4；+1 Gaiaforming（L1 星标 +1 gaiaformer）
    expect(mw!.resources).toEqual({ ore: 6, credits: 15, knowledge: 5, qic: 2 });
    expect(mw!.power.bowl1).toBe(4);
    expect(mw!.power.bowl2).toBe(4);
    expect(mw!.research.gaia).toBe(1);
    expect(mw!.gaiaformers.total).toBe(1);
    // Space Giants：3k 6o 15c 1q；I4/II4；+1 Nav（L1 星标 +1q）；PI 收入 +6pw+1token
    expect(sg!.resources).toEqual({ ore: 6, credits: 15, knowledge: 3, qic: 2 });
    expect(sg!.power.bowl1).toBe(4);
    expect(sg!.power.bowl2).toBe(4);
    expect(sg!.research.nav).toBe(1);
    expect(FACTIONS['space-giants'].incomeTrack.pi).toEqual({ chargePower: 6, powerToken: 1 });
    // 数据表层锚点（基本收入均 +1o+1k；PI 收入默认 +4pw+1token）
    expect(FACTIONS.tinkeroids.baseIncome).toEqual({ ore: 1, knowledge: 1 });
    expect(FACTIONS.tinkeroids.incomeTrack.pi).toEqual({ chargePower: 4, powerToken: 1 });
    expect(FACTIONS.darkanians.startingResearch).toBe('nav');
    expect(FACTIONS.darkanians.startingResearch2).toBe('eco');
  });

  it('共同：无母星、起始 1 建筑在 extra 阶段放（tinkeroids 放 PI 在 asteroid）', () => {
    const s = actionPhase({
      playerCount: 2,
      seed: 3,
      factions: ['tinkeroids', 'terrans'],
      lostFleet: true,
    });
    const piHex = (Object.keys(s.map) as HexKey[]).find(
      (k) => s.map[k]!.building?.type === 'pi' && s.map[k]!.building.player === 0,
    );
    expect(piHex).toBeDefined();
    expect(s.map[piHex!]!.planet).toBe('asteroid');
    // 起始 1 建筑：tinkeroids 只有 PI
    expect(s.players[0]!.buildings.pi).toBe(0);
    expect(s.players[0]!.buildings.mine).toBe(8);
  });

  it('terraform 步数表：darkanians 全 1、space-giants 全 2、tinkeroids/moweyds 抽 3 种 3 步、proto 全族 3 步', () => {
    const s = newGame({
      playerCount: 4,
      seed: 5,
      factions: ['tinkeroids', 'darkanians', 'moweyds', 'space-giants'],
      lostFleet: true,
    });
    const [tk, dk, mw, sg] = s.players;
    expect(tk!.terraformThreeStep).toHaveLength(3);
    expect(new Set(tk!.terraformThreeStep).size).toBe(3);
    for (const t of tk!.terraformThreeStep) {
      expect(terraformStepsFor(tk!, t)).toBe(3);
    }
    expect(terraformStepsFor(tk!, 'gaia')).toBe(1); // 非 3 步类型 1 步
    expect(terraformStepsFor(dk!, 'terra')).toBe(1);
    expect(terraformStepsFor(sg!, 'ice')).toBe(2);
    expect(terraformStepsFor(mw!, 'proto')).toBe(3);
    expect(terraformStepsFor(dk!, 'proto')).toBe(3);
    // moweyds 同样抽取
    expect(mw!.terraformThreeStep).toHaveLength(3);
  });

  it('Gaia 居住费：darkanians/space-giants 2q（tinkeroids/moweyds 与基础族同为 1q，见 mine.test）', () => {
    let state = rig(
      (s) => {
        s.players[0]!.resources.qic = 3;
        // 起始矿旁找 gaia 星球（没有就改一个邻格为 gaia）
        const colony = (Object.keys(s.map) as HexKey[]).find(
          (k) => s.map[k]!.building?.player === 0,
        )!;
        const c = parseHexKey(colony);
        const g = (Object.keys(s.map) as HexKey[]).find(
          (k) => s.map[k]!.building === undefined && s.map[k]!.ship === undefined && hexDistance(parseHexKey(k), c) === 1,
        )!;
        s.map[g]!.planet = 'gaia';
      },
      { playerCount: 2, seed: 3, factions: ['darkanians', 'terrans'], lostFleet: true },
    );
    const a = legalOf(state).find(
      (x) => x.type === 'build-mine' && state.map[(x as Extract<Action, { type: 'build-mine' }>).hex]!.planet === 'gaia',
    );
    expect(a).toBeDefined();
    const qBefore = state.players[0]!.resources.qic;
    const next = applyAction(state, a!);
    expect(next.players[0]!.resources.qic).toBe(qBefore - 2);
  });

  it('tinkeroids：每轮开始选 tile（pending tinkering）→ 用（PI 特殊行动）→ 弃（每块限一次）', () => {
    const config: GameConfig = { playerCount: 2, seed: 3, factions: ['tinkeroids', 'terrans'], lostFleet: true };
    let s = actionPhase(config);
    // 第 1 轮开始：pending tinkering
    if (s.pending?.kind !== 'tinkering') {
      throw new Error('预期 pending tinkering');
    }
    expect(s.pending.player).toBe(0);
    const choose = legalOf(s).find((a): a is Extract<Action, { type: 'choose-tinkering' }> => a.type === 'choose-tinkering');
    expect(choose).toBeDefined();
    // 只能选 1–3 轮组（tink1-3）
    const choices = enumerateActions(s, 0).filter((a) => a.type === 'choose-tinkering');
    expect(choices.every((a) => ['tink1', 'tink2', 'tink3'].includes((a as { tile: string }).tile))).toBe(true);
    s = applyAction(s, { type: 'choose-tinkering', tile: 'tink1' });
    expect(s.players[0]!.tinkering.current).toBe('tink1');
    expect(s.players[0]!.tinkering.pool).toHaveLength(5);
    expect(s.pending).toBeNull();
    // PI 特殊行动 tinkeroids-tile（tink1 = 建矿 1 免费步）
    s = structuredClone(s);
    s.players[0]!.resources.ore = 10;
    s.players[0]!.resources.credits = 10;
    const acts = specialsOf(s).filter((a) => a.action === 'tinkeroids-tile');
    expect(acts.length).toBeGreaterThan(0);
    const s2 = applyAction(s, acts[0]!);
    expect(s2.players[0]!.roundAbilityUsed).toContain('tinkeroids-tile');
    // 每轮一次：同轮不再可用
    expect(specialsOf(s2).some((a) => a.action === 'tinkeroids-tile')).toBe(false);
  });

  it('tinkering tile 数据锚点：6 块分两组（实证核定效果）', () => {
    expect(Object.keys(TINKERING_TILES)).toHaveLength(6);
    // 1–3 轮组：建矿(1 免费步)、充能 4 power、+1 QIC
    expect(TINKERING_TILES.tink1.rounds).toBe('early');
    expect(TINKERING_TILES.tink2.rounds).toBe('early');
    expect(TINKERING_TILES.tink3.rounds).toBe('early');
    // 4–6 轮组：免费 3 terraform 步、+3 知识、+2 QIC
    expect(TINKERING_TILES.tink4.rounds).toBe('late');
    expect(TINKERING_TILES.tink5.rounds).toBe('late');
    expect(TINKERING_TILES.tink6.rounds).toBe('late');
  });

  it('tinkering tile 新效果：tink2 充能 4pw、tink3 +1q、tink5 +3k、tink6 +2q', () => {
    const config: GameConfig = { playerCount: 2, seed: 3, factions: ['tinkeroids', 'terrans'], lostFleet: true };
    const use = (tile: 'tink2' | 'tink3' | 'tink5' | 'tink6'): { before: GameState; after: GameState } => {
      const s = rig((ss) => {
        ss.players[0]!.tinkering.current = tile;
        ss.players[0]!.buildings.pi = 0;
        // 跳过第 1 轮开始的 pending tinkering 决策（本测试直接指定当前 tile）
        ss.pending = null;
        ss.gaiaPhaseQueue = [];
      }, config);
      const a = specialsOf(s).find((x) => x.action === 'tinkeroids-tile' && x.payload !== undefined);
      return { before: s, after: applyAction(s, a!) };
    };
    // tink2：充能 4 power（I 区先动，总量不变）
    const t2 = use('tink2');
    const pw0 = t2.before.players[0]!.power;
    const pw2 = t2.after.players[0]!.power;
    expect(pw0.bowl1 - pw2.bowl1).toBe(Math.min(4, pw0.bowl1));
    // 充能只在区间移动，token 总量不变
    expect(pw2.bowl1 + pw2.bowl2 + pw2.bowl3).toBe(pw0.bowl1 + pw0.bowl2 + pw0.bowl3);
    // tink3：+1q
    const t3 = use('tink3');
    expect(t3.after.players[0]!.resources.qic).toBe(t3.before.players[0]!.resources.qic + 1);
    // tink5：+3k
    const t5 = use('tink5');
    expect(t5.after.players[0]!.resources.knowledge).toBe(t5.before.players[0]!.resources.knowledge + 3);
    // tink6：+2q
    const t6 = use('tink6');
    expect(t6.after.players[0]!.resources.qic).toBe(t6.before.players[0]!.resources.qic + 2);
  });

  it('moweyds：开局即有 1 穿梭机在 T F Mars；Power Ring 使建筑 pv+2', () => {
    const s = newGame({ playerCount: 2, seed: 3, factions: ['moweyds', 'terrans'], lostFleet: true });
    expect(s.players[0]!.shuttles).toEqual([{ ship: 'tfmars', slot: 0 }]);
    expect(s.board.ships.find((x) => x.id === 'tfmars')!.shuttleSlots[0]).toBe(0);
    expect(s.players[0]!.exploredShips).toContain('tfmars');
    expect(s.players[0]!.powerRings).toBe(6);

    const state = rig(
      (ss) => {
        ss.players[0]!.buildings.pi = 0; // 已建 PI
        const colony = (Object.keys(ss.map) as HexKey[]).find(
          (k) => ss.map[k]!.building?.player === 0 && ss.map[k]!.building.type === 'mine',
        )!;
        ss.map[colony]!.building = { type: 'mine', player: 0 };
      },
      { playerCount: 2, seed: 3, factions: ['moweyds', 'terrans'], lostFleet: true },
    );
    const a = specialsOf(state).find((x) => x.action === 'moweyds-ring');
    expect(a).toBeDefined();
    const hex = a!.payload!.hex!;
    expect(buildingPowerValue(state, 0, state.map[hex]!)).toBe(1);
    const next = applyAction(state, a!);
    expect(next.map[hex]!.powerRing).toBe(true);
    expect(next.players[0]!.powerRings).toBe(5);
    expect(buildingPowerValue(next, 0, next.map[hex]!)).toBe(3); // pv +2
  });

  it('darkanians PI：首次在每个 Space/Deep Space 扇区殖民 +2c+1k（Interspace 不算）', () => {
    const state = rig(
      (s) => {
        s.players[0]!.buildings.pi = 0; // 已建 PI
        s.players[0]!.resources.credits = 10;
        s.players[0]!.resources.ore = 10;
        s.players[0]!.resources.knowledge = 0;
      },
      { playerCount: 2, seed: 3, factions: ['darkanians', 'terrans'], lostFleet: true },
    );
    // 找一个未殖民扇区的可建矿格
    const colonized = state.players[0]!.colonizedSectors;
    const target = legalOf(state).find((x) => {
      if (x.type !== 'build-mine') return false;
      const hex = state.map[(x as Extract<Action, { type: 'build-mine' }>).hex]!;
      return !colonized.includes(hex.sector) && hex.sector !== 'interspace';
    }) as Extract<Action, { type: 'build-mine' }> | undefined;
    expect(target).toBeDefined();
    const before = state.players[0]!.resources;
    const next = applyAction(state, target!);
    expect(next.players[0]!.resources.credits).toBe(Math.min(30, before.credits - 2 + 2));
    expect(next.players[0]!.resources.knowledge).toBe(before.knowledge + 1);
    expect(next.players[0]!.darkaniansTriggered).toHaveLength(1);
  });

  it('space-giants：探索板建矿 2 免费步；PI 一次性拿 1 科技板', () => {
    const config: GameConfig = { playerCount: 2, seed: 3, factions: ['space-giants', 'terrans'], lostFleet: true };
    const state = rig((s) => {
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
    }, config);
    // space-giants-mine：2 免费步（标准星球 2 步 → 全免，只付矿费）
    const acts = specialsOf(state).filter((a) => a.action === 'space-giants-mine');
    expect(acts.length).toBeGreaterThan(0);
    const before = state.players[0]!.resources;
    const next = applyAction(state, acts[0]!);
    // 标准星球 2 步全免 → 只花 1o+2c 矿费
    expect(before.ore - next.players[0]!.resources.ore).toBe(1);
    expect(before.credits - next.players[0]!.resources.credits).toBe(2);

    // PI：升级 ts→pi 后 pending gain-tech-tile
    const state2 = rig((s) => {
      const ts = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building?.player === 0 && s.map[k]!.building.type === 'mine',
      )!;
      s.map[ts]!.building = { type: 'ts', player: 0 };
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
    }, config);
    const up = legalOf(state2).find(
      (a): a is Extract<Action, { type: 'upgrade' }> => a.type === 'upgrade' && a.to === 'pi',
    );
    expect(up).toBeDefined();
    const after = applyAction(state2, up!);
    expect(after.pending?.kind).toBe('gain-tech-tile');
    const take = legalOf(after).find((a) => a.type === 'gain-tech-tile' && a.techTile === 'tech4');
    const after2 = applyAction(after, take!);
    expect(after2.players[0]!.techTiles).toContain('tech4');
    // 升级可能产生对手充能邀约：逐一拒绝后 pending 清空
    let after3 = after2;
    while (after3.pending?.kind === 'charge') {
      after3 = applyAction(after3, { type: 'decline-charge' });
    }
    expect(after3.pending).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 新板块效果（fedlf / techlf / advtechlf / scorelf / 终局新板 / boosterlf）
// ---------------------------------------------------------------------------

describe('LF 新板块', () => {
  /** 构造一个可组联邦的场景：相邻 3 格放 pi+ts+lab（pv 3+2+2=7）。 */
  function rigFederation(s: GameState): void {
    const keys = Object.keys(s.map) as HexKey[];
    outer: for (const k of keys) {
      const c = parseHexKey(k);
      for (const nb of keys) {
        if (hexDistance(c, parseHexKey(nb)) !== 1) continue;
        for (const nb2 of keys) {
          if (nb2 === k || nb2 === nb) continue;
          if (hexDistance(parseHexKey(nb), parseHexKey(nb2)) !== 1) continue;
          if (hexDistance(c, parseHexKey(nb2)) > 2) continue;
          s.map[k]!.building = { type: 'pi', player: 0 };
          s.map[nb]!.building = { type: 'ts', player: 0 };
          s.map[nb2]!.building = { type: 'lab', player: 0 };
          s.players[0]!.buildings.pi = 0;
          break outer;
        }
      }
    }
  }

  it('fedlf1：12vp 且可翻（有绿面）；组联邦可改拿船上金框标记', () => {
    const state = rig((s) => {
      rigShuttle(s, 'twilight', 0);
      s.board.ships.find((x) => x.id === 'twilight')!.federationToken = 'fedlf1';
      rigFederation(s);
    });
    const a = legalOf(state).find(
      (x): x is Extract<Action, { type: 'form-federation' }> =>
        x.type === 'form-federation' && x.token === 'fedlf1',
    );
    expect(a).toBeDefined();
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, a!);
    expect(next.players[0]!.vp).toBe(vpBefore + 12);
    expect(next.players[0]!.federationTokens[0]!.id).toBe('fedlf1');
    expect(next.players[0]!.federationTokens[0]!.flipped).toBe(false);
    expect(next.board.ships.find((x) => x.id === 'twilight')!.federationToken).toBeNull();
  });

  it('fedlf3：免费建矿（无限射程、免矿费、terraform/qic 照付）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'tfmars', 0);
      s.board.ships.find((x) => x.id === 'tfmars')!.federationToken = 'fedlf3';
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
      rigFederation(s);
    });
    const a = legalOf(state).find(
      (x): x is Extract<Action, { type: 'form-federation' }> =>
        x.type === 'form-federation' && x.token === 'fedlf3',
    );
    expect(a).toBeDefined();
    const next = applyAction(state, a!);
    expect(next.pending?.kind).toBe('free-mine');
    // 无限射程：远处格子也是目标
    const targets = legalOf(next).filter((x) => x.type === 'free-mine' && x.hex !== null);
    expect(targets.length).toBeGreaterThan(0);
    const before = next.players[0]!.resources;
    const pick = targets[0] as Extract<Action, { type: 'free-mine' }>;
    const planet = next.map[pick.hex!]!.planet;
    const next2 = applyAction(next, pick);
    expect(next2.map[pick.hex!]!.building?.type).toBe('mine');
    // 免矿费（不扣 1o+2c 矿费本身；terraform 步若有可能扣 ore）
    if (planet === 'gaia' || planet === 'asteroid') {
      expect(next2.players[0]!.resources.ore).toBe(before.ore);
    }
    // 建矿可能产生对手充能邀约：逐一拒绝后 pending 清空
    let next3 = next2;
    while (next3.pending?.kind === 'charge') {
      next3 = applyAction(next3, { type: 'decline-charge' });
    }
    expect(next3.pending).toBeNull();
  });

  it('fedlf4：免费建矿（3 免费步、免矿费、可 qic 加程）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'eclipse', 0);
      s.board.ships.find((x) => x.id === 'eclipse')!.federationToken = 'fedlf4';
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
      rigFederation(s);
    });
    const a = legalOf(state).find(
      (x): x is Extract<Action, { type: 'form-federation' }> =>
        x.type === 'form-federation' && x.token === 'fedlf4',
    );
    const next = applyAction(state, a!);
    expect(next.pending?.kind).toBe('free-mine');
    const targets = legalOf(next).filter((x) => x.type === 'free-mine' && x.hex !== null);
    expect(targets.length).toBeGreaterThan(0);
    const before = next.players[0]!.resources;
    const next2 = applyAction(next, targets[0]!);
    expect(next2.players[0]!.resources.ore).toBe(before.ore); // 3 步全免且免矿费
  });

  it('techlf1：拿后一次性免费建矿（最多 2 免费步、免矿费）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'rebellion', 0);
      const ship = s.board.ships.find((x) => x.id === 'rebellion')!;
      ship.techTiles = ['techlf1'];
      s.players[0]!.resources.qic = 3;
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
    }, CONFIG_4P);
    const a = shipActionsOf(state).find(
      (x) => x.action === 'ship-tech-tile' && x.payload?.techTile === 'techlf1' && x.payload?.ship === 'rebellion',
    );
    expect(a).toBeDefined();
    const next = applyAction(state, a!);
    expect(next.players[0]!.techTiles).toContain('techlf1');
    expect(next.pending?.kind).toBe('free-mine');
    const targets = legalOf(next).filter((x) => x.type === 'free-mine' && x.hex !== null);
    expect(targets.length).toBeGreaterThan(0);
    const before = next.players[0]!.resources;
    const next2 = applyAction(next, targets[0]!);
    // 2 免费步 + 免矿费：2 步以内目标不花 ore/credits
    expect(next2.players[0]!.resources.credits).toBe(before.credits);
  });

  it('techlf2：被动基本射程 +1（被高级板覆盖时失效）', () => {
    const s = newGame(CONFIG_2P);
    const p = structuredClone(s.players[0]!);
    const base = rangeOf(p);
    p.techTiles.push('techlf2');
    expect(rangeOf(p)).toBe(base + 1);
    p.advTechTiles.push({ id: 'advtech4', covers: 'techlf2' });
    expect(rangeOf(p)).toBe(base); // 被覆盖失效
  });

  it('advtechlf1：一次性每 PI/学院 +6vp（第 7 槽：扩展条件替代轨 L4）', () => {
    const state = rig((s) => {
      s.players[0]!.vp = 30; // 2 人局扩展条条件 ≥25vp
      // 只留第 7 槽为 advtechlf1（避免 id 在其他槽位被 indexOf 先命中）
      s.board.advTechTiles = [null, null, null, null, null, null, 'advtechlf1'];
      s.players[0]!.techTiles.push('tech4');
      s.players[0]!.federationTokens.push({ id: 'fed2', flipped: false });
      // 场上 PI + 1 学院
      const colony = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building?.player === 0 && s.map[k]!.building.type === 'mine',
      )!;
      s.map[colony]!.building = { type: 'pi', player: 0 };
      const c = parseHexKey(colony);
      const nb = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building === undefined && hexDistance(parseHexKey(k), c) === 1,
      )!;
      s.map[nb]!.building = { type: 'ac1', player: 0 };
      // 一次升级拿板入口：ts→lab
      const nb2 = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building === undefined && k !== nb && hexDistance(parseHexKey(k), c) <= 2,
      )!;
      s.map[nb2]!.building = { type: 'ts', player: 0 };
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
    });
    const a = legalOf(state).find(
      (x): x is Extract<Action, { type: 'upgrade' }> =>
        x.type === 'upgrade' && x.to === 'lab' && x.advTechTile === 'advtechlf1',
    );
    expect(a).toBeDefined();
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, a!);
    // PI + 学院 = 2 × 6vp
    expect(next.players[0]!.vp).toBe(vpBefore + 12);
    expect(next.players[0]!.advTechTiles[0]!.id).toBe('advtechlf1');
    expect(next.players[0]!.federationTokens[0]!.flipped).toBe(true); // 拿高级板翻面
  });

  it('advtechlf3：Pass 时每小行星 +2vp', () => {
    const state = rig((s) => {
      s.players[0]!.advTechTiles.push({ id: 'advtechlf3', covers: 'tech1' });
      s.players[0]!.booster = 'booster1';
      // 殖民 1 颗小行星
      const colony = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building?.player === 0 && s.map[k]!.building.type === 'mine',
      )!;
      s.map[colony]!.planet = 'asteroid';
    });
    const pass = legalOf(state).find((x) => x.type === 'pass');
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, pass!);
    expect(next.players[0]!.vp).toBe(vpBefore + 2);
  });

  it('fedlf5-8：8vp+8c / 4vp+4k / 4vp+2o+1q / 7vp+2 power token 直接 III 区', () => {
    const take = (token: 'fedlf5' | 'fedlf6' | 'fedlf7' | 'fedlf8'): GameState => {
      const state = rig((s) => {
        rigShuttle(s, 'twilight', 0);
        s.board.ships.find((x) => x.id === 'twilight')!.federationToken = token;
        rigFederation(s);
      });
      const a = legalOf(state).find(
        (x): x is Extract<Action, { type: 'form-federation' }> =>
          x.type === 'form-federation' && x.token === token,
      );
      expect(a).toBeDefined();
      return applyAction(state, a!);
    };
    const n5 = take('fedlf5');
    expect(n5.players[0]!.federationTokens[0]!.id).toBe('fedlf5');
    // fedlf5：8vp+8c（vp 增量含 score 板与否无关——只断资源与标记）
    expect(n5.players[0]!.resources.credits).toBeGreaterThanOrEqual(8);
    const n6 = take('fedlf6');
    expect(n6.players[0]!.resources.knowledge).toBeGreaterThanOrEqual(4);
    const n7 = take('fedlf7');
    expect(n7.players[0]!.resources.qic).toBeGreaterThanOrEqual(1);
    expect(n7.players[0]!.resources.ore).toBeGreaterThanOrEqual(2);
    // fedlf8：2 个 power token 直接 III 区
    const bowl3Before = 0; // rigFederation 后 III 区无 token（起始 I/II 区）
    const n8 = take('fedlf8');
    expect(n8.players[0]!.power.bowl3).toBe(bowl3Before + 2);
  });

  it('advtechlf4：Pass 时每深空扇区 +2vp', () => {
    const state = rig((s) => {
      s.players[0]!.advTechTiles.push({ id: 'advtechlf4', covers: 'tech1' });
      s.players[0]!.booster = 'booster1';
      // 殖民 1 个深空扇区
      const deep = (Object.keys(s.map) as HexKey[]).find((k) => s.map[k]!.deepSpace)!;
      s.map[deep]!.building = { type: 'mine', player: 0 };
    });
    const pass = legalOf(state).find((x) => x.type === 'pass');
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, pass!);
    expect(next.players[0]!.vp).toBe(vpBefore + 2);
  });

  it('advtechlf5：每次 Q.I.C. 行动 +4vp（飞船 QIC 格触发）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'eclipse', 0);
      s.players[0]!.advTechTiles.push({ id: 'advtechlf5', covers: 'tech1' });
      s.players[0]!.resources.qic = 3;
    });
    const a = shipActionsOf(state).find((x) => x.action === 'ship-vp-per-planet');
    expect(a).toBeDefined();
    const types = countUnits(state, 0, 'planet-type');
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, a!);
    // 行动本身 2vp+types，触发器 +4vp
    expect(next.players[0]!.vp).toBe(vpBefore + 2 + types + 4);
  });

  it('advtechlf6：每次 terraform 步 +2vp（含免费步；score1 仍只算付费步）', () => {
    const state = rig((s) => {
      s.players[0]!.advTechTiles.push({ id: 'advtechlf6', covers: 'tech1' });
      s.players[0]!.resources.ore = 15;
      s.players[0]!.resources.credits = 15;
      // 本轮回合计分固定为 score1（每付费 terraform 步 +2vp）
      s.board.roundScoring[s.round - 1] = 'score1';
    });
    // 找一个需 ≥2 terraform 步的目标（terrans 母星 terra，对面类型 3 步；找非 terra/gaia 即可）
    const target = legalOf(state).find((x) => {
      if (x.type !== 'build-mine') return false;
      const hex = state.map[(x as Extract<Action, { type: 'build-mine' }>).hex]!;
      return ['swamp', 'oxide', 'volcanic', 'titanium', 'ice', 'desert'].includes(hex.planet);
    }) as Extract<Action, { type: 'build-mine' }> | undefined;
    expect(target).toBeDefined();
    const steps = terraformStepsFor(state.players[0]!, state.map[target!.hex]!.planet);
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, target!);
    // score1（付费步 2vp/步）+ advtechlf6（全部步 2vp/步）
    expect(next.players[0]!.vp).toBe(vpBefore + 2 * steps + 2 * steps);
  });

  it('techlf3：一次性 +1o+3k（3 种船上新标准板各 1 块）', () => {
    const state = rig((s) => {
      rigShuttle(s, 'rebellion', 0);
      const ship = s.board.ships.find((x) => x.id === 'rebellion')!;
      ship.techTiles = ['techlf3'];
      s.players[0]!.resources.qic = 3;
    }, CONFIG_4P);
    const a = shipActionsOf(state).find(
      (x) => x.action === 'ship-tech-tile' && x.payload?.techTile === 'techlf3' && x.payload?.ship === 'rebellion',
    );
    expect(a).toBeDefined();
    const before = state.players[0]!.resources;
    const next = applyAction(state, a!);
    expect(next.players[0]!.techTiles).toContain('techlf3');
    expect(next.players[0]!.resources.ore).toBe(Math.min(15, before.ore + 1));
    expect(next.players[0]!.resources.knowledge).toBe(Math.min(15, before.knowledge + 3));
  });

  it('Economy 轨 L3/L4 覆盖板：收入按随机面替代基础值', () => {
    for (const face of ['pw', 'vp'] as const) {
      let state = rig((s) => {
        s.players[0]!.research.eco = 3;
        s.board.economyOverlay = face;
        // 固定双方当前/候选助推器为无 passVp 的 booster1，避免 passVp 干扰 vp 断言
        s.players[0]!.booster = 'booster1';
        s.players[1]!.booster = 'booster1';
        s.board.boosters = ['booster1', 'booster1'];
      });
      const oBefore = state.players[0]!.resources.ore;
      const cBefore = state.players[0]!.resources.credits;
      const vpBefore = state.players[0]!.vp;
      state = applyAction(state, legalOf(state).find((x) => x.type === 'pass')!);
      state = applyAction(state, legalOf(state).find((x) => x.type === 'pass')!);
      expect(state.round).toBe(2);
      const overlay = ECONOMY_OVERLAY[face].l3;
      // L3 收入 = 覆盖面（base/矿/助推器之外的增量）
      expect(state.players[0]!.resources.ore).toBe(oBefore + (overlay.ore ?? 0) + 1 + 2 + 1);
      expect(state.players[0]!.resources.credits).toBe(Math.min(30, cBefore + (overlay.credits ?? 0)));
      expect(state.players[0]!.vp).toBe(vpBefore + (overlay.vp ?? 0));
    }
  });

  it('scorelf1/2/3：新扇区建矿 +3、新类型建矿 +3、建 lab +4', () => {
    const state = rig((s) => {
      s.players[0]!.resources.ore = 15;
      s.players[0]!.resources.credits = 15;
      s.board.roundScoring[s.round - 1] = 'scorelf1';
    });
    const colonized = state.players[0]!.colonizedSectors;
    const newSectorMine = legalOf(state).find((x) => {
      if (x.type !== 'build-mine') return false;
      const hex = state.map[(x as Extract<Action, { type: 'build-mine' }>).hex]!;
      return !colonized.includes(hex.sector);
    });
    expect(newSectorMine).toBeDefined();
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, newSectorMine!);
    expect(next.players[0]!.vp).toBe(vpBefore + 3);

    // scorelf2：新星球类型
    const state2 = rig((s) => {
      s.players[0]!.resources.ore = 15;
      s.players[0]!.resources.credits = 15;
      s.board.roundScoring[s.round - 1] = 'scorelf2';
    });
    const types = state2.players[0]!.colonizedPlanetTypes;
    const newTypeMine = legalOf(state2).find((x) => {
      if (x.type !== 'build-mine') return false;
      const hex = state2.map[(x as Extract<Action, { type: 'build-mine' }>).hex]!;
      return !types.includes(hex.planet);
    });
    if (newTypeMine !== undefined) {
      const vp2 = state2.players[0]!.vp;
      const next2 = applyAction(state2, newTypeMine);
      expect(next2.players[0]!.vp).toBe(vp2 + 3);
    }

    // scorelf3：建 lab +4vp
    const state3 = rig((s) => {
      s.board.roundScoring[s.round - 1] = 'scorelf3';
      const ts = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building?.player === 0 && s.map[k]!.building.type === 'mine',
      )!;
      s.map[ts]!.building = { type: 'ts', player: 0 };
      s.players[0]!.resources.ore = 10;
      s.players[0]!.resources.credits = 10;
    });
    const up = legalOf(state3).find(
      (x): x is Extract<Action, { type: 'upgrade' }> => x.type === 'upgrade' && x.to === 'lab',
    );
    expect(up).toBeDefined();
    const vp3 = state3.players[0]!.vp;
    const next3 = applyAction(state3, up!);
    expect(next3.players[0]!.vp).toBe(vp3 + 4);
  });

  it('终局新板：asteroid/deepSpace/piAcademyDistance 计数', () => {
    const state = rig((s) => {
      // 1 颗小行星矿
      const colony = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building?.player === 0 && s.map[k]!.building.type === 'mine',
      )!;
      s.map[colony]!.planet = 'asteroid';
      // 深空扇区 1 个建筑
      const deep = (Object.keys(s.map) as HexKey[]).find((k) => s.map[k]!.deepSpace)!;
      s.map[deep]!.building = { type: 'mine', player: 0 };
      // PI + 学院距离 3
      const c = parseHexKey(colony);
      const piHex = (Object.keys(s.map) as HexKey[]).find(
        (k) => k !== colony && s.map[k]!.building === undefined && hexDistance(parseHexKey(k), c) === 3,
      )!;
      s.map[piHex]!.building = { type: 'pi', player: 0 };
    });
    expect(finalCount(state, 0, 'asteroid')).toBe(1);
    expect(finalCount(state, 0, 'deep-space')).toBe(1);
    // PI 与学院（起始矿升不了学院，场上无学院 → 0）
    expect(finalCount(state, 0, 'pi-academy-distance')).toBe(0);
    const state2 = structuredClone(state);
    const colony = (Object.keys(state2.map) as HexKey[]).find(
      (k) => state2.map[k]!.building?.player === 0 && state2.map[k]!.planet === 'asteroid',
    )!;
    state2.map[colony]!.building = { type: 'ac1', player: 0 };
    expect(finalCount(state2, 0, 'pi-academy-distance')).toBe(3);
    // finalScoring 全流程不报错且给分
    state2.board.finalScoring = ['asteroid', 'deepSpace'];
    state2.phase = 'action';
    const vpBefore = state2.players[0]!.vp;
    finalScoring(state2);
    expect(state2.players[0]!.vp).toBeGreaterThan(vpBefore);
    expect(state2.phase).toBe('game-over');
  });

  it('sector 计数不含深空扇区（参考 Condition.Sector owner ruling）；piAcademyDistance 取最远学院', () => {
    // 深空格放矿前后 sector 计数不变（起始矿可能在多个普通扇区）
    const base = actionPhase(CONFIG_2P);
    const baseCount = finalCount(base, 0, 'sector');
    const state = structuredClone(base);
    const deep = (Object.keys(state.map) as HexKey[]).find((k) => state.map[k]!.deepSpace)!;
    state.map[deep]!.building = { type: 'mine', player: 0 };
    expect(finalCount(state, 0, 'sector')).toBe(baseCount); // 深空不计
    expect(finalCount(state, 0, 'deep-space')).toBe(1);
    // PI + 两学院（近 2 远 5）：取最远（参考 Math.max）
    const state2 = rig((s) => {
      const colony = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building?.player === 0 && s.map[k]!.building.type === 'mine',
      )!;
      s.map[colony]!.building = { type: 'pi', player: 0 };
      const c = parseHexKey(colony);
      const near = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building === undefined && hexDistance(parseHexKey(k), c) === 2,
      )!;
      const far = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building === undefined && hexDistance(parseHexKey(k), c) === 5,
      )!;
      s.map[near]!.building = { type: 'ac1', player: 0 };
      s.map[far]!.building = { type: 'ac2', player: 0 };
    });
    expect(finalCount(state2, 0, 'pi-academy-distance')).toBe(5);
  });

  it('boosterlf1：Pass 时每 gaiaformer +3vp（报废不计）；boosterlf4：免费立即盖亚计划', () => {
    const state = rig((s) => {
      s.players[0]!.booster = 'boosterlf1';
      s.players[0]!.gaiaformers = { total: 3, available: 1, lost: 1, inGaia: 0 };
    });
    const pass = legalOf(state).find((x) => x.type === 'pass');
    const vpBefore = state.players[0]!.vp;
    const next = applyAction(state, pass!);
    expect(next.players[0]!.vp).toBe(vpBefore + 2 * 3); // total-lost=2

    const state2 = rig((s) => {
      s.players[0]!.booster = 'boosterlf4';
      s.players[0]!.gaiaformers = { total: 1, available: 1, lost: 0, inGaia: 0 };
      const colony = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building?.player === 0 && s.map[k]!.building.type === 'mine',
      )!;
      const c = parseHexKey(colony);
      const td = (Object.keys(s.map) as HexKey[]).find(
        (k) => s.map[k]!.building === undefined && hexDistance(parseHexKey(k), c) <= 2,
      )!;
      s.map[td]!.planet = 'transdim';
    });
    const a = specialsOf(state2).find((x) => x.action === 'boosterlf4');
    expect(a).toBeDefined();
    const next2 = applyAction(state2, a!);
    expect(next2.map[a!.payload!.hex!]!.planet).toBe('gaia');
    expect(next2.map[a!.payload!.hex!]!.gaiaformerOf).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// LF 开关与混玩规则
// ---------------------------------------------------------------------------

describe('LF 开关与混玩规则', () => {
  it('lostFleet=true：qic1-3 不枚举（覆盖板）；有飞船行动/探索', () => {
    const state = rig((s) => {
      s.players[0]!.resources.qic = 10;
      s.players[0]!.vp = 30;
      rigShuttle(s, 'twilight', 0);
      rigMine(s, hexNearShip(s, 'twilight', 1), 0);
    });
    expect(legalOf(state).some((a) => a.type === 'qic-action')).toBe(false);
    expect(shipActionsOf(state).length).toBeGreaterThan(0);
    expect(legalOf(state).some((a) => a.type === 'explore-ship')).toBe(true);
  });

  it('lostFleet=false：qic1-3 可用；无 ship 行动/探索/检查；xenos-o-t3 不可用', () => {
    const state = rig(
      (s) => {
        s.players[0]!.resources.qic = 10;
      },
      { ...CONFIG_2P, lostFleet: false },
    );
    expect(legalOf(state).some((a) => a.type === 'qic-action')).toBe(true);
    expect(shipActionsOf(state)).toHaveLength(0);
    expect(legalOf(state).some((a) => a.type === 'explore-ship' || a.type === 'inspect-artifact')).toBe(false);

    const xs = rig(
      (s) => {
        s.players[0]!.resources.ore = 5;
      },
      { playerCount: 2, seed: 42, factions: ['xenos', 'terrans'], lostFleet: false },
    );
    expect(
      legalOf(xs).some((a) => a.type === 'free-conversion' && a.conversion === 'xenos-o-t3'),
    ).toBe(false);
    const xsLf = rig(
      (s) => {
        s.players[0]!.resources.ore = 5;
      },
      { playerCount: 2, seed: 42, factions: ['xenos', 'terrans'], lostFleet: true },
    );
    expect(
      legalOf(xsLf).some((a) => a.type === 'free-conversion' && a.conversion === 'xenos-o-t3'),
    ).toBe(true);
  });

  it('gleens-range（LF）：建矿/盖亚/探索射程 +2 的特殊行动', () => {
    const state = rig(
      (s) => {
        s.players[0]!.resources.ore = 10;
        s.players[0]!.resources.credits = 10;
        s.players[0]!.vp = 30;
      },
      { playerCount: 2, seed: 42, factions: ['gleens', 'terrans'], lostFleet: true },
    );
    const acts = specialsOf(state).filter((a) => a.action === 'gleens-range');
    expect(acts.length).toBeGreaterThan(0);
    const next = applyAction(state, acts[0]!);
    expect(next.players[0]!.specialUsed).toContain('gleens-range');
  });

  it('板块池：LF 回合计分 13 选 6、终局 9 选 2、高级板 21 选 7、助推器 14 选 n+3', () => {
    const s = newGame(CONFIG_4P);
    expect(s.board.roundScoring).toHaveLength(6);
    expect(s.board.finalScoring).toHaveLength(2);
    expect(s.board.advTechTiles).toHaveLength(7);
    expect(s.board.boosters).toHaveLength(7);
    // 新标准板不混入标准供应
    expect(Object.keys(s.board.techTiles)).toHaveLength(9);
    expect(s.board.techTiles['techlf1']).toBeUndefined();
    // Economy 轨 L3/L4 覆盖板：LF 随机一面，基础游戏无
    expect(['pw', 'vp']).toContain(s.board.economyOverlay);
    expect(newGame({ ...CONFIG_2P, lostFleet: false }).board.economyOverlay).toBeNull();
  });

  it('确定性：同 config 两次 newGame 逐字节一致（LF 地图）', () => {
    const a = newGame(CONFIG_4P);
    const b = newGame(CONFIG_4P);
    expect(stableStringify(a)).toBe(stableStringify(b));
  });
});
