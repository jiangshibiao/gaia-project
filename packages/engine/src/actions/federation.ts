/**
 * form-federation 主行动：联邦形状枚举、校验与结算。
 *
 * 规则（gaia-base-rules "Form a Federation" + rules-summary §1）：
 * - 参与星球：己方已殖民星球（pv>0 建筑 / Lantids 附加矿 / Lost Planet /
 *   Ivits 空间站），不得已在其它联邦（Ivits 扩展除外）。
 * - 连通：相邻直连 + 卫星桥接。卫星格须为可放置空格（非星球、无建筑
 *   （对手空间站除外）、无飞船），与联邦星球/卫星相邻；每格可被多方联邦
 *   共用（参考引擎行为；satelliteOf 记首个放置者，federations 为多玩家列表）。
 * - power value 总和 ≥7（xenos PI ≥6；Ivits 扩展 ≥7X，X=已有标记数+1，
 *   不含 Terraforming L5 枚）；pv 含 tech3/bescods PI/Moweyds 环加成
 *   （charge.ts buildingPowerValue）+ 附加矿/Lost Planet/空间站各 1；卫星不计 pv。
 * - 卫星数必须最少（对所选星球集）；每枚星球/卫星只属一个联邦；
 *   新联邦不得与已有联邦相邻（Ivits 扩展恰好相反：必须连入已有联邦）。
 * - 卫星费用：每颗弃 1 power token（任意区，规范化顺序见 state.ts
 *   discardPowerTokens）；Ivits 付 1q 替代。
 * - 结算：hex.federations 登记（星球+卫星）、拿标记（绿面、立即得奖励）、
 *   触发 onFederationFormed（score4 +5vp）。
 *
 * 枚举策略（2026-09-21 重写；对齐参考引擎 possibleCombinationsForFederations）：
 * 对玩家未入联邦的已殖民星球按邻接聚成连通分量，枚举
 * (a) 每个 pv 达标且满足相邻约束的单分量联邦；
 * (b) 分量子集枚举（≤12 分量）：pv ≥ 阈值且**极小**（去掉任一分量即不达标，
 *     = "不得多用星球+卫星"），连通卫星取 Steiner 最少树（TM 启发式，
 *     路径共享格只计 1 颗，与参考引擎 spanningTree heuristic 同型）；
 * (c) 分量数 >12 时回退：两两合并 + 全体 MST（原策略，护栏防爆）。
 * 更早版本只做两两合并/全体 MST，漏掉 3+ 分量部分合并解（曾致应有联邦时按钮全暗）。
 */
import { IllegalActionError } from '../errors.js';
import type { Action, FederationTokenId, FreeMineOptions, GameState, PlayerIndex, PowerAreaAmounts } from '../types.js';
import type { HexKey } from '../hex.js';
import { mapNeighbors } from '../map.js';
import { FEDERATION_TOKENS } from '../data/federations.js';
import { FEDERATION_MIN_POWER } from '../data/prices.js';
import { addVp, applyGain, discardPowerTokens, discardPowerTokensFrom, gainPowerTokensToBowl3, player, spendResources } from '../state.js';
import { onFederationFormed } from '../triggers.js';
import { buildingPowerValue } from './charge.js';
import { settlePendingAfter } from './tech.js';

/** 一个联邦形状（参与星球 + 新建卫星）。 */
export interface FederationShape {
  planets: HexKey[];
  satellites: HexKey[];
}

/** hex 上该玩家的联邦 pv（建筑 pv + 附加矿/Lost Planet/空间站各 1；卫星 0）。 */
export function federationPvOf(state: GameState, idx: PlayerIndex, hexKey: HexKey): number {
  const hex = state.map[hexKey]!;
  let pv = buildingPowerValue(state, idx, hex);
  if (hex.additionalMine === idx) {
    pv += 1;
  }
  if (hex.planet === 'lost' && hex.satelliteOf === idx) {
    pv += 1;
  }
  if (hex.building?.type === 'sp' && hex.building.player === idx) {
    pv += 1;
  }
  return pv;
}

/**
 * 新建筑并入邻近联邦（参照参考引擎 player.ts addBuildingToNearbyFederation）：
 * 非 gf 建筑落在与己联邦相邻的格时，其"建筑群"（新格 + 经己联邦格/联邦价值>0
 * 的己建筑格连通扩展）全部登记进该玩家的联邦。建矿/升级/空间站均走此路径。
 */
