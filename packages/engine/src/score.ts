/**
 * 计数单位与终局计分。
 * 终局：2 张终局板各按条件计数排名 18/12/6/0（并列共享名次 vp 之和均分、
 * 计数为 0 不得分；1–2 人局加中立占位 neutralValue 参与排名——参照
 * reference/gaia-engine/src/engine.ts finalScoringPhase）+ 每轨 L3/L4/L5
 * 各 +4vp + floor((o+c+k)/3)vp。
 */
import type { GameState, HexState, PlayerIndex } from './types.js';
import type { HexKey } from './hex.js';
import { hexDistance, parseHexKey } from './hex.js';
import { colonizedHexes, playerBuildings } from './map.js';
import { FINAL_RANK_VP, FINAL_SCORING, type FinalCondition } from './data/scoring.js';
import { BUILDING_POWER_VALUE } from './data/prices.js';
import { addVp, burnPower, MAX_CREDITS, MAX_ORE, spendablePower } from './state.js';
import type { CountUnit } from './data/rewards.js';

/** 地图上满足条件的己方 hex（own building / lantids 附加矿 / Lost Planet 卫星）。 */
function ownHexes(state: GameState, idx: PlayerIndex): [HexKey, HexState][] {
  const out: [HexKey, HexState][] = [];
  for (const [key, hex] of Object.entries(state.map) as [HexKey, HexState][]) {
    if (hex.building !== undefined && hex.building.player === idx) {
      out.push([key, hex]);
    }
  }
  return out;
}

/** Lantids 附加矿数。 */
function additionalMines(state: GameState, idx: PlayerIndex): number {
  let n = 0;
  for (const hex of Object.values(state.map)) {
    if (hex.additionalMine === idx) {
      n += 1;
    }
  }
  return n;
}

/** 已殖民的 Gaia 星球数（己方有建筑的 gaia hex；Lantids 附加矿不计）。 */
function colonizedGaiaPlanets(state: GameState, idx: PlayerIndex): number {
  let n = 0;
  for (const hex of Object.values(state.map)) {
    if (hex.planet === 'gaia' && hex.building !== undefined && hex.building.player === idx) {
      n += 1;
    }
  }
  return n;
}

/** 已殖民的小行星数。 */
function colonizedAsteroids(state: GameState, idx: PlayerIndex): number {
  let n = 0;
  for (const hex of Object.values(state.map)) {
    if (hex.planet === 'asteroid' && hex.building !== undefined && hex.building.player === idx) {
      n += 1;
    }
  }
  return n;
}

/** hex 是否被 idx 殖民（建筑 pv>0 / 附加矿 / Lost Planet 卫星）。 */
function isColonizedBy(hex: HexState, idx: PlayerIndex): boolean {
  if (hex.additionalMine === idx) {
    return true;
  }
  if (hex.planet === 'lost' && hex.satelliteOf === idx) {
    return true;
  }
  return (
    hex.building !== undefined &&
    hex.building.player === idx &&
    BUILDING_POWER_VALUE[hex.building.type] > 0
  );
}

/** 已殖民的深空扇区数（Lost Planet 所在深空扇区也算）。 */
function colonizedDeepSpaceSectors(state: GameState, idx: PlayerIndex): number {
  const sectors = new Set<string>();
  for (const hex of Object.values(state.map)) {
    if (hex.deepSpace && isColonizedBy(hex, idx)) {
      sectors.add(hex.sector);
    }
  }
  return sectors.size;
}

/**
 * 已殖民的普通（Space）扇区数：不含深空三角板与 Interspace。
 * 参考 Condition.Sector 的 owner ruling：通用"sector"计数（sector 终局板、
 * per-sector 高级板）不含 Deep Space；NewSector/darkanians PI 才含
 * （那边走 colonizedSectors 触发列表，不动）。
 */
function colonizedSpaceSectors(state: GameState, idx: PlayerIndex): number {
  const sectors = new Set<string>();
  for (const hex of Object.values(state.map)) {
    if (!hex.deepSpace && hex.sector !== 'interspace' && isColonizedBy(hex, idx)) {
      sectors.add(hex.sector);
    }
  }
  return sectors.size;
}

/** 计数单位（助推器 passVp / 高级板 once/pass / qic 行动等共用）。 */
export function countUnits(state: GameState, idx: PlayerIndex, unit: CountUnit): number {
  const p = state.players[idx]!;
  const buildingsOf = (type: string): number =>
    playerBuildings(state.map, idx).filter((b) => b.building.type === type).length;
  switch (unit) {
    case 'mine':
      // Lost Planet 的矿计入（规则书 Appendix IV booster6 "including the Lost Planet"）；
      // art-asteroid/art-proto 视作无扇区 asteroid/proto 上的一个矿（不实际放置）。
      return (
        buildingsOf('mine') +
        additionalMines(state, idx) +
        (p.lostPlanetPlaced ? 1 : 0) +
        p.artifacts.filter((a) => a.id === 'art-asteroid' || a.id === 'art-proto').length
      );
    case 'ts':
      return buildingsOf('ts');
    case 'lab':
      return buildingsOf('lab');
    case 'pi-academy':
      return buildingsOf('pi') + buildingsOf('ac1') + buildingsOf('ac2');
    case 'gaia-planet':
      return colonizedGaiaPlanets(state, idx);
    case 'planet-type':
      return p.colonizedPlanetTypes.length;
    case 'sector':
      return colonizedSpaceSectors(state, idx);
    case 'deep-space-sector':
      return colonizedDeepSpaceSectors(state, idx);
    case 'federation-token':
      return p.federationTokens.length;
    case 'gaiaformer':
      // 含已部署；报废于小行星的不计。
      return p.gaiaformers.total - p.gaiaformers.lost;
    case 'asteroid':
      // art-asteroid 同样计作小行星上的矿（"counts for all purposes as a mine on
      // an asteroid"）；art-proto 计作原行星上的矿，不算小行星。
      return colonizedAsteroids(state, idx) + p.artifacts.filter((a) => a.id === 'art-asteroid').length;
    case 'standard-tech-tile':
      return p.techTiles.length; // 含被高级板覆盖的
  }
}

