/**
 * fuzz 测试：50+ 局随机对局的全局不变量。
 * - 资源非负且不超上限（15o/15k/30c）；vp 非负；
 * - power 三区+gaia 区 token 总数守恒（= 初始 + 获得 - 弃置，brainstone 算 1 个）；
 * - 每轨 L5 最多 1 人且与 board.researchLevel5 一致；
 * - winner 合法（非空、vp 并列最高）；
 * - log 长度下限（每人恰好 pass 6 次 + setup 行动）。
 */
import { describe, expect, it } from 'vitest';
import {
  FACTIONS,
  newGame,
  playGame,
  type FactionId,
  type GameConfig,
  type GameState,
} from '../src/index.js';

const ALL_FACTIONS = Object.keys(FACTIONS) as FactionId[];

/** 确定性选族：第 g 局从全 18 族轮转取 pc 个。 */
function factionsFor(g: number, pc: number): FactionId[] {
  const out: FactionId[] = [];
  for (let i = 0; i < pc; i++) {
    out.push(ALL_FACTIONS[(g * pc + i) % ALL_FACTIONS.length]!);
  }
  return out;
}

function checkInvariants(config: GameConfig, state: GameState, log: { type: string }[]): void {
  const initial = newGame(config);
  expect(state.phase).toBe('game-over');
  expect(state.pending).toBeNull();

  for (let idx = 0; idx < state.players.length; idx++) {
    const p = state.players[idx]!;
    const r = p.resources;
    // 资源非负且不超上限
    expect(r.ore).toBeGreaterThanOrEqual(0);
    expect(r.ore).toBeLessThanOrEqual(15);
    expect(r.knowledge).toBeGreaterThanOrEqual(0);
    expect(r.knowledge).toBeLessThanOrEqual(15);
    expect(r.credits).toBeGreaterThanOrEqual(0);
    expect(r.credits).toBeLessThanOrEqual(30);
    expect(r.qic).toBeGreaterThanOrEqual(0);
    expect(p.vp).toBeGreaterThanOrEqual(0);

    // power 守恒：初始 + 获得 - 弃置 = 三区 + gaia 区 + brainstone
    const pw = p.power;
    const finalTokens =
      pw.bowl1 + pw.bowl2 + pw.bowl3 + pw.gaia + (pw.brainstone !== 'none' ? 1 : 0);
    const ip = initial.players[idx]!.power;
    const initialTokens =
      ip.bowl1 + ip.bowl2 + ip.bowl3 + ip.gaia + (ip.brainstone !== 'none' ? 1 : 0);
    expect(finalTokens).toBe(initialTokens + p.powerStats.gained - p.powerStats.discarded);

    // gaiaformer 守恒：total = available + lost + 地图上留置 + gaia 区暂存 + 转化中的盖亚计划
    const onMap = Object.values(state.map).filter((h) => h.gaiaformerOf === idx).length;
    const inFlight = state.gaiaProjectsInProgress.filter((pr) => pr.player === idx).length;
    const gf = p.gaiaformers;
    expect(gf.available + gf.lost + onMap + gf.inGaia + inFlight).toBe(gf.total);

    // 矿守恒：地图上（含附加矿）+ 面板剩余 = 8
    let mines = 0;
    for (const h of Object.values(state.map)) {
      if (h.building?.type === 'mine' && h.building.player === idx) {
        mines += 1;
      }
      if (h.additionalMine === idx) {
        mines += 1;
      }
    }
    expect(mines + p.buildings.mine).toBe(8);

    // 其余建筑守恒：地图上 + 面板剩余 = 初始（升级 supply 往返不丢建筑）
    const INITIAL: Record<string, number> = { ts: 4, lab: 3, pi: 1, ac1: 1, ac2: 1 };
    for (const [type, total] of Object.entries(INITIAL)) {
      const onMap = Object.values(state.map).filter(
        (h) => h.building?.type === type && h.building.player === idx,
      ).length;
      expect(onMap + p.buildings[type as keyof typeof p.buildings]).toBe(total);
    }

    // 殖民记录无重复
    expect(new Set(p.colonizedPlanetTypes).size).toBe(p.colonizedPlanetTypes.length);
    expect(new Set(p.colonizedSectors).size).toBe(p.colonizedSectors.length);
  }

  // 科技板守恒：基础供应 = 9 种 × 人数（规则：2 人 2、3 人 3、4 人 4）；
  // LF 另加船上放置（3 种各 1 块；2 人局 2 槽放 2 块、3–4 人局 3 槽放 3 块，
  // 其余移出游戏）。船上板按参考 count 模型：每名玩家可拿 1 份拷贝
  // （remaining = 人数 − 已拿人数）。高级板槽位：LF 7 槽（含扩展条）/ 非 LF 6 槽。
  const lf = state.config.lostFleet;
  const techSupply = Object.values(state.board.techTiles).reduce((s, n) => s + n, 0);
  const techHeld = state.players.reduce((s, p) => s + p.techTiles.length, 0);
  const techOnShips = state.board.ships.reduce(
    (s, sh) => s + sh.techTiles.length * (state.config.playerCount - sh.techTileClaims.length),
    0,
  );
  const baseCopies = 9 * state.config.playerCount;
  const shipTileCopies = lf ? (state.config.playerCount <= 2 ? 2 : 3) * state.config.playerCount : 0;
  expect(techSupply + techHeld + techOnShips).toBe(lf ? baseCopies + shipTileCopies : baseCopies);
  const advLeft = state.board.advTechTiles.filter((t) => t !== null).length;
  const advHeld = state.players.reduce((s, p) => s + p.advTechTiles.length, 0);
  expect(advLeft + advHeld).toBe(lf ? 7 : 6);

  // 联邦标记守恒：供应 + 玩家持有 + Terraforming L5 预设位 + 船上剩余
  // = 19（基础 18 + gleens 1）+ 船上标记数（LF：2 人 3 枚 / 3–4 人 4 枚）。
  const tokenSupply = Object.values(state.board.federationTokens).reduce((s, n) => s + n, 0);
  const tokenHeld = state.players.reduce((s, p) => s + p.federationTokens.length, 0);
  const tokenOnShips = state.board.ships.filter((sh) => sh.federationToken !== null).length;
  expect(tokenSupply + tokenHeld + tokenOnShips + (state.board.terraformingL5Token !== null ? 1 : 0)).toBe(
    lf ? 19 + (state.config.playerCount <= 2 ? 3 : 4) : 19,
  );

  // hex.federations 结构：无重复玩家；卫星格 satelliteOf 与 federations 一致
  for (const hex of Object.values(state.map)) {
    expect(new Set(hex.federations).size).toBe(hex.federations.length);
    if (hex.satelliteOf !== undefined && hex.planet === 'empty') {
      expect(hex.federations).toContain(hex.satelliteOf);
    }
  }

  // 每轨 L5 最多 1 人，且与 board.researchLevel5 一致
  const tracks = ['terra', 'nav', 'int', 'gaia', 'eco', 'sci'] as const;
  for (const t of tracks) {
    const at5 = state.players.flatMap((p, i) => (p.research[t] === 5 ? [i] : []));
    expect(at5.length).toBeLessThanOrEqual(1);
    if (at5.length === 1) {
      expect(state.board.researchLevel5[t]).toBe(at5[0]);
    } else {
      expect(state.board.researchLevel5[t]).toBeUndefined();
    }
  }

  // winner 合法
  expect(state.winner).not.toBeNull();
  expect(state.winner!.length).toBeGreaterThan(0);
  const maxVp = Math.max(...state.players.map((p) => p.vp));
  for (const w of state.winner!) {
    expect(state.players[w]!.vp).toBe(maxVp);
  }

  // 每人恰好 pass 6 次（每轮 1 次）；log 长度下限 = setup 行动 + 6n pass
  const passes = log.filter((a) => a.type === 'pass').length;
  expect(passes).toBe(6 * config.playerCount);
  expect(log.length).toBeGreaterThanOrEqual(6 * config.playerCount + 3 * config.playerCount);
}

