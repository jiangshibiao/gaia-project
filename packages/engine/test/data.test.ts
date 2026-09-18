/**
 * 数据表锚点测试。
 * 坐标 parity 断言复现 reference/gaia-engine/src/map.spec.ts "should load from a
 * configuration" 的三组检查结果（扇区 5B@(0,0) 旋 2、6B@(-5,2) 旋 5）。
 */
import { describe, expect, it } from 'vitest';
import {
  ADV_TECH_TILES,
  BOARD_ACTIONS,
  BOOSTERS,
  BUILDING_COST,
  BUILDING_POWER_VALUE,
  bigMapCenters,
  FACTIONS,
  FEDERATION_TOKENS,
  FINAL_SCORING,
  FREE_CONVERSIONS,
  hexAdd,
  RESEARCH_TRACKS,
  rotateRight,
  ROUND_SCORING,
  SECTOR_CHAR_TO_PLANET,
  SECTOR_POSITIONS,
  SECTORS,
  SHIP_ACTIONS,
  smallMapCenters,
  STANDARD_SECTORS_BIG,
  STANDARD_SECTORS_SMALL,
  TECH_TILES,
  UPGRADE_CHAIN,
  UPGRADE_CHAIN_BESCODS,
  type Hex,
  type PlanetType,
  type SectorId,
} from '../src/index.js';

/** 求扇区放置（center + 旋转）后某绝对坐标的星球类型。 */
function planetAt(sector: SectorId, center: Hex, rotation: number, target: Hex): PlanetType {
  const def = SECTORS[sector];
  for (let i = 0; i < SECTOR_POSITIONS.length; i++) {
    // SECTOR_POSITIONS 是扇区相对坐标：先加 center 得绝对坐标，再绕 center 旋转。
    const pos = rotateRight(hexAdd(SECTOR_POSITIONS[i]!, center), center, rotation);
    if (pos.q === target.q && pos.r === target.r) {
      return def.layout[i]!;
    }
  }
  throw new Error(`坐标 ${target.q},${target.r} 不在扇区 ${sector} 内`);
}

describe('sectors', () => {
  it('13 块扇区，每块 19 格', () => {
    const defs = Object.values(SECTORS);
    expect(defs).toHaveLength(13);
    for (const def of defs) {
      expect(def.layout, `扇区 ${def.id}`).toHaveLength(19);
    }
  });

  it('字符→星球映射', () => {
    expect(SECTOR_CHAR_TO_PLANET.e).toBe('empty');
    expect(SECTOR_CHAR_TO_PLANET.m).toBe('transdim');
    expect(SECTOR_CHAR_TO_PLANET.g).toBe('gaia');
    expect(Object.keys(SECTOR_CHAR_TO_PLANET)).toHaveLength(10);
  });

  it('扇区 1 抽查：中心 C 位 = 最后一个字符', () => {
    const layout = SECTORS['1'].layout;
    expect(layout[18]).toBe('empty'); // C 位（中心）
    expect(layout[3]).toBe('transdim'); // A3 = 'm'
    expect(layout[5]).toBe('volcanic'); // A5 = 'v'
    expect(layout[13]).toBe('terra'); // B1 = 'r'
    expect(layout[17]).toBe('swamp'); // B5 = 's'
  });

  it('坐标 parity：扇区 5B 放 (0,0) 旋转 2 → (-2,0) = transdim', () => {
    expect(planetAt('5B', { q: 0, r: 0 }, 2, { q: -2, r: 0 })).toBe('transdim');
  });

  it('坐标 parity：扇区 6B 放 (-5,2) 旋转 5 → (-3,1) = transdim、(-4,2) = terra', () => {
    expect(planetAt('6B', { q: -5, r: 2 }, 5, { q: -3, r: 1 })).toBe('transdim');
    expect(planetAt('6B', { q: -5, r: 2 }, 5, { q: -4, r: 2 })).toBe('terra');
  });
});