export function addBuildingToNearbyFederation(state: GameState, idx: PlayerIndex, hexKey: HexKey): void {
  const hex = state.map[hexKey]!;
  if (hex.federations.includes(idx)) {
    return;
  }
  const hasFederationNeighbor = mapNeighbors(state.map, hexKey).some((nb) =>
    state.map[nb]!.federations.includes(idx),
  );
  if (!hasFederationNeighbor) {
    return;
  }
  const group = new Set<HexKey>([hexKey]);
  const queue = [hexKey];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const nb of mapNeighbors(state.map, cur)) {
      if (group.has(nb)) {
        continue;
      }
      if (state.map[nb]!.federations.includes(idx) || federationPvOf(state, idx, nb) > 0) {
        group.add(nb);
        queue.push(nb);
      }
    }
  }
  for (const key of group) {
    const h = state.map[key]!;
    if (!h.federations.includes(idx)) {
      h.federations.push(idx);
    }
  }
}

/** 该玩家 hex 是否可作为联邦星球节点（pv>0）。 */
function isFederationPlanet(state: GameState, idx: PlayerIndex, hexKey: HexKey): boolean {
  return federationPvOf(state, idx, hexKey) > 0;
}

/** 联邦标记供应中该玩家可拿的 id（gleens 标记仅 gleens 可拿；LF 含已探索船上的金框标记）。 */
function availableTokenIds(state: GameState, idx: PlayerIndex): FederationTokenId[] {
  const p = state.players[idx]!;
  const out: FederationTokenId[] = [];
  for (const [id, count] of Object.entries(state.board.federationTokens)) {
    if ((count ?? 0) <= 0) {
      continue;
    }
    const def = FEDERATION_TOKENS[id as FederationTokenId];
    if (def.gleensOnly === true && p.faction !== 'gleens') {
      continue;
    }
    out.push(id as FederationTokenId);
  }
  // LF：有穿梭机且仍有标记的船。
  for (const ship of state.board.ships) {
    if (ship.federationToken !== null && p.shuttles.some((s) => s.ship === ship.id)) {
      out.push(ship.federationToken);
    }
  }
  return out;
}

/**
 * 联邦标记奖励结算（拿标记与"重结算"共用；原地修改）。
 * 返回需要转 pending 的即时效果（fedlf2 拿板 / fedlf3、fedlf4 免费建矿）。
 */
export function applyFederationTokenReward(
  state: GameState,
  idx: PlayerIndex,
  tokenId: FederationTokenId,
): { freeMine?: FreeMineOptions; gainTechTile?: boolean } {
  const p = player(state, idx);
  const def = FEDERATION_TOKENS[tokenId];
  addVp(p, def.vp);
  if (def.other !== undefined) {
    applyGain(state, idx, def.other);
  }
  switch (def.immediate) {
    case 'tech-tile':
      return { gainTechTile: true };
    case 'free-mine-unlimited-range':
      // 无限射程、免矿费；terraform 步 ore 照付、Gaia 星球 qic 照付。
      return { freeMine: { unlimitedRange: true, waiveMineCost: true } };
    case 'free-mine-3-steps':
      // 3 免费步、免矿费；可 qic 加程。
      return { freeMine: { freeTerraformSteps: 3, waiveMineCost: true } };
    case 'power-tokens-bowl3':
      // fedlf8：2 个 power token 直接 III 区。
      gainPowerTokensToBowl3(p, 2);
      return {};
    default:
      return {};
  }
}

/** 该玩家的联邦 pv 阈值（xenos PI 6；Ivits 扩展 7X；其余 7）。 */
function federationThreshold(state: GameState, idx: PlayerIndex, extending: boolean): number {
  const p = state.players[idx]!;
  if (p.faction === 'ivits' && extending) {
    const owned = p.federationTokens.filter((t) => t.fromTerraformingL5 !== true).length;
    return FEDERATION_MIN_POWER * (owned + 1);
  }
  if (p.faction === 'xenos' && p.buildings.pi === 0) {
    return 6;
  }
  return FEDERATION_MIN_POWER;
}

/** 玩家已有联邦的全部 hex（星球+卫星+空间站；federations 登记）。 */
function existingFederationHexes(state: GameState, idx: PlayerIndex): Set<HexKey> {
  const out = new Set<HexKey>();
  for (const [key, hex] of Object.entries(state.map)) {
    if (hex.federations.includes(idx)) {
      out.add(key as HexKey);
    }
  }
  return out;
}

