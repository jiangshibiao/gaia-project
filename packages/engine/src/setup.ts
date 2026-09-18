/**
 * 开局（newGame）：地图生成、公共板块、玩家初始化、setup 队列。
 * 纯函数：同 config 逐字节确定（一切随机性来自 createRng(config.seed)）。
 *
 * Lost Fleet（config.lostFleet，默认 true）：
 * - 地图用 LF 布局（外圈错位 1 格 + Interspace 孔 + 深空三角板缺口），几何与
 *   内容数据集中在 data/lostfleet.ts（实证核定）；
 * - 板块池：回合计分 13 选 6、终局 9 选 2、高级板 21 选 6+扩展条第 7 槽、
 *   助推器 14 选 n+3；新标准板不混池（放飞船）；Economy 轨 L3/L4 覆盖板随机面；
 * - 飞船放上 Interspace 飞船格（2 人局不用 Rebellion）：科技槽船（Rebellion/
 *   T F Mars/Eclipse）各随机 1 块新标准板（3 种各 1，2 人局 2 块）、每船 1 枚
 *   金框联邦标记（8 种各 1，2 人局 3 枚），Twilight 放人数枚 Artifact（13 枚
 *   各不相同）；
 * - 种族微调：Ivits I2/II2、Bescods 3k、Lantids +1 power(I 区)；
 *   Moweyds 起始穿梭机在 T F Mars；Tinkeroids/Moweyds 抽 3 种 3 步星球【简化】。
 */
import { createRng, type Rng } from './rng.js';
import { IllegalActionError } from './errors.js';
import { buildMap, isValidMap } from './map.js';
import { hexDistance, hexKey, hexNeighbors, parseHexKey, type Hex, type HexKey } from './hex.js';
import type {
  AdvTechTileId,
  BoardState,
  BoosterId,
  FactionId,
  FederationTokenId,
  FinalTileId,
  GameConfig,
  GameState,
  HexState,
  PlayerIndex,
  PlayerState,
  ResearchTrack,
  ScoringTileId,
  SetupStage,
  ShipState,
  TechTileId,
} from './types.js';
import type { SetupPreset } from './types.js';
import { bigMapCenters, smallMapCenters, STANDARD_SECTORS_BIG, STANDARD_SECTORS_SMALL } from './data/maps.js';
import { ROUND_SCORING, FINAL_SCORING } from './data/scoring.js';
import { TECH_TILES, ADV_TECH_TILES } from './data/techs.js';
import { FEDERATION_TOKENS } from './data/federations.js';
import { BOOSTERS } from './data/boosters.js';
import { FACTIONS } from './data/factions.js';
import { RESEARCH_TRACKS } from './data/research.js';
import { HOME_PLANET_TYPES } from './data/planets.js';
import {
  artifactPool,
  lfDeepSpaceNotches,
  lfDeepSpaceTilePool,
  LF_INTERSPACE_FILL,
  lfHolePositions,
  lfShipsFor,
  lfStandardCenters,
  SHIP_TECH_SLOT_SHIPS,
  type DeepSpaceTileDef,
} from './data/lostfleet.js';

/** LF 4 个新种族（extra 阶段放置起始建筑）。 */
const LF_NEW_FACTIONS: readonly FactionId[] = [
  'tinkeroids',
  'darkanians',
  'moweyds',
  'space-giants',
];

/** 规则书设定：VP 轨从 10 分格开始（gaia-base-rules setup："place it on space 10 (10 VP) of the VP track"）。 */
const STARTING_VP = 10;

// ---------------------------------------------------------------------------
// newGame
// ---------------------------------------------------------------------------