describe('fuzz：随机对局全局不变量', () => {
  const GAMES_PER_COUNT = 18; // 共 54 局（lostFleet=true）+ 18 局（lostFleet=false）
  // 跨局行动覆盖统计：确认随机局里升级/联邦/盖亚计划/板行动确实出现
  const coverage = { upgrade: 0, federation: 0, gaia: 0, boardAction: 0, special: 0 };
  // LF 行动覆盖：探索飞船/飞船行动/检查神器/新族能力（tinkering/ring 等）
  const lfCoverage = { explore: 0, shipAction: 0, inspect: 0, newFactionAbility: 0 };
  for (const pc of [2, 3, 4]) {
    it(
      `${pc} 人局 × ${GAMES_PER_COUNT}（+6 局纯基础）`,
      () => {
        for (let g = 0; g < GAMES_PER_COUNT + 6; g++) {
          const gameIdx = (pc - 2) * GAMES_PER_COUNT + g;
          const config: GameConfig = {
            playerCount: pc,
            seed: gameIdx + 1,
            factions: factionsFor(gameIdx, pc),
            lostFleet: g < GAMES_PER_COUNT,
          };
          const { state, log } = playGame(config);
          checkInvariants(config, state, log);
          for (const a of log) {
            if (a.type === 'upgrade') coverage.upgrade += 1;
            if (a.type === 'form-federation') coverage.federation += 1;
            if (a.type === 'start-gaia-project') coverage.gaia += 1;
            if (a.type === 'power-action' || a.type === 'qic-action') coverage.boardAction += 1;
            if (a.type === 'special-action') coverage.special += 1;
            if (a.type === 'explore-ship') lfCoverage.explore += 1;
            if (a.type === 'ship-action') lfCoverage.shipAction += 1;
            if (a.type === 'inspect-artifact') lfCoverage.inspect += 1;
            if (
              a.type === 'choose-tinkering' ||
              (a.type === 'special-action' &&
                (a.action === 'moweyds-ring' ||
                  a.action === 'tinkeroids-tile' ||
                  a.action === 'space-giants-mine' ||
                  a.action === 'gleens-range'))
            ) {
              lfCoverage.newFactionAbility += 1;
            }
          }
        }
      },
      120_000,
    );
  }
  it('行动覆盖：升级/联邦/盖亚/板行动/特殊行动在随机局中出现', () => {
    expect(coverage.upgrade).toBeGreaterThan(0);
    expect(coverage.federation).toBeGreaterThan(0);
    expect(coverage.gaia).toBeGreaterThan(0);
    expect(coverage.boardAction).toBeGreaterThan(0);
    expect(coverage.special).toBeGreaterThan(0);
  });
  it('LF 行动覆盖：探索/飞船行动/新族能力在随机局中出现', () => {
    expect(lfCoverage.explore).toBeGreaterThan(0);
    expect(lfCoverage.shipAction).toBeGreaterThan(0);
    expect(lfCoverage.newFactionAbility).toBeGreaterThan(0);
  });
});