/** 卫星可放置格：非星球、无建筑（空间站格可放）、无飞船。
 * 已有卫星（对手）的格可再放（参考引擎：excludedHexes 只排除己方联邦格；
 * hex.federations 是多玩家列表，satelliteOf 记录首个放置者）。 */
function satellitePlaceable(state: GameState, hexKey: HexKey): boolean {
  const hex = state.map[hexKey]!;
  if (hex.planet !== 'empty' || hex.ship !== undefined) {
    return false;
  }
  return hex.building === undefined || hex.building.type === 'sp';
}

/**
 * 两组 hex 之间的最少卫星路径（BFS；中间格须可放置卫星）。
 * forbidden 为不可经过的格（已有联邦格及其邻格——相邻约束）。
 * 返回中间卫星格列表；不可达返回 null。
 */
function satellitePath(
  state: GameState,
  from: HexKey[],
  to: HexKey[],
  forbidden: Set<HexKey>,
): HexKey[] | null {
  const target = new Set(to);
  const prev = new Map<HexKey, HexKey | null>();
  const queue: HexKey[] = [];
  for (const h of from) {
    prev.set(h, null);
    queue.push(h);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (target.has(cur)) {
      // 回溯路径，去掉两端星球格，剩下的即卫星格。
      const path: HexKey[] = [];
      let node: HexKey | null = cur;
      while (node !== null) {
        path.unshift(node);
        node = prev.get(node) ?? null;
      }
      return path.slice(1, -1);
    }
    for (const nb of mapNeighbors(state.map, cur)) {
      if (prev.has(nb) || forbidden.has(nb)) {
        continue;
      }
      if (!target.has(nb) && !satellitePlaceable(state, nb)) {
        continue;
      }
      prev.set(nb, cur);
      queue.push(nb);
    }
  }
  return null;
}

/** 邻接连通分量（星球节点间仅按直接相邻聚类）。 */
function connectedComponents(state: GameState, hexes: HexKey[]): HexKey[][] {
  const remaining = new Set(hexes);
  const out: HexKey[][] = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value as HexKey;
    remaining.delete(start);
    const comp = [start];
    const queue = [start];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of mapNeighbors(state.map, cur)) {
        if (remaining.has(nb)) {
          remaining.delete(nb);
          comp.push(nb);
          queue.push(nb);
        }
      }
    }
    out.push(comp);
  }
  return out;
}

/** 分量 pv 总和。 */
function componentPv(state: GameState, idx: PlayerIndex, comp: HexKey[]): number {
  return comp.reduce((s, h) => s + federationPvOf(state, idx, h), 0);
}

/**
 * 星球集的最少卫星连接（Takahashi–Matsuyama Steiner 启发式，与参考引擎
 * spanningTree "heuristic" 同型）：多源 BFS 逐次把最近的未接入星球格并入树。
 * 返回所需卫星格集合；不可达（forbidden 阻挡）返回 null。
 * 注：按格共享去重——多条连接路径共用同一空格时只计 1 颗卫星（最少性）。
 */
function steinerSatellites(state: GameState, planetHexes: HexKey[], forbidden: Set<HexKey>): Set<HexKey> | null {
  const planetSet = new Set(planetHexes);
  const remaining = new Set(planetHexes);
  const tree = new Set<HexKey>();
  const first = remaining.values().next().value as HexKey;
  remaining.delete(first);
  tree.add(first);
  while (remaining.size > 0) {
    const prev = new Map<HexKey, HexKey | null>();
    const queue: HexKey[] = [];
    for (const h of tree) {
      prev.set(h, null);
      queue.push(h);
    }
    let hit: HexKey | null = null;
    outer: while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const nb of mapNeighbors(state.map, cur)) {
        if (prev.has(nb) || forbidden.has(nb)) {
          continue;
        }
        if (remaining.has(nb)) {
          prev.set(nb, cur);
          hit = nb;
          break outer;
        }
        if (!satellitePlaceable(state, nb)) {
          continue;
        }
        prev.set(nb, cur);
        queue.push(nb);
      }
    }
    if (hit === null) {
      return null;
    }
    let node: HexKey | null = hit;
    while (node !== null) {
      tree.add(node);
      remaining.delete(node);
      node = prev.get(node) ?? null;
    }
  }
  const sats = new Set<HexKey>();
  for (const h of tree) {
    if (!planetSet.has(h)) {
      sats.add(h);
    }
  }
  return sats;
}

/** 子集枚举的分量数护栏（超出回退 (b) 两两 + (c) 全体，防组合爆炸）。 */
const MAX_SUBSET_COMPONENTS = 12;

