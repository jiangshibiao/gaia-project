/**
 * 回合/轮次推进机（全部原地修改，由 apply 层在已克隆的状态上调用）。
 *
 * 主行动 apply 后若 pending 为空则 advanceTurn：按 turnOrder 顺移到下一个未 pass
 * 玩家；全员 pass → settleRoundEnd（整理）→ turnOrder 重置为本轮 pass 顺序
 * （首个 pass 者先手，与参考引擎一致）→ round<6 则 round++ 并 settleRoundStart
 * （收入 → 盖亚）→ currentPlayerIdx=turnOrder[0]；
 * round==6 全员 pass → 终局计分（score.ts finalScoring）。
 */
import type { GameState, PlayerIndex, PlayerState, ResearchTrack } from './types.js';
import { FACTIONS } from './data/factions.js';
import { RESEARCH_TRACKS } from './data/research.js';
import { TECH_TILES } from './data/techs.js';
import { BOOSTERS } from './data/boosters.js';
import type { ResourceGain } from './data/rewards.js';
import { applyGain, gainPowerTokensToBowl3, moveGaiaPowerToBowl } from './state.js';
import { finalScoring } from './score.js';
import { tinkeringChoices } from './actions/pending.js';
import { ECONOMY_OVERLAY } from './data/lostfleet.js';

/** 面板建筑初始数（收入轨按"已移除数量"揭开）。 */
const INITIAL_BUILDINGS = { mine: 8, ts: 4, lab: 3 } as const;

/** 主行动后推进：按 turnOrder（上轮 pass 顺序）顺移到下一个未 pass 玩家；全员 pass 则整理并进入下一轮/终局。 */
export function advanceTurn(state: GameState): void {
  const n = state.players.length;
  if (state.passedPlayers.length >= n) {
    settleRoundEnd(state);
    return;
  }
  const order = state.turnOrder;
  let pos = order.indexOf(state.currentPlayerIdx);
  do {
    pos = (pos + 1) % order.length;
  } while (state.passedPlayers.includes(order[pos]!));
  state.currentPlayerIdx = order[pos]!;
}

/** 新一轮开始：收入阶段 → 盖亚阶段（round 已就位）。 */
export function settleRoundStart(state: GameState): void {
  for (const i of state.turnOrder) {
    settleIncome(state, i);
  }
  // 收入充能顺序待决的玩家逐个置为 pending；全部结清后才进入盖亚阶段。
  activateNextIncomePending(state);
}

/**
 * 收入决策串联：弹出 incomeQueue 队首置为 pending income-order；
 * 队列空 → 盖亚阶段 + 轮首事件（盖亚阶段自身的 PI/tinkering 决策由
 * activateNextGaiaPending 继续串联）。收入顺序响应行动处理时调用（actions/income.ts）。
 */
export function activateNextIncomePending(state: GameState): void {
  const next = state.incomeQueue.shift();
  if (next === undefined) {
    settleGaiaPhase(state);
    state.lastEvents = [...state.lastEvents, `round-${state.round}-start`];
    return;
  }
  state.pending = { kind: 'income-order', player: next.player, tokens: next.tokens, charge: next.charge };
}

/** 收入"加完 token 还能全部推至 III 区（转满）"判定：转满则任意顺序结果一致，无需玩家决策。 */
function incomeCanFullyCharge(p: PlayerState, tokens: number, charge: number): boolean {
  const pw = p.power;
  const capacity =
    2 * (pw.bowl1 + tokens + (pw.brainstone === 'bowl1' ? 1 : 0)) +
    (pw.bowl2 + (pw.brainstone === 'bowl2' ? 1 : 0));
  return charge >= capacity;
}

/**
 * 收入充能顺序是否需要玩家决策：同时含 token 与充能、充能会碰到 II 区
 * （charge > I 区 token 数；I→II 优先下充能先清 I 区，charge ≤ I 区时新 token
 * 与 II 区旧 token 的命运与顺序无关）且加完 token 也无法转满（转满则任意顺序一致）。
 * 注：比较基准必须是 I 区而非 II 区——I→II 优先下链底在 I 区，tokens-first
 * 的新豆必被卷进链底（charge > I 区时两序不同，如 I0/II4/tokens1/charge4
 * → (0,2,3) vs (1,0,4)）。
 */
function incomeOrderNeedsDecision(p: PlayerState, tokens: number, charge: number): boolean {
  if (tokens <= 0 || charge <= 0) return false;
  const bowl1Tokens = p.power.bowl1 + (p.power.brainstone === 'bowl1' ? 1 : 0);
  return charge > bowl1Tokens && !incomeCanFullyCharge(p, tokens, charge);
}