describe('maps', () => {
  it('小图 7 中心 = (0,0) + (5,-2) 旋转 0–5', () => {
    expect(smallMapCenters()).toEqual([
      { q: 0, r: 0 },
      { q: 5, r: -2 },
      { q: 2, r: 3 },
      { q: -3, r: 5 },
      { q: -5, r: 2 },
      { q: -2, r: -3 },
      { q: 3, r: -5 },
    ]);
  });

  it('大图 10 中心 = 小图 7 + (-1,8),(-6,10),(-8,7)', () => {
    const big = bigMapCenters();
    expect(big).toHaveLength(10);
    expect(big.slice(7)).toEqual([
      { q: -1, r: 8 },
      { q: -6, r: 10 },
      { q: -8, r: 7 },
    ]);
  });

  it('标准布局扇区选择', () => {
    expect(STANDARD_SECTORS_SMALL).toEqual(['1', '2', '3', '4', '5B', '6B', '7B']);
    expect(STANDARD_SECTORS_BIG).toEqual(['1', '2', '3', '4', '5A', '6A', '7A', '8', '9', '10']);
  });
});

describe('research', () => {
  it('6 轨 × 5 级', () => {
    const tracks = Object.values(RESEARCH_TRACKS);
    expect(tracks).toHaveLength(6);
    for (const track of tracks) {
      expect(track.levels, track.id).toHaveLength(5);
    }
  });

  it('关键级效果锚点', () => {
    expect(RESEARCH_TRACKS.terra.levels[2].terraformCostPerStep).toBe(1); // L3
    expect(RESEARCH_TRACKS.terra.levels[4].grantsPresetFederationToken).toBe(true); // L5
    expect(RESEARCH_TRACKS.nav.levels[1].range).toBe(2); // L2
    expect(RESEARCH_TRACKS.nav.levels[4].range).toBe(4); // L5
    expect(RESEARCH_TRACKS.nav.levels[4].placesLostPlanet).toBe(true);
    expect(RESEARCH_TRACKS.gaia.levels[0].once).toEqual({ gaiaformer: 1 });
    expect(RESEARCH_TRACKS.gaia.levels[4].gaiaProjectCost).toBe(3);
    expect(RESEARCH_TRACKS.gaia.levels[4].vpPerGaiaPlanet).toBe(1);
    expect(RESEARCH_TRACKS.eco.levels[4].once).toEqual({ credits: 6, ore: 3, chargePower: 6 });
    expect(RESEARCH_TRACKS.sci.levels[4].once).toEqual({ knowledge: 9 });
    // L3 通用充能 3pw
    expect(RESEARCH_TRACKS.int.levels[2].once?.chargePower).toBe(3);
  });
});

describe('板块池数量', () => {
  it('科技板：标准 9(+3 LF)、高级 15(+6 LF)', () => {
    const techs = Object.values(TECH_TILES);
    expect(techs.filter((t) => !t.lostFleet)).toHaveLength(9);
    expect(techs.filter((t) => t.lostFleet)).toHaveLength(3);
    // LF 新标准板 3 种各 1 块
    expect(techs.filter((t) => t.lostFleet).every((t) => t.count === 1)).toBe(true);
    const adv = Object.values(ADV_TECH_TILES);
    expect(adv.filter((t) => !t.lostFleet)).toHaveLength(15);
    expect(adv.filter((t) => t.lostFleet)).toHaveLength(6);
    // LF 新高级板 6 种各 1 块
    expect(adv.filter((t) => t.lostFleet).every((t) => t.count === 1)).toBe(true);
  });

  it('联邦标记：基础 6 种+gleens（共 19 枚）、LF 8 种各 1（共 8 枚）', () => {
    const tokens = Object.values(FEDERATION_TOKENS);
    expect(tokens.filter((t) => !t.lostFleet)).toHaveLength(7);
    expect(tokens.filter((t) => t.lostFleet)).toHaveLength(8);
    expect(tokens.filter((t) => !t.lostFleet).reduce((s, t) => s + t.count, 0)).toBe(19);
    expect(tokens.filter((t) => t.lostFleet).reduce((s, t) => s + t.count, 0)).toBe(8);
    expect(FEDERATION_TOKENS.fed1.flippable).toBe(false);
    expect(FEDERATION_TOKENS.fedlf1.flippable).toBe(true);
    // LF 8 种奖励锚点
    expect(FEDERATION_TOKENS.fedlf5.vp).toBe(8);
    expect(FEDERATION_TOKENS.fedlf5.other).toEqual({ credits: 8 });
    expect(FEDERATION_TOKENS.fedlf6.other).toEqual({ knowledge: 4 });
    expect(FEDERATION_TOKENS.fedlf7.other).toEqual({ ore: 2, qic: 1 });
    expect(FEDERATION_TOKENS.fedlf8.vp).toBe(7);
    expect(FEDERATION_TOKENS.fedlf8.immediate).toBe('power-tokens-bowl3');
  });

  it('回合计分 10(+3)、终局 6(+3)、助推器 10(+4)', () => {
    expect(Object.values(ROUND_SCORING).filter((t) => !t.lostFleet)).toHaveLength(10);
    expect(Object.values(ROUND_SCORING).filter((t) => t.lostFleet)).toHaveLength(3);
    expect(Object.values(FINAL_SCORING).filter((t) => !t.lostFleet)).toHaveLength(6);
    expect(Object.values(FINAL_SCORING).filter((t) => t.lostFleet)).toHaveLength(3);
    expect(Object.values(BOOSTERS).filter((t) => !t.lostFleet)).toHaveLength(10);
    expect(Object.values(BOOSTERS).filter((t) => t.lostFleet)).toHaveLength(4);
  });

  it('18 族', () => {
    expect(Object.keys(FACTIONS)).toHaveLength(18);
  });
});