export function newGame(config: GameConfig): GameState {
  validateConfig(config);
  const lostFleet = config.lostFleet ?? true;
  const rng = createRng(config.seed);
  const preset = config.preset;
  if (preset !== undefined && lostFleet && preset.lostFleet === undefined) {
    throw new IllegalActionError('preset-lost-fleet', 'Lost Fleet preset 需要 preset.lostFleet 部分');
  }

  // 1. 公共板块（先于地图：LF 地图需按终局板保证小行星数量）
  const board = preset !== undefined ? buildBoardFromPreset(preset) : buildBoard(rng, config.playerCount, lostFleet);

  // 2. 地图（LF：错位布局 + Interspace + 深空扇区 + 飞船初始放置）
  const map =
    preset !== undefined
      ? buildMapFromPreset(preset)
      : lostFleet
        ? generateLostFleetMap(rng, config.playerCount, board)
        : generateMap(rng, config.playerCount);

  // 3. 玩家（startingVp 缺省每人 STARTING_VP；竞拍出价扣减后的起始分在此落地）
  const startingVp = config.factions.map((_, i) => config.startingVp?.[i] ?? STARTING_VP);
  const players = config.factions.map((f, i) => initPlayer(f, lostFleet, startingVp[i]!));

  // 4. LF 设置：Tinkeroids/Moweyds 3 步星球（preset 给定，否则 rng 抽取【简化：
  // 纯随机，规则书抽块流程（含对手种族母星池）见 lost-fleet-rules p.7–8】）；
  // Moweyds 起始穿梭机在 T F Mars。
  if (lostFleet) {
    for (let i = 0; i < players.length; i++) {
      const def = FACTIONS[players[i]!.faction];
      if (def.terraformThreeStepRoll === true) {
        players[i]!.terraformThreeStep =
          preset?.lostFleet?.terraformThreeStep?.[players[i]!.faction] ??
          rng.shuffle([...HOME_PLANET_TYPES]).slice(0, 3);
      }
    }
    const moweydsSeat = config.factions.indexOf('moweyds');
    if (moweydsSeat >= 0) {
      const tfmars = board.ships.find((s) => s.id === 'tfmars');
      if (tfmars !== undefined) {
        tfmars.shuttleSlots[0] = moweydsSeat;
        players[moweydsSeat]!.shuttles.push({ ship: 'tfmars', slot: 0 });
        players[moweydsSeat]!.exploredShips.push('tfmars');
      }
    }
  }

  const turnOrder: PlayerIndex[] = players.map((_, i) => i);

  return {
    config: { playerCount: config.playerCount, seed: config.seed, factions: [...config.factions], lostFleet, startingVp },
    rngState: rng.getState(),
    round: 0, // setup 期间尚未进入第 1 轮
    phase: 'setup',
    setupStage: 'mines-1',
    setupQueue: [...turnOrder],
    turnOrder,
    // setup 期间以 setupQueue 队首为准；进入行动阶段后由 advanceSetup 置为 firstPlayer。
    currentPlayerIdx: 0,
    passedPlayers: [],
    firstPlayer: 0,
    map,
    players,
    board,
    pending: null,
    gaiaProjectsInProgress: [],
    gaiaPhaseQueue: [],
    winner: null,
    lastEvents: ['game-created'],
  };
}

