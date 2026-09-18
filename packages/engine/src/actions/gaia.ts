/**
 * start-gaia-project 主行动 + 盖亚阶段 PI 决策（terrans/itars）处理。
 *
 * 启动盖亚计划（rules-summary §1 + gaia-base-rules "Start a Gaia Project"）：
 * - 需 ≥1 可用 gaiaformer + 可达空 transdim hex（射程规则同建矿，可 qic 补程
 *   1q=+2 格；booster5 等临时射程经 opts.tempRange 传入）；
 * - 按 gaia 轨当前级把 6/6/4/3/3 power 从任意区（I/II/III 混合，taklons
 *   brainstone 可当 3）移入 gaia 区（规范化顺序见 state.ts movePowerToGaia）；
 * - gaiaformer available-1，登记 gaiaProjectsInProgress；下轮盖亚阶段
 *   transdim→gaia（turn.ts settleGaiaPhase 转化，gaiaformer 留置星球）。
 * 每回合 1 次（主行动），多个 gaiaformer 可分多回合各启动一个。
 */
import { IllegalActionError } from '../errors.js';
import type {
  Action,
  AdvTechTileId,
  FederationTokenId,
  GameState,
  PlayerIndex,
  PlayerState,
  PowerAreaAmounts,
  ResearchTrack,
  TechTileId,
} from '../types.js';
import type { HexKey } from '../hex.js';
import { minDistanceToAny } from '../map.js';
import { RESEARCH_TRACKS } from '../data/research.js';
import { moveGaiaPowerToBowl, movePowerToGaia, movePowerToGaiaFrom, player, spendResources } from '../state.js';
import { activateNextGaiaPending } from '../turn.js';
import { applyTechTileChoice, type TechTileChoice } from './tech.js';
import type { ResearchAdvanceChoice } from './research.js';
import { rangeOf, rangeSources } from './mine.js';

/** 盖亚计划选项（booster5 临时射程 +3；powerFrom = harness 来源区覆盖）。 */
export interface GaiaProjectOptions {
  tempRange?: number;
  /** power 来源区覆盖（缺省=III→II→I 规范化约定）。 */
  powerFrom?: PowerAreaAmounts | undefined;
}

/** 当前 gaia 轨等级下的盖亚计划 power 费；null=不能启动（gaia 轨 L0）。 */
export function gaiaProjectCost(p: PlayerState): number | null {
  const lvl = p.research.gaia;
  if (lvl < 1) {
    return null;
  }
  return RESEARCH_TRACKS.gaia.levels[lvl - 1]?.gaiaProjectCost ?? null;
}

/** 可移入 gaia 区的 power 总量（三区 token + brainstone 当 3）。 */
function movablePower(p: PlayerState): number {
  const pw = p.power;
  return pw.bowl1 + pw.bowl2 + pw.bowl3 + (pw.brainstone !== 'none' ? 3 : 0);
}

/** 计算盖亚计划目标与最小成本；非法返回 null（枚举与 apply 共用）。 */
export function computeGaiaProjectTarget(
  state: GameState,
  idx: PlayerIndex,
  hexKey: HexKey,
  opts?: GaiaProjectOptions,
): { qic: number; powerCost: number } | null {
  const p = state.players[idx];
  const hex = state.map[hexKey];
  if (p === undefined || hex === undefined) {
    return null;
  }
  if (p.gaiaformers.available < 1) {
    return null;
  }
  if (hex.planet !== 'transdim' || hex.building !== undefined || hex.ship !== undefined) {
    return null;
  }
  // 已有盖亚计划进行中的 transdim 格不可重复启动（gaiaformer 已部署在星球上）。
  if (state.gaiaProjectsInProgress.some((pr) => pr.hex === hexKey)) {
    return null;
  }
  const powerCost = gaiaProjectCost(p);
  if (powerCost === null || movablePower(p) < powerCost) {
    return null;
  }
  const range = rangeOf(p) + (opts?.tempRange ?? 0);
  const need = minDistanceToAny(state.map, rangeSources(state, idx), hexKey) - range;
  return { qic: need > 0 ? Math.ceil(need / 2) : 0, powerCost };
}