/**
 * 卫星集最少化后处理（规则"卫星数必须最少"）：TM 启发式按接入顺序选路径，
 * 可能给出非最少卫星集（如先经 -6,1 接入，错过一格共享的 -6,2 解）。
 * 逐格试删：删除后星球集仍经"星球+剩余卫星格"连通则删（局部最优贪心）。
 */
function minimizeSatellites(
  state: GameState,
  planetHexes: HexKey[],
  sats: Set<HexKey>,
  forbidden: Set<HexKey>,
): Set<HexKey> {
  const result = new Set(sats);
  let changed = true;
  while (changed) {
    changed = false;
    for (const s of [...result]) {
      const trial = new Set(result);
      trial.delete(s);
      const walkable = new Set<HexKey>([...planetHexes, ...trial]);
      const seen = new Set<HexKey>([planetHexes[0]!]);
      const queue: HexKey[] = [planetHexes[0]!];
      while (queue.length > 0) {
        const cur = queue.shift()!;
        for (const nb of mapNeighbors(state.map, cur)) {
          if (seen.has(nb) || forbidden.has(nb) || !walkable.has(nb)) {
            continue;
          }
          seen.add(nb);
          queue.push(nb);
        }
      }
      if (planetHexes.every((h) => seen.has(h))) {
        result.delete(s);
        changed = true;
      }
    }
  }
  return result;
}

/**
 * 枚举联邦形状（见文件头策略说明）。
 * Ivits 已有联邦时进入扩展模式：候选 = 已有联邦 + 新分量（≥1），
 * pv 阈值为 7X 且按扩展后全联邦建筑计算。
 */
