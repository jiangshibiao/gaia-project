/**
 * 回合/轮次推进与终局锚点：首 pass 先手、pass 顺序推进、全员 pass 进下一轮、
 * 第 1 轮收入结算、盖亚阶段（转化 + gaia 区移动）、round 6 全员 pass 终局计分。
 */
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  BOOSTERS,
  FACTIONS,
  RESEARCH_TRACKS,
  type Action,
  type GameConfig,
  type GameState,
  type ResourceGain,
} from '../src/index.js';
import { actionPhase, completeSetup, legalOf } from './helpers.js';
import { newGame } from '../src/index.js';

const CONFIG_2P: GameConfig = { playerCount: 2, seed: 42, factions: ['terrans', 'lantids'], lostFleet: true };
const CONFIG_4P: GameConfig = {
  playerCount: 4,
  seed: 42,
  factions: ['terrans', 'taklons', 'nevlas', 'itars'],
  lostFleet: true,
};

function passAction(state: GameState): Action {
  const a = legalOf(state).find((x) => x.type === 'pass');
  if (a === undefined) {
    throw new Error('无 pass 行动');
  }
  return a;
}

describe('pass 与回合推进', () => {
  it('首个 pass 者设为 firstPlayer；pass 后顺移跳过已 pass 玩家', () => {
    let state = actionPhase(CONFIG_4P);
    state = structuredClone(state);
    state.firstPlayer = 3; // 手术：区分"初始值"与"首 pass 者赋值"
    state = applyAction(state, passAction(state)); // p0 pass
    expect(state.firstPlayer).toBe(0);
    expect(state.passedPlayers).toEqual([0]);
    expect(state.currentPlayerIdx).toBe(1);
    state = applyAction(state, passAction(state)); // p1 pass
    expect(state.currentPlayerIdx).toBe(2);
    expect(state.firstPlayer).toBe(0); // 不再变更
  });

  it('全员 pass → 整理 → round++ → currentPlayer=firstPlayer', () => {
    let state = actionPhase(CONFIG_2P);
    state = applyAction(state, passAction(state)); // p0
    state = applyAction(state, passAction(state)); // p1 → 进入第 2 轮
    expect(state.round).toBe(2);
    expect(state.passedPlayers).toEqual([]);
    expect(state.currentPlayerIdx).toBe(state.firstPlayer);
    expect(state.lastEvents).toContain('round-1-end');
    expect(state.lastEvents).toContain('round-2-start');
  });

  it('第 6 轮 pass 的 booster 必须为 null', () => {
    let state = actionPhase(CONFIG_2P);
    state = structuredClone(state);
    state.round = 6;
    const passes = legalOf(state).filter((a) => a.type === 'pass');
    expect(passes).toEqual([{ type: 'pass', booster: null }]);
    state = applyAction(state, passes[0]!);
    expect(state.players[0]!.booster).toBeNull();
  });

  it('pass 还旧 booster 拿新 booster；passVp 按场上矿数结算', () => {
    const state0 = actionPhase(CONFIG_2P);
    // 手术：让玩家 0 拿 booster6（pass 时每矿 +1vp）
    const state = structuredClone(state0);
    const old = state.players[0]!.booster!;
    state.board.boosters.push(old);
    state.players[0]!.booster = 'booster6';
    const mines = 8 - state.players[0]!.buildings.mine;
    const vpBefore = state.players[0]!.vp;
    const supplyBefore = state.board.boosters.length;
    const take = state.board.boosters[0]!;
    const next = applyAction(state, { type: 'pass', booster: take });
    expect(next.players[0]!.vp).toBe(vpBefore + mines);
    expect(next.players[0]!.booster).toBe(take);
    expect(next.board.boosters).toContain('booster6'); // 旧的已还回
    expect(next.board.boosters).not.toContain(take);
    expect(next.board.boosters.length).toBe(supplyBefore); // 拿 1 还 1
  });
});