/** 枚举 start-gaia-project 行动（只含负担得起 qic 补程的目标）。 */
export function enumerateGaiaProject(state: GameState, idx: PlayerIndex, opts?: GaiaProjectOptions): Action[] {
  const p = state.players[idx]!;
  const out: Action[] = [];
  for (const key of Object.keys(state.map) as HexKey[]) {
    const t = computeGaiaProjectTarget(state, idx, key, opts);
    if (t !== null && p.resources.qic >= t.qic) {
      out.push({ type: 'start-gaia-project', hex: key });
    }
  }
  return out;
}

/** 应用 start-gaia-project（原地修改）；opts 须与枚举时一致。 */
export function applyGaiaProject(state: GameState, idx: PlayerIndex, hexKey: HexKey, opts?: GaiaProjectOptions): void {
  const t = computeGaiaProjectTarget(state, idx, hexKey, opts);
  if (t === null) {
    throw new IllegalActionError('illegal-gaia-project', `非法盖亚计划目标: ${hexKey}`);
  }
  const p = player(state, idx);
  spendResources(p, { qic: t.qic });
  if (opts?.powerFrom !== undefined) {
    movePowerToGaiaFrom(p, opts.powerFrom);
  } else {
    movePowerToGaia(p, t.powerCost);
  }
  p.gaiaformers.available -= 1;
  state.gaiaProjectsInProgress.push({ player: idx, hex: hexKey });
}

// ---------------------------------------------------------------------------
// 盖亚阶段 PI 决策响应（pending terrans-gaia / itars-gaia）
// ---------------------------------------------------------------------------

/** terrans-gaia-done：结束兑换，gaia 区剩余 power → II 区（terrans 能力），处理下一个队列玩家。 */
export function applyTerransGaiaDone(state: GameState): void {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'terrans-gaia') {
    throw new IllegalActionError('no-pending-terrans', '当前没有待决的 terrans 盖亚决策');
  }
  moveGaiaPowerToBowl(player(state, pending.player), 'bowl2');
  activateNextGaiaPending(state);
}

/**
 * itars-gaia-tech：弃 4 gaia power 换 1 科技板（可重复，pending 保持）；
 * techTile=null 且无 advTechTile = 结束（gaia 区剩余 power → I 区，处理下一个队列玩家）。
 */
export function applyItarsGaiaTech(
  state: GameState,
  action: {
    techTile: TechTileId | null;
    advTechTile?: AdvTechTileId;
    coverTechTile?: TechTileId;
    flipToken?: FederationTokenId;
    research?: ResearchTrack | null;
  },
): void {
  const pending = state.pending;
  if (pending === null || pending.kind !== 'itars-gaia') {
    throw new IllegalActionError('no-pending-itars', '当前没有待决的 itars 盖亚决策');
  }
  const p = player(state, pending.player);
  if (action.techTile === null && action.advTechTile === undefined) {
    moveGaiaPowerToBowl(p, 'bowl1');
    activateNextGaiaPending(state);
    return;
  }
  if (p.power.gaia < 4) {
    throw new IllegalActionError('insufficient-gaia-power', `Gaia 区 power 不足 4: ${p.power.gaia}`);
  }
  p.power.gaia -= 4;
  p.powerStats.discarded += 4;
  const choice: TechTileChoice = { research: null };
  if (action.techTile !== null && action.techTile !== undefined) {
    choice.techTile = action.techTile;
  }
  if (action.advTechTile !== undefined) {
    choice.advTechTile = action.advTechTile;
  }
  if (action.coverTechTile !== undefined) {
    choice.coverTechTile = action.coverTechTile;
  }
  if (action.flipToken !== undefined) {
    choice.flipToken = action.flipToken;
  }
  if (action.research !== undefined && action.research !== null) {
    choice.research = { track: action.research };
  }
  // itars 换板的研究推进在枚举层已禁用 L5，不会产生 Lost Planet 充能邀约。
  applyTechTileChoice(state, pending.player, choice);
}