describe('factions 起始数据抽查', () => {
  it('terrans：I 区 4 枚、起始 gaia 轨', () => {
    expect(FACTIONS.terrans.startingPower.bowl1).toBe(4);
    expect(FACTIONS.terrans.startingPower.bowl2).toBe(4);
    expect(FACTIONS.terrans.startingResearch).toBe('gaia');
  });

  it('lantids：13c、I4/II0、PI 收入无 token', () => {
    expect(FACTIONS.lantids.startingResources.credits).toBe(13);
    expect(FACTIONS.lantids.startingPower).toEqual({ bowl1: 4, bowl2: 0 });
    expect(FACTIONS.lantids.incomeTrack.pi).toEqual({ chargePower: 4 });
  });

  it('baltaks：II 区 2 枚、起始 gaia 轨', () => {
    expect(FACTIONS.baltaks.startingPower.bowl2).toBe(2);
    expect(FACTIONS.baltaks.startingResearch).toBe('gaia');
  });

  it('itars：5o、I 区 4 枚、无起始轨、学院1 +3k', () => {
    expect(FACTIONS.itars.startingResources.ore).toBe(5);
    expect(FACTIONS.itars.startingPower.bowl1).toBe(4);
    expect(FACTIONS.itars.startingResearch).toBeNull();
    expect(FACTIONS.itars.incomeTrack.ac1).toEqual({ knowledge: 3 });
  });

  it('firaks：2k+3o；nevlas：2k、起始 sci 轨', () => {
    expect(FACTIONS.firaks.startingResources.knowledge).toBe(2);
    expect(FACTIONS.firaks.startingResources.ore).toBe(3);
    expect(FACTIONS.nevlas.startingResources.knowledge).toBe(2);
    expect(FACTIONS.nevlas.startingResearch).toBe('sci');
  });

  it('默认收入轨：mine 第 3 格空、TS 3/4/4/5c', () => {
    const track = FACTIONS.terrans.incomeTrack;
    expect(track.mine).toHaveLength(8);
    expect(track.mine[2]).toBeNull();
    expect(track.ts.map((g) => g.credits)).toEqual([3, 4, 4, 5]);
    expect(track.pi).toEqual({ chargePower: 4, powerToken: 1 });
  });

  it('bescods：TS/lab 收入互换；xenos 3 矿；ivits 0 矿；LF 新族起始建筑', () => {
    expect(FACTIONS.bescods.incomeTrack.ts[0]).toEqual({ knowledge: 1 });
    expect(FACTIONS.bescods.incomeTrack.lab[0]).toEqual({ credits: 3 });
    expect(FACTIONS.xenos.startingMines).toBe(3);
    expect(FACTIONS.ivits.startingMines).toBe(0);
    expect(FACTIONS.tinkeroids.startingMines).toBe(0);
    expect(FACTIONS.tinkeroids.startingPlanetType).toBe('asteroid');
    expect(FACTIONS.moweyds.startingPlanetType).toBe('proto');
    expect(FACTIONS['space-giants'].startingMines).toBe(1);
  });
});