/**
 * 收入阶段（单玩家）：baseIncome + 建筑收入轨（按已移除建筑揭开）+
 * eco/sci 轨收入（仅当前级）+ 科技板收入（被覆盖失效）+ 助推器收入。
 * 合并后统一结算：先资源/vp，再 power token，最后 chargePower（auto-charge 最大）。
 */
function settleIncome(state: GameState, idx: PlayerIndex): void {
  const p = state.players[idx]!;
  const def = FACTIONS[p.faction];
  const gains: ResourceGain[] = [def.baseIncome];
  // LF：Lantids 基本收入 +1 power token 到 I 区（参考 faction-boards/lantids.ts
  // lostFleetIncome "+t"；是每轮收入而非起始 power）。
  if (state.config.lostFleet === true && p.faction === 'lantids') {
    gains.push({ powerToken: 1 });
  }

  // 建筑收入轨
  const track = def.incomeTrack;
  const mineRevealed = INITIAL_BUILDINGS.mine - p.buildings.mine;
  for (let i = 0; i < mineRevealed; i++) {
    const g = track.mine[i];
    if (g != null) {
      gains.push(g);
    }
  }
  const tsRevealed = INITIAL_BUILDINGS.ts - p.buildings.ts;
  for (let i = 0; i < tsRevealed; i++) {
    gains.push(track.ts[i]!);
  }
  const labRevealed = INITIAL_BUILDINGS.lab - p.buildings.lab;
  for (let i = 0; i < labRevealed; i++) {
    gains.push(track.lab[i]!);
  }
  if (p.buildings.ac1 === 0) {
    gains.push(track.ac1);
  }
  if (p.buildings.pi === 0) {
    gains.push(track.pi);
  }

  // 研究轨收入（eco/sci，仅当前级生效；LF 时 eco L3/L4 被覆盖板替代，见
  // data/lostfleet.ts ECONOMY_OVERLAY——覆盖的是收入，L3 到达充能不受影响）
  for (const t of ['eco', 'sci'] as readonly ResearchTrack[]) {
    const lvl = p.research[t];
    if (lvl > 0) {
      let inc = RESEARCH_TRACKS[t].levels[lvl - 1]?.income;
      const overlay = state.board.economyOverlay;
      if (t === 'eco' && overlay !== null && (lvl === 3 || lvl === 4)) {
        inc = ECONOMY_OVERLAY[overlay][lvl === 3 ? 'l3' : 'l4'];
      }
      if (inc !== undefined) {
        gains.push(inc);
      }
    }
  }

  // 科技板收入（被高级板覆盖的标准板失效）
  const covered = new Set(p.advTechTiles.map((a) => a.covers));
  for (const t of p.techTiles) {
    if (covered.has(t)) {
      continue;
    }
    const eff = TECH_TILES[t].effect;
    if (eff.kind === 'income' && eff.gain !== undefined) {
      gains.push(eff.gain);
    }
  }
  // LF artifact 收入：art-1k1o 每枚 +1k+1o（并入统一结算）；
  // art-pwt 每枚 +2 power token 直接 III 区（applyGain 不支持直接入 III 区，单独结算）。
  const art1k1o = p.artifacts.filter((a) => a.id === 'art-1k1o').length;
  if (art1k1o > 0) {
    gains.push({ knowledge: art1k1o, ore: art1k1o });
  }

  // 助推器收入
  if (p.booster !== null) {
    gains.push(BOOSTERS[p.booster].income);
  }

  // 合并结算
  const merged: ResourceGain = {};
  for (const g of gains) {
    merged.ore = (merged.ore ?? 0) + (g.ore ?? 0);
    merged.credits = (merged.credits ?? 0) + (g.credits ?? 0);
    merged.knowledge = (merged.knowledge ?? 0) + (g.knowledge ?? 0);
    merged.qic = (merged.qic ?? 0) + (g.qic ?? 0);
    merged.vp = (merged.vp ?? 0) + (g.vp ?? 0);
    merged.chargePower = (merged.chargePower ?? 0) + (g.chargePower ?? 0);
    merged.powerToken = (merged.powerToken ?? 0) + (g.powerToken ?? 0);
    merged.gaiaformer = (merged.gaiaformer ?? 0) + (g.gaiaformer ?? 0);
  }
  // 收入充能顺序：同时含 token 与充能、且顺序有实际影响（充能会碰到 I 区）
  // 且无法转满时——defer 给玩家决策（incomeQueue），其余照常自动结算。
  const tokens = merged.powerToken ?? 0;
  const charge = merged.chargePower ?? 0;
  if (incomeOrderNeedsDecision(p, tokens, charge)) {
    const rest = { ...merged };
    delete rest.powerToken;
    delete rest.chargePower;
    applyGain(state, idx, rest);
    state.incomeQueue.push({ player: idx, tokens, charge });
  } else {
    applyGain(state, idx, merged);
  }
  // LF art-pwt：每枚 +2 power token 直接 III 区。
  const artPwt = p.artifacts.filter((a) => a.id === 'art-pwt').length;
  if (artPwt > 0) {
    gainPowerTokensToBowl3(p, artPwt * 2);
  }
}