/** PI 与最近学院的距离（LF 终局板；缺任一不得分 = 0）。 */
function piAcademyDistance(state: GameState, idx: PlayerIndex): number {
  let piHex: HexKey | null = null;
  const academies: HexKey[] = [];
  for (const [key, hex] of ownHexes(state, idx)) {
    if (hex.building?.type === 'pi') {
      piHex = key;
    } else if (hex.building?.type === 'ac1' || hex.building?.type === 'ac2') {
      academies.push(key);
    }
  }
  if (piHex === null || academies.length === 0) {
    return 0;
  }
  const pi = parseHexKey(piHex);
  // PI 与最远学院的距离（参考 player.ts PlanetaryInstituteAcademyDistance 用 Math.max）。
  return Math.max(...academies.map((a) => hexDistance(pi, parseHexKey(a))));
}

/** 某玩家在某终局条件下的计数。 */
export function finalCount(state: GameState, idx: PlayerIndex, condition: FinalCondition): number {
  const p = state.players[idx]!;
  switch (condition) {
    case 'structure':
      // Lost Planet 的矿算一个 structure。
      return colonizedHexes(state.map, idx).length + (p.lostPlanetPlaced ? 1 : 0);
    case 'structure-fed': {
      let n = 0;
      for (const hex of Object.values(state.map)) {
        if (isColonizedBy(hex, idx) && hex.federations.includes(idx)) {
          n += 1;
        }
      }
      return n;
    }
    case 'planet-type':
      return p.colonizedPlanetTypes.length;
    case 'gaia':
      return colonizedGaiaPlanets(state, idx);
    case 'sector':
      return colonizedSpaceSectors(state, idx);
    case 'satellite':
      return p.satellites + p.spaceStations;
    case 'asteroid':
      return colonizedAsteroids(state, idx);
    case 'deep-space':
      return colonizedDeepSpaceSectors(state, idx);
    case 'pi-academy-distance':
      return piAcademyDistance(state, idx);
  }
}

/**
 * 终局计分（原地修改）：终局板排名 vp + 研究轨 L3/4/5 vp + 剩余资源 vp，
 * 然后 phase='game-over'、winner=最高 vp 玩家数组（平分共享）。
 */
export function finalScoring(state: GameState): void {
  // 1. 终局计分板
  for (const tileId of state.board.finalScoring) {
    const def = FINAL_SCORING[tileId];
    const entries: { player: PlayerIndex | null; count: number }[] = state.players.map((_, i) => ({
      player: i,
      count: finalCount(state, i, def.condition),
    }));
    // 1–2 人局加中立占位（参照 reference：仅 players.length===2；本项目 1 人局同样加入）。
    if (state.config.playerCount <= 2 && def.neutralValue !== null) {
      entries.push({ player: null, count: def.neutralValue });
    }
    entries.sort((a, b) => b.count - a.count);
    for (const e of entries) {
      // 计数为 0 不得分（reference：BGG 官方裁定）。
      if (e.player === null || e.count === 0) {
        continue;
      }
      const first = entries.findIndex((x) => x.count === e.count);
      const ties = entries.filter((x) => x.count === e.count).length;
      const vp = Math.floor(
        FINAL_RANK_VP.slice(first, first + ties).reduce((s, v) => s + v, 0) / ties,
      );
      addVp(state.players[e.player]!, vp);
    }
  }

  // 2. 每轨 L3/L4/L5 各 +4vp（reference gainResearchVictoryPoints）
  for (const p of state.players) {
    for (const lvl of Object.values(p.research)) {
      if (lvl >= 3) {
        addVp(p, (lvl - 2) * 4);
      }
    }
  }

  // 3. 终局资源结算（参照参考引擎 finalResourceHandling）：
  // burn（II 区 2→1 到 III 区）→ III 区 power 按 spendablePower 换 credits
  // （token 回 I 区，brainstone 回 I 区）→ qic 1:1 换 ore → 每 3 点 (o+c+k) +1vp。
  for (const p of state.players) {
    const pw = p.power;
    const burnable = Math.floor((pw.bowl2 + (pw.brainstone === 'bowl2' ? 1 : 0)) / 2);
    for (let i = 0; i < burnable; i++) {
      burnPower(p);
    }
    const creditGain = spendablePower(p);
    if (creditGain > 0) {
      pw.bowl1 += pw.bowl3;
      pw.bowl3 = 0;
      if (pw.brainstone === 'bowl3') {
        pw.brainstone = 'bowl1';
      }
      p.resources.credits = Math.min(MAX_CREDITS, p.resources.credits + creditGain);
    }
    if (p.resources.qic > 0) {
      p.resources.ore = Math.min(MAX_ORE, p.resources.ore + p.resources.qic);
      p.resources.qic = 0;
    }
  }
  for (const p of state.players) {
    const r = p.resources;
    addVp(p, Math.floor((r.ore + r.credits + r.knowledge) / 3));
  }

  // 3. 结束
  state.phase = 'game-over';
  const maxVp = Math.max(...state.players.map((p) => p.vp));
  state.winner = state.players.flatMap((p, i) => (p.vp === maxVp ? [i] : []));
  state.lastEvents = [...state.lastEvents, 'game-over'];
}