export function enumerateFederationShapes(state: GameState, idx: PlayerIndex): FederationShape[] {
  const p = state.players[idx]!;
  const fedHexes = existingFederationHexes(state, idx);
  const ivitsExtending = p.faction === 'ivits' && fedHexes.size > 0;

  // 相邻约束的禁格：已有联邦格 + 其邻格（Ivits 扩展模式豁免——必须连入已有联邦）。
  const forbidden = new Set<HexKey>();
  if (!ivitsExtending) {
    for (const h of fedHexes) {
      forbidden.add(h);
      for (const nb of mapNeighbors(state.map, h)) {
        forbidden.add(nb);
      }
    }
  }

  // 候选星球：己方联邦节点、未入联邦、不在禁格。
  const candidates: HexKey[] = [];
  for (const key of Object.keys(state.map) as HexKey[]) {
    if (!isFederationPlanet(state, idx, key)) {
      continue;
    }
    if (state.map[key]!.federations.includes(idx) || forbidden.has(key)) {
      continue;
    }
    candidates.push(key);
  }
  const components = connectedComponents(state, candidates);
  if (components.length === 0) {
    return [];
  }

  const threshold = federationThreshold(state, idx, ivitsExtending);
  const baseHexes = ivitsExtending ? [...fedHexes] : [];
  const basePv = baseHexes.reduce((s, h) => s + federationPvOf(state, idx, h), 0);
  const shapes: FederationShape[] = [];
  const seen = new Set<string>();
  const push = (planets: HexKey[], satellites: HexKey[]): void => {
    const key = [...planets].sort().join('|') + '#' + [...satellites].sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      shapes.push({ planets, satellites });
    }
  };

  // (a) 单分量（Ivits 扩展模式下须连入已有联邦，走 (b) 路径）。
  if (!ivitsExtending) {
    for (const comp of components) {
      if (componentPv(state, idx, comp) >= threshold) {
        push(comp, []);
      }
    }
  }

  // (b)+(c) 统一：分量子集枚举（对齐参考引擎 possibleCombinationsForFederations 的
  // "极小达标组合"）——任意分量子集，pv ≥ 阈值且去掉任一分量即不达标（"不得多用
  // 星球+卫星"），连通卫星取 Steiner 最少树。曾只做两两合并/全体 MST，漏掉
  // 3+ 分量的部分合并解（如 4+2+1 三组合，曾致玩家应有联邦时按钮全暗）。
  const groups: HexKey[][] = ivitsExtending ? [baseHexes, ...components] : components;
  const pvs = groups.map((g, i) => (i === 0 && ivitsExtending ? basePv : componentPv(state, idx, g)));
  if (groups.length >= 2 && groups.length <= MAX_SUBSET_COMPONENTS) {
    const n = groups.length;
    for (let mask = 1; mask < 1 << n; mask++) {
      if ((mask & (mask - 1)) === 0) continue; // 单分量已在 (a) 处理
      if (ivitsExtending && (mask & 1) === 0) continue; // Ivits 扩展必含已有联邦
      let pv = 0;
      for (let i = 0; i < n; i++) {
        if (((mask >> i) & 1) === 1) pv += pvs[i]!;
      }
      if (pv < threshold) continue;
      const planetSet = groups.flatMap((g, i) => (((mask >> i) & 1) === 1 ? g : []));
      const sats = steinerSatellites(state, planetSet, forbidden);
      if (sats === null) continue;
      // 极小性（规则书 920-923："不得用超出必需的星球**和**卫星组建联邦——
      // 若少 1 星球**且**少 1 卫星后联邦仍成立，则必须改"）：形状违规 ⟺
      // 存在某分量，去掉它之后剩余 pv 仍达标、连通、且卫星**严格更少**。
      // 桥特例：该分量位于连通要道上（去掉后卫星变多）→ 不多余；
      // 卫星数相同（只多星球）→ 规则同样允许（对齐参考 isOutclassedBy 的
      // "星球+卫星都更多才删除"）。Ivits 扩展与原 pairOk 同口径不查；
      // 已有联邦分量必含，不参与移除。
      if (!ivitsExtending) {
        let redundant = false;
        for (let i = 0; i < n; i++) {
          if (((mask >> i) & 1) !== 1) continue;
          if (pv - pvs[i]! < threshold) continue;
          const restPlanets = groups.flatMap((g, j) => (j !== i && ((mask >> j) & 1) === 1 ? g : []));
          const restSats = steinerSatellites(state, restPlanets, forbidden);
          if (restSats !== null && restSats.size < sats.size) {
            redundant = true;
            break;
          }
        }
        if (redundant) continue;
      }
      push(planetSet, [...minimizeSatellites(state, planetSet, sats, forbidden)]);
    }
    return shapes;
  }

  // ---- 护栏回退（分量数 > MAX_SUBSET_COMPONENTS）：原 (b) 两两 + (c) 全体 MST ----
  const pairOk = (i: number, j: number): boolean => {
    const pvI = pvs[i]!;
    const pvJ = pvs[j]!;
    const total = pvI + pvJ;
    if (total < threshold) {
      return false;
    }
    // "不得多用星球+卫星"：任一侧单独达标时合并即违规（Ivits 基础侧不参与此判定）。
    if (!ivitsExtending && (pvI >= threshold || pvJ >= threshold)) {
      return false;
    }
    return true;
  };
  const pairPath = (i: number, j: number): HexKey[] | null =>
    satellitePath(state, groups[i]!, groups[j]!, forbidden);
  let anyPair = false;
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      // Ivits 扩展：候选必须包含第 0 分量（已有联邦）。
      if (ivitsExtending && i !== 0) {
        continue;
      }
      if (!pairOk(i, j)) {
        continue;
      }
      const path = pairPath(i, j);
      if (path !== null) {
        anyPair = true;
        push([...groups[i]!, ...groups[j]!], path);
      }
    }
  }

  // (c) 全体分量 MST 合并：仅当 (a)(b) 无候选（否则更大联邦必然违规）。
  const anySingle = shapes.length > 0;
  if (!anySingle && !anyPair && groups.length >= 2) {
    // Prim：边权 = 分量间最少卫星数。
    const inTree = new Set<number>([0]);
    const mstSatellites = new Set<HexKey>();
    let feasible = true;
    while (inTree.size < groups.length) {
      let best: { j: number; path: HexKey[] } | null = null;
      for (const i of inTree) {
        for (let j = 0; j < groups.length; j++) {
          if (inTree.has(j)) {
            continue;
          }
          const path = pairPath(i, j);
          if (path !== null && (best === null || path.length < best.path.length)) {
            best = { j, path };
          }
        }
      }
      if (best === null) {
        feasible = false;
        break;
      }
      inTree.add(best.j);
      for (const h of best.path) {
        mstSatellites.add(h);
      }
    }
    const allPlanets = groups.flat();
    const totalPv = ivitsExtending
      ? basePv + components.reduce((s, c) => s + componentPv(state, idx, c), 0)
      : componentPv(state, idx, allPlanets);
    if (feasible && totalPv >= threshold) {
      push(allPlanets, [...mstSatellites]);
    }
  }

  return shapes;
}