/**
 * 盖亚阶段：gaiaProjectsInProgress 转化（transdim→gaia、gaiaformerOf 留置）；
 * gaia 区 power → I 区（terrans → II 区，brainstone 跟随）；baltaks gaiaformer 返回。
 * terrans/itars 已建 PI 且 gaia 区有 power 的玩家：power 暂不移动，按桌序压入
 * gaiaPhaseQueue，逐个置为 pending（terrans 免费兑换 / itars 弃 4 换科技板），
 * 响应行动处理时由 activateNextGaiaPending 串联。
 */
function settleGaiaPhase(state: GameState): void {
  // 盖亚计划转化
  for (const proj of state.gaiaProjectsInProgress) {
    const hex = state.map[proj.hex];
    if (hex !== undefined && hex.planet === 'transdim' && hex.building === undefined) {
      hex.planet = 'gaia';
      hex.gaiaformerOf = proj.player;
    }
  }
  state.gaiaProjectsInProgress = [];

  state.gaiaPhaseQueue = [];
  for (const i of state.turnOrder) {
    const p = state.players[i]!;
    // baltaks：暂存在 gaia 区的 gaiaformer 返回面板
    p.gaiaformers.available += p.gaiaformers.inGaia;
    p.gaiaformers.inGaia = 0;
    // terrans/itars PI：gaia 区 power 留待 pending 决策（兑换/换板后才移走）
    const piGaiaDecision =
      (p.faction === 'terrans' || p.faction === 'itars') && p.buildings.pi === 0 && p.power.gaia > 0;
    if (piGaiaDecision) {
      state.gaiaPhaseQueue.push(i);
      continue;
    }
    // gaia 区 power → I 区（terrans 能力：→ II 区）
    moveGaiaPowerToBowl(p, p.faction === 'terrans' ? 'bowl2' : 'bowl1');
  }
  // Tinkeroids：每轮开始选本轮 Tinkering tile（排在盖亚阶段 PI 决策之后）。
  for (const i of state.turnOrder) {
    const p = state.players[i]!;
    if (p.faction === 'tinkeroids' && tinkeringChoices(state, i).length > 0) {
      state.gaiaPhaseQueue.push(i);
    }
  }
  activateNextGaiaPending(state);
}

/**
 * 盖亚阶段 PI 决策串联：弹出 gaiaPhaseQueue 队首置为 pending；
 * 队列空则 pending=null（盖亚阶段结束）。terrans-gaia-done / itars-gaia-tech
 * 响应行动处理时调用（actions/gaia.ts）。
 */
export function activateNextGaiaPending(state: GameState): void {
  const next = state.gaiaPhaseQueue.shift();
  if (next === undefined) {
    state.pending = null;
    return;
  }
  const faction = state.players[next]!.faction;
  if (faction === 'tinkeroids') {
    state.pending = { kind: 'tinkering', player: next };
    return;
  }
  state.pending = { kind: faction === 'terrans' ? 'terrans-gaia' : 'itars-gaia', player: next };
}

/** 整理阶段 → 下一轮或终局。 */
export function settleRoundEnd(state: GameState): void {
  // 整理：清本轮已用标记
  state.board.boardActionsUsed = [];
  state.board.shipActionsUsed = [];
  for (const p of state.players) {
    p.specialUsed = [];
    p.roundAbilityUsed = [];
    // Tinkeroids：回合结束移除当前 Tinkering tile（选定时已移出池，每块限用一次）。
    if (p.tinkering.current !== null) {
      p.tinkering.current = null;
    }
  }
  state.lastEvents = [...state.lastEvents, `round-${state.round}-end`];

  if (state.round >= 6) {
    finalScoring(state);
    return;
  }
  state.round += 1;
  // 下一轮行动顺序 = 本轮 pass 顺序（首个 pass 者先手；与参考引擎一致）。
  state.turnOrder = [...state.passedPlayers];
  state.passedPlayers = [];
  settleRoundStart(state);
  state.currentPlayerIdx = state.turnOrder[0] ?? state.firstPlayer;
}