function validateConfig(config: GameConfig): void {
  if (!Number.isInteger(config.playerCount) || config.playerCount < 1 || config.playerCount > 4) {
    throw new IllegalActionError('invalid-config', `playerCount 必须为 1–4 的整数: ${config.playerCount}`);
  }
  if (config.factions.length !== config.playerCount) {
    throw new IllegalActionError(
      'invalid-config',
      `factions 长度 ${config.factions.length} 与 playerCount ${config.playerCount} 不一致`,
    );
  }
  const seen = new Set<FactionId>();
  for (const f of config.factions) {
    if (FACTIONS[f] === undefined) {
      throw new IllegalActionError('invalid-config', `未知种族: ${f}`);
    }
    if (seen.has(f)) {
      throw new IllegalActionError('invalid-config', `种族重复: ${f}`);
    }
    seen.add(f);
  }
  if (config.startingVp !== undefined) {
    if (config.startingVp.length !== config.playerCount) {
      throw new IllegalActionError(
        'invalid-config',
        `startingVp 长度 ${config.startingVp.length} 与 playerCount ${config.playerCount} 不一致`,
      );
    }
    for (const vp of config.startingVp) {
      if (!Number.isInteger(vp) || vp < 0) {
        throw new IllegalActionError('invalid-config', `startingVp 须为非负整数: ${vp}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 地图生成
// ---------------------------------------------------------------------------

/** 按 preset 摆地图：标准扇区 buildMap 后，LF 追加 Interspace/深空格内容。 */
function buildMapFromPreset(preset: SetupPreset): Record<HexKey, HexState> {
  const map = buildMap(
    preset.map.sectors.map((s) => s.id),
    preset.map.sectors.map((s) => s.rotation),
    preset.map.sectors.map((s) => s.center),
  );
  const lf = preset.lostFleet;
  if (lf !== undefined) {
    for (const cell of lf.interspace) {
      map[cell.hex] = {
        planet: cell.planet,
        sector: 'interspace',
        deepSpace: false,
        federations: [],
        ...(cell.ship !== undefined ? { ship: cell.ship } : {}),
      };
    }
    for (const cell of lf.deepSpace) {
      map[cell.hex] = {
        planet: cell.planet,
        sector: String(cell.tile),
        deepSpace: true,
        federations: [],
      };
    }
  }
  return map;
}

/**
 * 标准布局地图生成（与 reference/gaia-engine/src/map.ts 的 generate/isValid
 * 循环同思路）：同一 rng 流驱动——扇区洗牌、各扇区 rotation=nextInt(6)、
 * 中心按 data/maps.ts 的中心序列；isValidMap 不通过则重洗重转直到通过。
 */
function generateMap(rng: Rng, playerCount: number): Record<HexKey, HexState> {
  const sectorPool = playerCount <= 2 ? STANDARD_SECTORS_SMALL : STANDARD_SECTORS_BIG;
  const centers = playerCount <= 2 ? smallMapCenters() : bigMapCenters();
  // 防御性上限：german 规则单次失败率很低，1000 次足够；超出视为 bug 而非死循环。
  for (let attempt = 0; attempt < 1000; attempt++) {
    const ids = rng.shuffle([...sectorPool]);
    const rotations = ids.map(() => rng.nextInt(6));
    const map = buildMap(ids, rotations, centers);
    if (isValidMap(map)) {
      return map;
    }
  }
  throw new Error('generateMap: 1000 次尝试仍未生成合法地图');
}

// ---------------------------------------------------------------------------
// LF 地图生成（几何与内容数据见 data/lostfleet.ts，实证核定）
// ---------------------------------------------------------------------------

/** LF 各人数的标准扇区池（2 人 05–07 B 面；3 人去 08；4 人 05–07 A 面）。 */
function lfSectorPool(playerCount: number): string[] {
  if (playerCount <= 2) {
    return ['1', '2', '3', '4', '5B', '6B', '7B'];
  }
  if (playerCount === 3) {
    return ['1', '2', '3', '4', '5B', '6B', '7B', '9', '10'];
  }
  return ['1', '2', '3', '4', '5A', '6A', '7A', '8', '9', '10'];
}

/** 两两间距满足约束的孔位子集（exact 时要求恰好相距 minDist）。 */
function shipHoleSubsets(holes: HexKey[], count: number, minDist: number, exact: boolean): HexKey[][] {
  const dist = (a: HexKey, b: HexKey): number => hexDistance(parseHexKey(a), parseHexKey(b));
  const ok = (a: HexKey, b: HexKey): boolean => (exact ? dist(a, b) === minDist : dist(a, b) >= minDist);
  const out: HexKey[][] = [];
  const pick = (start: number, cur: HexKey[]): void => {
    if (cur.length === count) {
      out.push([...cur]);
      return;
    }
    for (let i = start; i < holes.length; i++) {
      const h = holes[i]!;
      if (cur.every((c) => ok(c, h))) {
        cur.push(h);
        pick(i + 1, cur);
        cur.pop();
      }
    }
  };
  pick(0, []);
  return out;
}

/** 放置 Interspace（孔位 + 飞船 + board.ships 初始化）。 */
function placeInterspace(rng: Rng, playerCount: number, map: Record<HexKey, HexState>, board: BoardState): void {
  const holes = lfHolePositions(playerCount);
  const shipIds = rng.shuffle([...lfShipsFor(playerCount)]);
  // 飞船孔：2 人局交替（两两恰好 5 格）；3/4 人局两两 ≥3 格。
  const subsets =
    playerCount <= 2 ? shipHoleSubsets(holes, shipIds.length, 5, true) : shipHoleSubsets(holes, shipIds.length, 3, false);
  if (subsets.length === 0) {
    throw new Error(`placeInterspace: ${playerCount} 人局无可行飞船孔位（孔 ${holes.length}）`);
  }
  const shipHoles = new Set(subsets[rng.nextInt(subsets.length)]!);

  // 船上物资：科技槽船（Rebellion/T F Mars/Eclipse）各随机 1 块新标准板
  // （3 种各 1；2 人局 2 槽放 2 块）；每船 1 枚金框联邦标记（8 种各 1；
  // 2 人局 3 船共 3 枚）；Twilight 放人数枚 Artifact（13 枚各不相同）。
  // 剩余组件移出游戏（不进供应）。
  const techPool = rng.shuffle<TechTileId>(['techlf1', 'techlf2', 'techlf3']);
  const fedPool = rng.shuffle(
    (Object.keys(FEDERATION_TOKENS) as FederationTokenId[]).filter((id) => FEDERATION_TOKENS[id].lostFleet === true),
  );
  const artPool = rng.shuffle(artifactPool());
  const holeList = [...shipHoles];
  let techCursor = 0;
  board.ships = shipIds.map((id, i): ShipState => {
    return {
      id,
      hex: holeList[i]!,
      techTiles: SHIP_TECH_SLOT_SHIPS.includes(id) && techCursor < techPool.length ? [techPool[techCursor++]!] : [],
      techTileClaims: [],
      federationToken: fedPool[i] ?? null,
      artifacts: id === 'twilight' ? artPool.slice(0, playerCount) : [],
      shuttleSlots: [null, null, null, null],
    };
  });

  // 非飞船孔内容（构成见 data/lostfleet.ts LF_INTERSPACE_FILL）。
  const fillKey = playerCount <= 2 ? 2 : playerCount === 3 ? 3 : 4;
  const fill = rng.shuffle([...LF_INTERSPACE_FILL[fillKey]!]);
  let fi = 0;
  for (const hole of holes) {
    if (shipHoles.has(hole)) {
      const ship = board.ships.find((s) => s.hex === hole)!;
      map[hole] = { planet: 'empty', sector: 'interspace', deepSpace: false, federations: [], ship: ship.id };
    } else {
      map[hole] = {
        planet: fill[fi++] ?? 'empty',
        sector: 'interspace',
        deepSpace: false,
        federations: [],
      };
    }
  }
}

/** 一次深空三角板放置（缺口 + 板 + 面 + 旋转）。 */
interface DeepSpacePlacement {
  notch: Hex[];
  tile: DeepSpaceTileDef;
  face: 'a' | 'b';
  /** 面内容在三角格上的循环位移（三角板 3 重旋转对称，0–2）。 */
  rotation: number;
}

/** 把一次深空放置写进地图（planet 字段；格须已存在或新建由 create 控制）。 */
function layDeepSpaceTile(
  map: Record<HexKey, HexState>,
  p: DeepSpacePlacement,
  create: boolean,
): void {
  const face = p.tile[p.face];
  p.notch.forEach((cell, j) => {
    const content = face[(j + p.rotation) % 3]!;
    const k = hexKey(cell);
    if (create) {
      if (map[k] !== undefined) {
        throw new Error(`layDeepSpaceTile: 坐标重叠 ${k}（深空板 ${p.tile.id}）——几何数据错误`);
      }
      map[k] = { planet: content, sector: String(p.tile.id), deepSpace: true, federations: [] };
    } else {
      map[k]!.planet = content;
    }
  });
}

/** 铺深空三角板（缺口几何 + 板/面/旋转随机；sector=板号、deepSpace=true）。 */
function placeDeepSpace(rng: Rng, playerCount: number, map: Record<HexKey, HexState>, board: BoardState): void {
  const notches = lfDeepSpaceNotches(playerCount);
  const tiles = rng.shuffle(lfDeepSpaceTilePool(playerCount));
  const placements: DeepSpacePlacement[] = notches.map((notch, i) => ({
    notch,
    tile: tiles[i]!,
    face: rng.nextInt(2) === 0 ? 'a' : 'b',
    rotation: rng.nextInt(3),
  }));
  for (const p of placements) {
    layDeepSpaceTile(map, p, true);
  }
  // 终局板含"最多小行星"且全图 <6 个小行星时：强制 16 号板用 b 面
  // （规则书为翻 Deep Space Sector 16 号板；b 面 2 个小行星）。
  if (board.finalScoring.includes('asteroid')) {
    const asteroids = Object.values(map).filter((h) => h.planet === 'asteroid').length;
    if (asteroids < 6) {
      const p16 = placements.find((p) => p.tile.id === 16)!;
      if (p16.face !== 'b') {
        p16.face = 'b';
        layDeepSpaceTile(map, p16, false);
      }
    }
  }
}

/** LF 布局地图生成：标准扇区洗牌/旋转 → Interspace → 深空 → isValidMap 重试。 */
function generateLostFleetMap(rng: Rng, playerCount: number, board: BoardState): Record<HexKey, HexState> {
  const { core, outer } = lfStandardCenters(playerCount);
  const centers = [...core, ...outer];
  const pool = lfSectorPool(playerCount);
  for (let attempt = 0; attempt < 1000; attempt++) {
    // 中心扇区从 01–04 抽（规则书），其余洗牌；各扇区随机旋转。
    const coreIds = rng.shuffle(['1', '2', '3', '4']).slice(0, core.length);
    const restIds = rng.shuffle(pool.filter((id) => !coreIds.includes(id)));
    const ids = [...coreIds, ...restIds];
    const rotations = ids.map(() => rng.nextInt(6));
    const map = buildMap(ids, rotations, centers);
    placeInterspace(rng, playerCount, map, board);
    placeDeepSpace(rng, playerCount, map, board);
    if (isValidMap(map)) {
      return map;
    }
  }
  throw new Error('generateLostFleetMap: 1000 次尝试仍未生成合法地图');
}

// ---------------------------------------------------------------------------
// 公共板块
// ---------------------------------------------------------------------------

/**
 * 按 preset 摆公共板块（不消耗 rng；供应计数与 buildBoard 基础局分支一致）。
 * 注：参考引擎科技板供应数 = 人数（3 人局 ×3），本引擎为每种 ×4；
 * 每名玩家同种板至多持 1 块，供应差永不影响合法性，对拍不比较该计数。
 */
function buildBoardFromPreset(preset: SetupPreset): BoardState {
  const techTiles: Record<string, number> = {};
  for (const t of Object.values(TECH_TILES)) {
    if (!t.lostFleet) {
      techTiles[t.id] = t.count;
    }
  }
  const federationTokens: Record<string, number> = {};
  for (const t of Object.values(FEDERATION_TOKENS)) {
    if (!t.lostFleet) {
      federationTokens[t.id] = t.count;
    }
  }
  federationTokens[preset.terraformingL5Token] = federationTokens[preset.terraformingL5Token]! - 1;
  return {
    roundScoring: [...preset.roundScoring],
    finalScoring: [...preset.finalScoring],
    techTiles,
    techTilePositions: { ...preset.techTilePositions },
    advTechTiles: [...preset.advTechTiles],
    federationTokens,
    terraformingL5Token: preset.terraformingL5Token,
    boosters: [...preset.boosters],
    boardActionsUsed: [],
    shipActionsUsed: [],
    researchLevel5: {},
    economyOverlay: preset.lostFleet?.economyOverlay ?? null,
    scoringExtension: preset.lostFleet?.scoringExtension ?? null,
    ships:
      preset.lostFleet?.ships.map(
        (s): ShipState => ({
          id: s.id,
          hex: s.hex,
          techTiles: s.techTile !== null ? [s.techTile] : [],
          techTileClaims: [],
          federationToken: s.federationToken,
          artifacts: s.artifacts.map((id) => ({ id })),
          shuttleSlots: [null, null, null, null],
        }),
      ) ?? [],
  };
}

function buildBoard(rng: Rng, playerCount: number, lostFleet: boolean): BoardState {
  // 回合计分：基础池 10 选 6；lostFleet 时混入 3 张 LF 池共 13 选 6。
  const roundPool = Object.values(ROUND_SCORING)
    .filter((t) => lostFleet || !t.lostFleet)
    .map((t) => t.id as ScoringTileId);
  const roundScoring = rng.shuffle(roundPool).slice(0, 6);

  // 终局计分：基础 6 选 2；LF 混入 3 张共 9 选 2（"星球类型"符号组件按扩展
  // 规则换修订版——本引擎殖民计数本就含 gaia/lost/asteroid/proto，无需换数据）。
  const finalPool = Object.values(FINAL_SCORING)
    .filter((t) => lostFleet || !t.lostFleet)
    .map((t) => t.id as FinalTileId);
  const finalScoring = rng.shuffle(finalPool).slice(0, 2);

  // 标准科技板供应：9 种 × 4（LF 船上标准板不混池，见 data/techs.ts）。
  const techTiles: Record<string, number> = {};
  for (const t of Object.values(TECH_TILES)) {
    if (!t.lostFleet) {
      techTiles[t.id] = t.count;
    }
  }
  // 9 块标准板洗入 9 个位置（6 条轨正下方 + 底排 3 块；参照 reference engine.ts：
  // TechTile.values 洗入 TechTilePos.values）。位置决定拿板后可升哪条轨。
  const stdPool = Object.values(TECH_TILES)
    .filter((t) => !t.lostFleet)
    .map((t) => t.id);
  const shuffledStd = rng.shuffle(stdPool);
  const techTilePositions = {} as BoardState['techTilePositions'];
  const positions = ['terra', 'nav', 'int', 'gaia', 'eco', 'sci', 'free1', 'free2', 'free3'] as const;
  positions.forEach((pos, i) => {
    techTilePositions[pos] = shuffledStd[i]!;
  });

  // 高级科技板：基础 15 选 6；LF 混入 6 种共 21 选 6 + 计分板扩展条第 7 槽
  // （第 7 槽条件：2 人局 ≥25vp；3–4 人局已探索 3 船，见 tech.ts advSlotAvailable）。
  const advPool = Object.values(ADV_TECH_TILES)
    .filter((t) => lostFleet || !t.lostFleet)
    .map((t) => t.id as AdvTechTileId);
  const advTechTiles = rng.shuffle(advPool).slice(0, lostFleet ? 7 : 6);

  // 联邦标记供应：基础 6 种 ×3 + gleens ×1（LF 金框标记放飞船，见文件头 TODO）。
  const federationTokens: Record<string, number> = {};
  for (const t of Object.values(FEDERATION_TOKENS)) {
    if (!t.lostFleet) {
      federationTokens[t.id] = t.count;
    }
  }
  // 随机 1 枚非 gleens 联邦标记放 Terraforming L5 预设位（从供应扣掉）。
  // 各候选 count 相同（×3），按 id 均匀抽等同于按枚均匀抽。
  const l5Candidates = Object.keys(federationTokens).filter(
    (id) => id !== 'gleens' && federationTokens[id]! > 0,
  );
  const l5Token = l5Candidates[rng.nextInt(l5Candidates.length)] as FederationTokenId;
  federationTokens[l5Token] = federationTokens[l5Token]! - 1;

  // 回合助推器：抽 playerCount+3 块；lostFleet 时 4 块 LF 助推器洗入池（扩展组件规则）。
  const boosterPool = Object.values(BOOSTERS)
    .filter((t) => lostFleet || !t.lostFleet)
    .map((t) => t.id as BoosterId);
  const boosters = rng.shuffle(boosterPool).slice(0, playerCount + 3);

  return {
    roundScoring,
    finalScoring,
    techTiles,
    techTilePositions,
    advTechTiles,
    federationTokens,
    terraformingL5Token: l5Token,
    boosters,
    boardActionsUsed: [],
    shipActionsUsed: [],
    researchLevel5: {},
    // LF：Economy 轨 L3/L4 覆盖板随机选面（覆盖面值见 data/lostfleet.ts ECONOMY_OVERLAY）。
    economyOverlay: lostFleet ? (rng.nextInt(2) === 0 ? 'pw' : 'vp') : null,
    // LF：计分板扩展条面（§E6：2 人局固定 'vp'；3–4 人局 50/50 随机）。
    scoringExtension: lostFleet ? (playerCount <= 2 || rng.nextInt(2) === 0 ? 'vp' : 'ships') : null,
    ships: [], // LF 飞船由 generateLostFleetMap 放置（含船上板/标记/Artifact）
  };
}

// ---------------------------------------------------------------------------
// 玩家初始化
// ---------------------------------------------------------------------------

function initPlayer(faction: FactionId, lostFleet: boolean, startingVp: number = STARTING_VP): PlayerState {
  const def = FACTIONS[faction];
  const resources = { ...def.startingResources };
  const power = {
    bowl1: def.startingPower.bowl1,
    bowl2: def.startingPower.bowl2,
    bowl3: 0,
    gaia: 0,
    brainstone: (def.startingPower.brainstone ?? 'none') as PlayerState['power']['brainstone'],
  };

  const research: Record<ResearchTrack, number> = { terra: 0, nav: 0, int: 0, gaia: 0, eco: 0, sci: 0 };
  const gaiaformers = { total: 0, available: 0, lost: 0, inGaia: 0 };
  let vp = startingVp;

  // 起始研究轨 L1（darkanians 两条）：星标一次性奖励立即获得（eco/sci L1 是收入，once 为空不获得）。
  const startingTracks = [def.startingResearch, def.startingResearch2].filter(
    (t): t is ResearchTrack => t !== null && t !== undefined,
  );
  for (const track of startingTracks) {
    research[track] = 1;
    const once = RESEARCH_TRACKS[track].levels[0]?.once;
    if (once !== undefined) {
      resources.ore += once.ore ?? 0;
      resources.credits += once.credits ?? 0;
      resources.knowledge += once.knowledge ?? 0;
      vp += once.vp ?? 0;
      const qic = once.qic ?? 0;
      if (faction === 'gleens') {
        // Gleens 能力：获得 QIC 改为获得等量 ore（建 QIC 学院前生效）。
        resources.ore += qic;
      } else {
        resources.qic += qic;
      }
      const gf = once.gaiaformer ?? 0;
      gaiaformers.total += gf;
      gaiaformers.available += gf;
      // L1 星标无 chargePower/powerToken（见 data/research.ts），无需处理。
    }
  }

  return {
    faction,
    resources,
    power,
    vp,
    research,
    techTiles: [],
    advTechTiles: [],
    federationTokens: [],
    buildings: { mine: 8, ts: 4, lab: 3, pi: 1, ac1: 1, ac2: 1 },
    gaiaformers,
    booster: null,
    specialUsed: [],
    roundAbilityUsed: [],
    colonizedPlanetTypes: [],
    colonizedSectors: [],
    satellites: 0,
    spaceStations: 0,
    lostPlanetPlaced: false,
    shuttles: [],
    artifacts: [],
    terraformThreeStep: [],
    tinkering:
      faction === 'tinkeroids'
        ? { current: null, pool: ['tink1', 'tink2', 'tink3', 'tink4', 'tink5', 'tink6'] }
        : { current: null, pool: [] },
    powerRings: faction === 'moweyds' ? 6 : 0,
    geodensTriggered: [],
    darkaniansTriggered: [],
    exploredShips: [],
    powerStats: { gained: 0, discarded: 0 },
  };
}

// ---------------------------------------------------------------------------
// setup 队列推进
// ---------------------------------------------------------------------------

const SETUP_STAGE_ORDER: readonly SetupStage[] = ['mines-1', 'mines-2', 'extra', 'boosters'];

/** 某阶段的放置/选择队列（玩家座位顺序）。 */
function setupQueueFor(state: GameState, stage: SetupStage): PlayerIndex[] {
  const order = state.turnOrder;
  switch (stage) {
    case 'mines-1':
      return [...order];
    case 'mines-2':
      return [...order].reverse();
    case 'extra': {
      // Xenos 第 3 矿（正序）→ LF 新种族起始建筑（正序）→ Ivits PI（正序）。
      const factionOf = (p: PlayerIndex): FactionId => state.players[p]!.faction;
      const xenos = order.filter((p) => factionOf(p) === 'xenos');
      const lfNew = order.filter((p) => (LF_NEW_FACTIONS as readonly string[]).includes(factionOf(p)));
      const ivits = order.filter((p) => factionOf(p) === 'ivits');
      return [...xenos, ...lfNew, ...ivits];
    }
    case 'boosters':
      return [...order].reverse();
  }
}

/**
 * setup 状态推进 helper：当前队首玩家的放置/选择已被行动系统应用后调用。
 * 弹出队首；队列空时切到下一阶段（空队列阶段自动跳过）；
 * boosters 完成后进入行动阶段（phase='action'、round=1、currentPlayer=firstPlayer）。
 * 进入行动阶段时的第 1 轮收入/盖亚结算由 apply 层接入（turn.ts settleRoundStart）。
 *
 * 纯函数版：不修改入参（行动系统 apply 层用原地修改版 advanceSetupInPlace）。
 */
export function advanceSetup(state: GameState): GameState {
  if (state.phase !== 'setup' || state.setupStage === null) {
    throw new IllegalActionError('not-in-setup', '当前不在 setup 阶段');
  }
  const next: GameState = { ...state };
  advanceSetupInPlace(next);
  return next;
}

/**
 * advanceSetup 的原地修改版（apply 层在已克隆的状态上使用）。
 * 只通过字段整体替换推进（setupQueue/lastEvents 重建新数组，不原地改旧数组），
 * 因此对 {...state} 浅拷贝调用是安全的。
 */
export function advanceSetupInPlace(state: GameState): void {
  if (state.phase !== 'setup' || state.setupStage === null) {
    throw new IllegalActionError('not-in-setup', '当前不在 setup 阶段');
  }
  state.setupQueue = state.setupQueue.slice(1);
  while (state.setupStage !== null && state.setupQueue.length === 0) {
    const idx = SETUP_STAGE_ORDER.indexOf(state.setupStage);
    const stage = SETUP_STAGE_ORDER[idx + 1];
    if (stage === undefined) {
      // boosters 完成 → 进入第 1 轮行动阶段（收入/盖亚结算由 apply 层接入）。
      state.phase = 'action';
      state.setupStage = null;
      state.round = 1;
      state.currentPlayerIdx = state.firstPlayer;
      state.lastEvents = [...state.lastEvents, 'setup-complete'];
      break;
    }
    state.setupStage = stage;
    state.setupQueue = setupQueueFor(state, stage);
  }
}