/** 枚举 form-federation 行动（形状 × 可拿标记；卫星费用负担得起的才枚举）。 */
export function enumerateFormFederation(state: GameState, idx: PlayerIndex): Action[] {
  const p = state.players[idx]!;
  const tokens = availableTokenIds(state, idx);
  if (tokens.length === 0) {
    return [];
  }
  const out: Action[] = [];
  for (const shape of enumerateFederationShapes(state, idx)) {
    // 卫星费用：Ivits 付 1q/颗；其余弃 1 power token/颗。
    if (p.faction === 'ivits') {
      if (p.resources.qic < shape.satellites.length) {
        continue;
      }
    } else {
      const pw = p.power;
      const discardable = pw.bowl1 + pw.bowl2 + pw.bowl3 + (pw.brainstone !== 'none' ? 1 : 0);
      if (discardable < shape.satellites.length) {
        continue;
      }
    }
    for (const token of tokens) {
      out.push({
        type: 'form-federation',
        hexes: [...shape.planets].sort(),
        satellites: [...shape.satellites].sort(),
        token,
      });
    }
  }
  return out;
}

/** 应用 form-federation（原地修改）。trustShape=true（assumeLegal）时跳过形状防御校验
 * （harness 对拍：卫星集由参考对局给出，可能不在我们的枚举形状内）。 */
export function applyFormFederation(
  state: GameState,
  idx: PlayerIndex,
  action: { hexes: HexKey[]; satellites: HexKey[]; token: FederationTokenId; powerFrom?: PowerAreaAmounts },
  trustShape = false,
): void {
  const p = player(state, idx);
  // 形状须与枚举一致（排序后比较；合法性框架已保证，此为防御性校验）。
  const sortedPlanets = [...action.hexes].sort();
  const sortedSatellites = [...action.satellites].sort();
  if (!trustShape) {
    const match = enumerateFederationShapes(state, idx).some(
      (shape) =>
        [...shape.planets].sort().join('|') === sortedPlanets.join('|') &&
        [...shape.satellites].sort().join('|') === sortedSatellites.join('|'),
    );
    if (!match) {
      throw new IllegalActionError('illegal-federation', `非法联邦形状: ${sortedPlanets.join(',')}`);
    }
  }
  const def = FEDERATION_TOKENS[action.token];
  const fromShip = state.board.ships.find(
    (s) => s.federationToken === action.token && p.shuttles.some((sh) => sh.ship === s.id),
  );
  if (fromShip === undefined) {
    if ((state.board.federationTokens[action.token] ?? 0) <= 0 || (def.gleensOnly === true && p.faction !== 'gleens')) {
      throw new IllegalActionError('token-unavailable', `联邦标记不可拿: ${action.token}`);
    }
  }

  // 卫星费用。
  if (p.faction === 'ivits') {
    spendResources(p, { qic: action.satellites.length });
  } else if (action.powerFrom !== undefined) {
    discardPowerTokensFrom(p, action.powerFrom);
  } else {
    discardPowerTokens(p, action.satellites.length);
  }

  // 登记联邦（星球 + 卫星；Ivits 扩展时旧格已登记，跳过）。
  for (const h of sortedPlanets) {
    const hex = state.map[h]!;
    if (!hex.federations.includes(idx)) {
      hex.federations.push(idx);
    }
  }
  for (const h of sortedSatellites) {
    const hex = state.map[h]!;
    // satelliteOf 记录首个放置者（参考 federations[0]）；多方共用卫星格时保留。
    if (hex.satelliteOf === undefined) {
      hex.satelliteOf = idx;
    }
    hex.federations.push(idx);
    p.satellites += 1;
  }

  // 拿标记（绿面、立即得奖励；fedlf 即时效果转 pending）。
  // 注意：fed1（12vp）无绿面，参考 isGreen = token !== Fed1，落袋即灰面（flipped）。
  if (fromShip !== undefined) {
    fromShip.federationToken = null;
  } else {
    state.board.federationTokens[action.token] = state.board.federationTokens[action.token]! - 1;
  }
  p.federationTokens.push({ id: action.token, flipped: fromShip === undefined && action.token === 'fed1' });
  p.acquisitions.push({ kind: 'fed', id: action.token });
  const effect = applyFederationTokenReward(state, idx, action.token);
  onFederationFormed(state, idx);
  settlePendingAfter(state, idx, [], {
    freeMine: effect.freeMine ?? null,
    ...(effect.gainTechTile === true ? { gainTechTileFromShips: true } : {}),
  });
}