describe('收入与盖亚阶段', () => {
  it('setup 完成时结算第 1 轮收入（base + 建筑轨 + 研究轨 + 助推器）', () => {
    // 在最后一个 choose-booster 前捕获双方资源
    let s = newGame(CONFIG_2P);
    let before: GameState | null = null;
    s = completeSetup(s, (legal, cur) => {
      if (cur.setupStage === 'boosters' && cur.setupQueue.length === 1) {
        before = cur;
      }
      return legal[0]!;
    });
    expect(before).not.toBeNull();
    const pre = before as unknown as GameState;
    for (let idx = 0; idx < 2; idx++) {
      const preP = pre.players[idx]!;
      const postP = s.players[idx]!;
      // 测试侧独立复算收入
      const def = FACTIONS[postP.faction];
      const gains: ResourceGain[] = [def.baseIncome];
      const revealed = 8 - preP.buildings.mine;
      for (let i = 0; i < revealed; i++) {
        const g = def.incomeTrack.mine[i];
        if (g != null) {
          gains.push(g);
        }
      }
      for (const t of ['eco', 'sci'] as const) {
        const lvl = preP.research[t];
        if (lvl > 0) {
          const inc = RESEARCH_TRACKS[t].levels[lvl - 1]?.income;
          if (inc !== undefined) {
            gains.push(inc);
          }
        }
      }
      gains.push(BOOSTERS[postP.booster!].income);
      const exp = { ...preP.resources };
      for (const g of gains) {
        exp.ore = Math.min(15, exp.ore + (g.ore ?? 0));
        exp.credits = Math.min(30, exp.credits + (g.credits ?? 0));
        exp.knowledge = Math.min(15, exp.knowledge + (g.knowledge ?? 0));
        exp.qic += g.qic ?? 0;
      }
      expect(postP.resources).toEqual(exp);
    }
  });

  it('盖亚阶段：盖亚计划转化（transdim→gaia、gaiaformer 留置）；gaia 区 power 移动（terrans→II 区）', () => {
    const state0 = actionPhase(CONFIG_2P);
    const transdim = Object.keys(state0.map).find((k) => state0.map[k as `${number},${number}`]!.planet === 'transdim') as `${number},${number}`;
    const state = structuredClone(state0);
    state.gaiaProjectsInProgress.push({ player: 0, hex: transdim });
    state.players[0]!.power.gaia = 2; // terrans → II 区
    state.players[1]!.power.gaia = 1; // lantids → I 区
    // 固定助推器供应，避免第 2 轮收入的 power 项干扰断言
    state.board.boosters = ['booster1', 'booster1'];
    const b0 = { ...state.players[0]!.power };
    const b1 = { ...state.players[1]!.power };
    let next = applyAction(state, passAction(state));
    next = applyAction(next, passAction(next)); // 全员 pass → 第 2 轮
    expect(next.round).toBe(2);
    expect(next.map[transdim]!.planet).toBe('gaia');
    expect(next.map[transdim]!.gaiaformerOf).toBe(0);
    expect(next.gaiaProjectsInProgress).toEqual([]);
    expect(next.players[0]!.power.gaia).toBe(0);
    expect(next.players[0]!.power.bowl2).toBe(b0.bowl2 + 2);
    expect(next.players[1]!.power.gaia).toBe(0);
    // lantids gaia 区 1 → I 区；另 LF 基本收入 +1t（第 2 轮收入）也入 I 区
    expect(next.players[1]!.power.bowl1).toBe(b1.bowl1 + 2);
  });
});

describe('终局计分', () => {
  it('round 6 全员 pass → game-over；终局板排名 + 研究轨 + 资源 vp', () => {
    const state0 = actionPhase(CONFIG_2P);
    // 手术：round 6、只剩玩家 0 未 pass、终局板固定、玩家 0 多一个建筑
    const state = structuredClone(state0);
    state.round = 6;
    state.passedPlayers = [1];
    state.currentPlayerIdx = 0;
    state.board.finalScoring = ['structure', 'satellite'];
    // 把玩家 0 的 booster 换成无 passVp 的，简化 vp 预期
    state.board.boosters.push(state.players[0]!.booster!);
    state.players[0]!.booster = 'booster1';
    const extraHex = (Object.keys(state.map) as `${number},${number}`[]).find(
      (k) => state.map[k]!.building === undefined,
    )!;
    state.map[extraHex]!.building = { type: 'mine', player: 0 };

    const p0Before = state.players[0]!;
    const p1Before = state.players[1]!;
    const structures0 = 8 - p0Before.buildings.mine + 1; // 含手术多放的 1 个
    const structures1 = 8 - p1Before.buildings.mine;
    // structure：中立 11 第一；p0 第二 12vp；p1 第三 6vp
    expect(structures0).toBeGreaterThan(structures1);
    // satellite：双方 0 → count 0 不得分
    const researchVp = (p: typeof p0Before): number =>
      Object.values(p.research).reduce((s, l) => s + (l >= 3 ? (l - 2) * 4 : 0), 0);
    // 终局资源结算后的资源 vp（burn → III 区换 credits → qic 换 ore，参照 score.ts）
    const resourceVp = (p: typeof p0Before): number => {
      const pw = { ...p.power };
      const r = { ...p.resources };
      const burnable = Math.floor((pw.bowl2 + (pw.brainstone === 'bowl2' ? 1 : 0)) / 2);
      for (let i = 0; i < burnable; i++) {
        if (pw.brainstone === 'bowl2' && pw.bowl2 >= 1) {
          pw.bowl2 -= 1;
          pw.brainstone = 'bowl3';
        } else {
          pw.bowl2 -= 2;
          pw.bowl3 += 1;
        }
      }
      const creditGain = pw.bowl3 + (pw.brainstone === 'bowl3' ? 3 : 0);
      if (creditGain > 0) {
        r.credits = Math.min(30, r.credits + creditGain);
      }
      r.ore = Math.min(15, r.ore + r.qic);
      r.qic = 0;
      return Math.floor((r.ore + r.credits + r.knowledge) / 3);
    };
    // pass 本身的 passVp（若旧 booster 带 passVp，按场上矿数等结算）
    const passVp = (p: typeof p0Before): number => {
      const def = p.booster !== null ? BOOSTERS[p.booster] : null;
      if (def?.passVp === undefined) {
        return 0;
      }
      if (def.passVp.per === 'mine') {
        return (8 - p.buildings.mine + 1) * def.passVp.vp; // 含手术多放的 1 个
      }
      throw new Error(`测试未覆盖的 passVp 单位: ${def.passVp.per}`);
    };
    const exp0 = p0Before.vp + passVp(p0Before) + 12 + researchVp(p0Before) + resourceVp(p0Before);
    const exp1 = p1Before.vp + 6 + researchVp(p1Before) + resourceVp(p1Before);

    const next = applyAction(state, { type: 'pass', booster: null });
    expect(next.phase).toBe('game-over');
    expect(next.players[0]!.vp).toBe(exp0);
    expect(next.players[1]!.vp).toBe(exp1);
    expect(next.winner).toEqual(next.players[0]!.vp >= next.players[1]!.vp ? [0] : [1]);
    expect(next.lastEvents).toContain('game-over');
  });
});
