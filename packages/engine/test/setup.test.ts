/**
 * newGame / 地图生成 / 公共板块 / 玩家初始化 / setup 队列 测试。
 * 全部从包根公共 API 导入（src/index.ts）。
 */
import { describe, expect, it } from 'vitest';
import {
  advanceSetup,
  colonizedHexes,
  enumerateActions,
  FEDERATION_TOKENS,
  hexesWithin,
  IllegalActionError,
  isValidMap,
  mapNeighbors,
  minDistanceToAny,
  newGame,
  playerBuildings,
  settleSetupSkips,
  stableStringify,
  type GameConfig,
  type GameState,
} from '../src/index.js';

const CONFIG_2P: GameConfig = {
  playerCount: 2,
  seed: 42,
  factions: ['terrans', 'lantids'],
  lostFleet: true,
};

const CONFIG_4P: GameConfig = {
  playerCount: 4,
  seed: 42,
  factions: ['terrans', 'taklons', 'nevlas', 'itars'],
  lostFleet: true,
};

describe('确定性', () => {
  it('同 config 两次 newGame 逐字节一致', () => {
    const a = newGame(CONFIG_4P);
    const b = newGame(CONFIG_4P);
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('不同 seed 地图不同（抽查）', () => {
    const a = newGame({ ...CONFIG_4P, seed: 1 });
    const b = newGame({ ...CONFIG_4P, seed: 2 });
    expect(stableStringify(a.map)).not.toBe(stableStringify(b.map));
  });

  it('config 校验：人数/长度/重复种族', () => {
    expect(() => newGame({ playerCount: 5, seed: 1, factions: [] })).toThrow(IllegalActionError);
    expect(() => newGame({ playerCount: 2, seed: 1, factions: ['terrans'] })).toThrow(
      IllegalActionError,
    );
    expect(() =>
      newGame({ playerCount: 2, seed: 1, factions: ['terrans', 'terrans'] }),
    ).toThrow(IllegalActionError);
  });

  it('turnOrder：指定初始行动顺序（缺省座位序；非法排列抛错）', () => {
    const s = newGame({ ...CONFIG_2P, turnOrder: [1, 0] });
    expect(s.turnOrder).toEqual([1, 0]);
    expect(s.setupQueue[0]).toBe(1);
    expect(s.firstPlayer).toBe(1); // 第 1 轮行动权归 turnOrder 首位
    expect(s.config.turnOrder).toEqual([1, 0]);
    const d = newGame(CONFIG_2P);
    expect(d.turnOrder).toEqual([0, 1]);
    expect(d.firstPlayer).toBe(0);
    expect(d.config.turnOrder).toBeUndefined();
    expect(() => newGame({ ...CONFIG_2P, turnOrder: [0, 0] })).toThrow(IllegalActionError);
    expect(() => newGame({ ...CONFIG_2P, turnOrder: [0, 1, 2] })).toThrow(IllegalActionError);
  });
});

describe('地图', () => {
  it('2 人局 157 hex（19×7 + 6 Interspace + 3×6 深空三角板）且无重叠', () => {
    const s = newGame(CONFIG_2P);
    expect(Object.keys(s.map)).toHaveLength(157);
    expect(new Set(Object.keys(s.map)).size).toBe(157);
  });

  it('4 人局 224 hex（19×10 + 10 Interspace + 3×8 深空三角板）且无重叠', () => {
    const s = newGame(CONFIG_4P);
    expect(Object.keys(s.map)).toHaveLength(224);
    expect(new Set(Object.keys(s.map)).size).toBe(224);
  });

  it('多个 seed 生成结果均通过 isValidMap（german 邻接规则）', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = newGame({ ...CONFIG_4P, seed });
      expect(isValidMap(s.map), `seed=${seed}`).toBe(true);
    }
  });

  it('每个 hex 邻接数量在 3–6 之间（边缘不少于心内部）', () => {
    const s = newGame(CONFIG_4P);
    for (const key of Object.keys(s.map)) {
      const n = mapNeighbors(s.map, key as `${number},${number}`).length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('初始无建筑：colonizedHexes 全空', () => {
    const s = newGame(CONFIG_2P);
    expect(colonizedHexes(s.map, 0)).toHaveLength(0);
    expect(colonizedHexes(s.map, 1)).toHaveLength(0);
  });
});

describe('地图查询助手', () => {
  /** 在 2 人局地图上放几个建筑，构造查询场景。 */
  function mapWithBuildings() {
    const s = newGame(CONFIG_2P);
    const keys = Object.keys(s.map) as `${number},${number}`[];
    const [k0, k1, k2] = keys as [
      `${number},${number}`,
      `${number},${number}`,
      `${number},${number}`,
    ];
    const map = { ...s.map };
    map[k0] = { ...map[k0]!, building: { type: 'mine', player: 0 } };
    map[k1] = { ...map[k1]!, building: { type: 'gf', player: 0 } }; // gaiaformer 不算殖民
    map[k2] = { ...map[k2]!, building: { type: 'sp', player: 1 }, additionalMine: 0 };
    return { map, k0, k1, k2 };
  }

  it('playerBuildings 含 gf/sp、不含附加矿', () => {
    const { map, k0, k1 } = mapWithBuildings();
    const b0 = playerBuildings(map, 0).map((b) => b.hex);
    expect(b0.sort()).toEqual([k0, k1].sort());
    expect(playerBuildings(map, 1)).toHaveLength(1);
  });

  it('colonizedHexes：mine 算、gf/sp 不算、Lantids 附加矿算', () => {
    const { map, k0, k2 } = mapWithBuildings();
    expect(colonizedHexes(map, 0).sort()).toEqual([k0, k2].sort());
    expect(colonizedHexes(map, 1)).toHaveLength(0); // 只有 sp
  });

  it('hexesWithin / minDistanceToAny', () => {
    const { map, k0, k1 } = mapWithBuildings();
    expect(hexesWithin(map, k0, 0)).toEqual([k0]);
    expect(hexesWithin(map, k0, 1)).toHaveLength(1 + mapNeighbors(map, k0).length);
    expect(minDistanceToAny(map, [k0], k0)).toBe(0);
    expect(minDistanceToAny(map, [k0, k1], k0)).toBe(0);
    expect(minDistanceToAny(map, [], k0)).toBe(Infinity);
  });
});

describe('公共板块', () => {
  it('回合计分 6 张不重复、终局 2 张不重复', () => {
    const s = newGame(CONFIG_4P);
    expect(s.board.roundScoring).toHaveLength(6);
    expect(new Set(s.board.roundScoring).size).toBe(6);
    expect(s.board.finalScoring).toHaveLength(2);
    expect(new Set(s.board.finalScoring).size).toBe(2);
  });

  it('高级科技板 7 槽不重复（LF：6 + 计分板扩展条第 7 槽）', () => {
    const s = newGame(CONFIG_4P);
    expect(s.board.advTechTiles).toHaveLength(7);
    expect(new Set(s.board.advTechTiles).size).toBe(7);
  });

  it('标准科技板供应 9 种 ×4', () => {
    const s = newGame(CONFIG_4P);
    expect(Object.keys(s.board.techTiles)).toHaveLength(9);
    for (const n of Object.values(s.board.techTiles)) {
      expect(n).toBe(4);
    }
  });

  it('助推器 = 人数+3 且不重复', () => {
    expect(newGame(CONFIG_2P).board.boosters).toHaveLength(5);
    const s4 = newGame(CONFIG_4P);
    expect(s4.board.boosters).toHaveLength(7);
    expect(new Set(s4.board.boosters).size).toBe(7);
  });

  it('terraformingL5Token 非 gleens 且供应已扣', () => {
    const s = newGame(CONFIG_4P);
    const token = s.board.terraformingL5Token;
    expect(token).not.toBeNull();
    expect(token).not.toBe('gleens');
    const def = FEDERATION_TOKENS[token!];
    expect(def.lostFleet).toBeUndefined();
    expect(s.board.federationTokens[token!]).toBe(def.count - 1);
  });
});

describe('玩家初始化', () => {
  it('terrans：I 区 4、gaia 轨 L1（星标给 1 gaiaformer）', () => {
    const s = newGame(CONFIG_2P);
    const p = s.players[0]!;
    expect(p.faction).toBe('terrans');
    expect(p.power.bowl1).toBe(4);
    expect(p.power.bowl2).toBe(4);
    expect(p.research.gaia).toBe(1);
    expect(p.gaiaformers).toEqual({ total: 1, available: 1, lost: 0, inGaia: 0 });
  });

  it('lantids：13c、I4/II0（LF +1 power token 是每轮收入，非起始）', () => {
    const s = newGame(CONFIG_2P);
    const p = s.players[1]!;
    expect(p.resources.credits).toBe(13);
    expect(p.power.bowl1).toBe(4);
    expect(p.power.bowl2).toBe(0);
  });

  it('taklons：brainstone 在 I 区', () => {
    const s = newGame(CONFIG_4P);
    const p = s.players[1]!;
    expect(p.faction).toBe('taklons');
    expect(p.power.brainstone).toBe('bowl1');
  });

  it('nevlas：sci 轨 L1（收入级不结算）', () => {
    const s = newGame(CONFIG_4P);
    const p = s.players[2]!;
    expect(p.research.sci).toBe(1);
    expect(p.resources.knowledge).toBe(2); // L1 是收入，设置时不获得
  });

  it('buildings 供应：mine8/ts4/lab3/pi1/ac1/ac2', () => {
    const s = newGame(CONFIG_4P);
    for (const p of s.players) {
      expect(p.buildings).toEqual({ mine: 8, ts: 4, lab: 3, pi: 1, ac1: 1, ac2: 1 });
    }
  });

  it('起始 vp = 10（规则书：VP 轨从 10 分格开始）', () => {
    const s = newGame(CONFIG_4P);
    for (const p of s.players) {
      expect(p.vp).toBe(10);
    }
  });

  it('初始计数器为空、booster 为 null、turnOrder/firstPlayer 正确', () => {
    const s = newGame(CONFIG_4P);
    expect(s.turnOrder).toEqual([0, 1, 2, 3]);
    expect(s.firstPlayer).toBe(0);
    expect(s.round).toBe(0);
    expect(s.phase).toBe('setup');
    expect(s.lastEvents).toEqual(['game-created']);
    for (const p of s.players) {
      expect(p.booster).toBeNull();
      expect(p.techTiles).toHaveLength(0);
      expect(p.federationTokens).toHaveLength(0);
      expect(p.satellites).toBe(0);
      expect(p.colonizedPlanetTypes).toHaveLength(0);
    }
  });
});

describe('setup 队列', () => {
  /** 连续调用 advanceSetup 直到进入目标阶段（每步弹一个队首）。 */
  function advanceToStage(s: GameState, stage: string): GameState {
    let cur = s;
    for (let i = 0; i < 100 && cur.setupStage !== stage; i++) {
      cur = advanceSetup(cur);
    }
    expect(cur.setupStage).toBe(stage);
    return cur;
  }

  it('mines-1 正序、mines-2 倒序', () => {
    const s = newGame(CONFIG_4P);
    expect(s.setupStage).toBe('mines-1');
    expect(s.setupQueue).toEqual([0, 1, 2, 3]);
    const s2 = advanceToStage(s, 'mines-2');
    expect(s2.setupQueue).toEqual([3, 2, 1, 0]);
  });

  it('extra 队列：xenos 在 ivits 前（正序）', () => {
    const s = newGame({
      playerCount: 4,
      seed: 7,
      factions: ['ivits', 'terrans', 'xenos', 'nevlas'],
      lostFleet: true,
    });
    const extra = advanceToStage(s, 'extra');
    expect(extra.setupQueue).toEqual([2, 0]); // xenos(座位2) → ivits(座位0)
  });

  it('extra 队列：LF 新种族在 xenos 之后、ivits 之前', () => {
    const s = newGame({
      playerCount: 4,
      seed: 7,
      factions: ['ivits', 'moweyds', 'xenos', 'tinkeroids'],
      lostFleet: true,
    });
    const extra = advanceToStage(s, 'extra');
    expect(extra.setupQueue).toEqual([2, 1, 3, 0]); // xenos → moweyds/tinkeroids(正序) → ivits
  });

  it('无 xenos/ivits/LF 新族时自动跳过 extra 阶段', () => {
    const s = advanceToStage(newGame(CONFIG_4P), 'boosters');
    expect(s.setupQueue).toEqual([3, 2, 1, 0]); // boosters 倒序
  });

  it('boosters 完成后进入行动阶段：phase=action、round=1', () => {
    let s = newGame(CONFIG_2P);
    // mines-1(2) + mines-2(2) + extra(0，跳过) + boosters(2) = 6 次推进
    for (let i = 0; i < 6; i++) {
      s = advanceSetup(s);
    }
    expect(s.phase).toBe('action');
    expect(s.setupStage).toBeNull();
    expect(s.round).toBe(1);
    expect(s.currentPlayerIdx).toBe(s.firstPlayer);
    expect(s.lastEvents).toContain('setup-complete');
  });

  it('开局归一化：LF 新族/ivits 在 seat 0 时 settleSetupSkips 跳过空枚举队首（否则开局死锁）', () => {
    // darkanians 在 seat 0：mines-1/2 阶段无放置（无母星），枚举为空
    const s = newGame({
      playerCount: 4,
      seed: 303695223,
      factions: ['darkanians', 'terrans', 'taklons', 'xenos'],
      lostFleet: true,
    });
    expect(s.setupQueue[0]).toBe(0);
    expect(enumerateActions(s, 0)).toHaveLength(0);
    const settled = settleSetupSkips(s);
    // 跳过 seat 0 后轮到 seat 1（terrans，有合法放置）
    expect(settled.setupQueue[0]).toBe(1);
    expect(enumerateActions(settled, 1).length).toBeGreaterThan(0);

    // ivits 在 seat 0 同理（startingMines 0）
    const s2 = newGame({
      playerCount: 2,
      seed: 7,
      factions: ['ivits', 'terrans'],
      lostFleet: true,
    });
    const settled2 = settleSetupSkips(s2);
    expect(settled2.setupQueue[0]).toBe(1);
    expect(enumerateActions(settled2, 1).length).toBeGreaterThan(0);
  });
});

describe('startingVp（竞拍出价扣减后的起始 VP）', () => {
  it('缺省每人 10 VP，state.config 归一化为全 10', () => {
    const s = newGame(CONFIG_2P);
    expect(s.players.map((p) => p.vp)).toEqual([10, 10]);
    expect(s.config.startingVp).toEqual([10, 10]);
  });

  it('指定 startingVp 时按座位落地（L1 一次性 VP 奖励仍叠加）', () => {
    const s = newGame({ ...CONFIG_2P, startingVp: [7, 10] });
    expect(s.players[0]!.vp).toBe(7);
    expect(s.players[1]!.vp).toBe(10);
    expect(s.config.startingVp).toEqual([7, 10]);
  });

  it('startingVp 校验：长度不符 / 非非负整数抛 invalid-config', () => {
    expect(() => newGame({ ...CONFIG_2P, startingVp: [10] })).toThrow(IllegalActionError);
    expect(() => newGame({ ...CONFIG_2P, startingVp: [10, -1] })).toThrow(IllegalActionError);
    expect(() => newGame({ ...CONFIG_2P, startingVp: [10, 1.5] })).toThrow(IllegalActionError);
  });
});