describe('prices', () => {
  it('建筑费用与 power value', () => {
    expect(BUILDING_COST.mine).toEqual({ ore: 1, credits: 2 });
    expect(BUILDING_COST.ts).toEqual({ ore: 2, credits: 6 });
    expect(BUILDING_COST.tsAdjacent).toEqual({ ore: 2, credits: 3 });
    expect(BUILDING_COST.lab).toEqual({ ore: 3, credits: 5 });
    expect(BUILDING_COST.pi).toEqual({ ore: 4, credits: 6 });
    expect(BUILDING_COST.academy).toEqual({ ore: 6, credits: 6 });
    expect(BUILDING_POWER_VALUE).toEqual({
      mine: 1,
      ts: 2,
      lab: 2,
      pi: 3,
      ac1: 3,
      ac2: 3,
      gf: 0,
      sp: 0,
    });
  });

  it('升级链（含 bescods 变体）', () => {
    expect(UPGRADE_CHAIN.mine).toEqual(['ts']);
    expect(UPGRADE_CHAIN.ts).toEqual(['lab', 'pi']);
    expect(UPGRADE_CHAIN.lab).toEqual(['ac1', 'ac2']);
    expect(UPGRADE_CHAIN_BESCODS.ts).toEqual(['lab', 'ac1', 'ac2']);
    expect(UPGRADE_CHAIN_BESCODS.lab).toEqual(['pi']);
  });

  it('board action 价格', () => {
    expect(Object.keys(BOARD_ACTIONS)).toHaveLength(10);
    expect(BOARD_ACTIONS.power1.cost).toEqual({ power: 7 });
    expect(BOARD_ACTIONS.power2.effect).toEqual({ kind: 'build-mine', freeTerraformSteps: 2 });
    expect(BOARD_ACTIONS.qic1.cost).toEqual({ qic: 4 });
    expect(BOARD_ACTIONS.qic3.effect).toEqual({ kind: 'vp-per-planet-type', base: 3, perType: 1 });
  });

  it('免费兑换全集（21 条）', () => {
    expect(Object.keys(FREE_CONVERSIONS)).toHaveLength(21);
    expect(FREE_CONVERSIONS['pw4-q'].cost).toEqual({ power: 4 });
    expect(FREE_CONVERSIONS['o-t'].gain).toEqual({ powerToken: 1 });
    expect(FREE_CONVERSIONS['xenos-o-t3'].powerTokenToBowl3).toBe(true);
    expect(FREE_CONVERSIONS['terrans-gaia-q'].gaiaPhaseOnly).toBe(true);
    expect(FREE_CONVERSIONS['nevlas-pw2-2c'].cost).toEqual({ power: 2 });
  });

  it('飞船行动格价格（12 格，按船固定）', () => {
    expect(Object.keys(SHIP_ACTIONS)).toHaveLength(12);
    expect(SHIP_ACTIONS['ship-rescore-fed'].cost).toEqual({ qic: 3 });
    expect(SHIP_ACTIONS['ship-tech-tile'].cost).toEqual({ qic: 3 });
    expect(SHIP_ACTIONS['ship-upgrade-mine-ts'].cost).toEqual({ power: 3, ore: 1 });
    expect(SHIP_ACTIONS['ship-upgrade-ts-lab'].cost).toEqual({ power: 3, ore: 2 });
    expect(SHIP_ACTIONS['ship-2c1q'].cost).toEqual({ knowledge: 2 });
    expect(SHIP_ACTIONS['ship-2c1q'].effect).toEqual({ kind: 'gain', gain: { credits: 2, qic: 1 } });
    expect(SHIP_ACTIONS['ship-vp-per-tech'].cost).toEqual({ qic: 2 });
    expect(SHIP_ACTIONS['ship-instant-gaia'].effect).toEqual({ kind: 'gaia-project-immediate' });
    expect(SHIP_ACTIONS['ship-terraform-step'].cost).toEqual({ credits: 3 });
    expect(SHIP_ACTIONS['ship-terraform-step'].effect).toEqual({ kind: 'build-mine', freeTerraformSteps: 1 });
    expect(SHIP_ACTIONS['ship-vp-per-planet'].cost).toEqual({ qic: 2 });
    expect(SHIP_ACTIONS['ship-research'].cost).toEqual({ power: 3, knowledge: 2 });
    expect(SHIP_ACTIONS['ship-asteroid-mine'].cost).toEqual({ credits: 6 });
  });
});
