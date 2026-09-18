/**
 * 触发器框架（注册式）：每类事件遍历当前回合计分板 + 玩家科技板（含高级板）
 * + 种族能力，结算 VP/资源。
 *
 * 已实现事件：onMineBuilt / onTerraformSteps / onResearchAdvance /
 * onFederationFormed / onPass / onUpgrade（升 ts：score5/score8/advtech15；
 * 升 lab：scorelf3；升 PI/学院：score7/score10）。
 */
import type { GameState, PlayerIndex, ResearchTrack } from './types.js';
import { ROUND_SCORING, type RoundScoringTrigger } from './data/scoring.js';
import { TECH_TILES, ADV_TECH_TILES } from './data/techs.js';
import type { TechTrigger } from './data/techs.js';
import { addVp, player } from './state.js';
import { countUnits } from './score.js';

/** 建矿事件上下文。 */
export interface MineEvent {
  /** 在 Gaia 星球上建矿（Lantids 附加矿不算殖民 Gaia，置 false）。 */
  onGaiaPlanet: boolean;
  /** 首次殖民该扇区。 */
  newSector: boolean;
  /** 首次殖民该星球类型（Lantids 附加矿恒 false）。 */
  newPlanetType: boolean;
}

/** 当前回合计分板对某触发时机的 vp（setup/round 0 无计分板）。 */
function roundScoringVp(state: GameState, on: RoundScoringTrigger): number {
  if (state.round < 1) {
    return 0;
  }
  const tileId = state.board.roundScoring[state.round - 1];
  if (tileId === undefined) {
    return 0;
  }
  const def = ROUND_SCORING[tileId];
  return def.trigger.on === on ? def.trigger.vp : 0;
}

/** 玩家科技板（标准板未被高级板覆盖的 + 高级板）对某触发时机的 vp。 */
function techTriggerVp(state: GameState, idx: PlayerIndex, on: TechTrigger): number {
  const p = player(state, idx);
  const covered = new Set(p.advTechTiles.map((a) => a.covers));
  let vp = 0;
  for (const t of p.techTiles) {
    if (covered.has(t)) {
      continue;
    }
    const eff = TECH_TILES[t].effect;
    if (eff.kind === 'trigger' && eff.on === on) {
      vp += eff.gain?.vp ?? 0;
    }
  }
  for (const a of p.advTechTiles) {
    const eff = ADV_TECH_TILES[a.id].effect;
    if (eff.kind === 'trigger' && eff.on === on) {
      vp += eff.gain?.vp ?? 0;
    }
  }
  return vp;
}

/** 建矿结算：score3/score6/score9/scorelf1/scorelf2 + tech7/advtech14 + gleens 能力。 */
export function onMineBuilt(state: GameState, idx: PlayerIndex, ev: MineEvent): void {
  const p = player(state, idx);
  let vp = roundScoringVp(state, 'build-mine');
  vp += techTriggerVp(state, idx, 'build-mine');
  if (ev.onGaiaPlanet) {
    vp += roundScoringVp(state, 'build-mine-gaia');
    vp += techTriggerVp(state, idx, 'build-mine-gaia');
    // Gleens 能力：每次在 Gaia 星球建矿 +2vp。
    if (p.faction === 'gleens') {
      vp += 2;
    }
  }
  if (ev.newSector) {
    vp += roundScoringVp(state, 'build-mine-new-sector');
  }
  if (ev.newPlanetType) {
    vp += roundScoringVp(state, 'build-mine-new-planet-type');
  }
  if (vp !== 0) {
    addVp(p, vp);
  }
}

/** terraform 步触发（score1 与 advtechlf6 均每步 +2vp，含免费步——参考引擎
 * receiveTerraformingStepTriggerIncome 按 stepsReq 全量计）。 */
export function onTerraformSteps(state: GameState, idx: PlayerIndex, totalSteps: number): void {
  const p = player(state, idx);
  let vp = roundScoringVp(state, 'terraform-step') * totalSteps;
  // advtechlf6：每次 terraform 步 +2vp（含免费步）。
  vp += techTriggerVp(state, idx, 'terraform-step') * totalSteps;
  if (vp !== 0) {
    addVp(p, vp);
  }
}

/** Q.I.C. 行动（LF 飞船 QIC 格；advtechlf5 每次 +4vp）。 */
export function onQicAction(state: GameState, idx: PlayerIndex): void {
  const vp = techTriggerVp(state, idx, 'qic-action');
  if (vp !== 0) {
    addVp(player(state, idx), vp);
  }
}

/** 殖民新星球类型（art-asteroid/art-proto 视作建矿殖民；只触发新类型回合计分）。 */
export function onNewPlanetType(state: GameState, idx: PlayerIndex): void {
  const vp = roundScoringVp(state, 'build-mine-new-planet-type');
  if (vp !== 0) {
    addVp(player(state, idx), vp);
  }
}

/** 研究推进（score2 +2vp、advtech2 +2vp）。 */
export function onResearchAdvance(state: GameState, idx: PlayerIndex, _track: ResearchTrack): void {
  const vp = roundScoringVp(state, 'research') + techTriggerVp(state, idx, 'research');
  if (vp !== 0) {
    addVp(player(state, idx), vp);
  }
}

/** 组建联邦 / 拿联邦标记（score4 +5vp；含 Terraforming L5 预设标记）。 */
export function onFederationFormed(state: GameState, idx: PlayerIndex): void {
  const vp = roundScoringVp(state, 'form-federation');
  if (vp !== 0) {
    addVp(player(state, idx), vp);
  }
}

/** Pass 触发：高级科技板的 pass 效果。 */
export function onPass(state: GameState, idx: PlayerIndex): void {
  const p = player(state, idx);
  let vp = 0;
  for (const a of p.advTechTiles) {
    const eff = ADV_TECH_TILES[a.id].effect;
    if (eff.kind === 'pass' && eff.per !== undefined) {
      vp += countUnits(state, idx, eff.per) * (eff.perGain?.vp ?? 0);
    }
  }
  if (vp !== 0) {
    addVp(p, vp);
  }
}

/** 升级事件类型：升 ts / 升 lab / 升 PI 或学院。 */
export type UpgradeEvent = 'ts' | 'lab' | 'pi-academy';

/**
 * 升级结算：升 ts（score5 +4vp、score8 +3vp、advtech15 +3vp；含 firaks 降级回 ts）；
 * 升 lab（scorelf3 +4vp，LF）；升 PI/学院（score7/score10 +5vp）。
 */
export function onUpgrade(state: GameState, idx: PlayerIndex, kind: UpgradeEvent): void {
  let vp = 0;
  if (kind === 'ts') {
    vp += roundScoringVp(state, 'upgrade-ts') + techTriggerVp(state, idx, 'upgrade-ts');
  } else if (kind === 'lab') {
    vp += roundScoringVp(state, 'build-lab');
  } else {
    vp += roundScoringVp(state, 'upgrade-pi-academy');
  }
  if (vp !== 0) {
    addVp(player(state, idx), vp);
  }
}
