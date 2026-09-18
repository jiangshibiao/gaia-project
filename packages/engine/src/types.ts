/**
 * 盖亚计划引擎核心类型。
 * 所有状态均为 plain JSON（无 class、无方法），保证 stableStringify 可重放。
 */
import type { Hex, HexKey } from './hex.js';

// ---------------------------------------------------------------------------
// 枚举
// ---------------------------------------------------------------------------

/** 星球类型。7 种母星 + gaia + transdim + lost + Lost Fleet 的 asteroid/proto。 */
export type PlanetType =
  | 'terra'
  | 'desert'
  | 'swamp'
  | 'oxide'
  | 'volcanic'
  | 'titanium'
  | 'ice'
  | 'gaia'
  | 'transdim'
  | 'lost'
  | 'asteroid'
  | 'proto'
  | 'empty';

/** 7 种母星类型（terraform 环上的类型）。 */
export type HomePlanetType =
  | 'terra'
  | 'desert'
  | 'swamp'
  | 'oxide'
  | 'volcanic'
  | 'titanium'
  | 'ice';

export type BuildingType = 'mine' | 'ts' | 'lab' | 'pi' | 'ac1' | 'ac2' | 'gf' | 'sp';

export type ResearchTrack = 'terra' | 'nav' | 'int' | 'gaia' | 'eco' | 'sci';

export type FactionId =
  // 基础 14 族
  | 'terrans'
  | 'lantids'
  | 'xenos'
  | 'gleens'
  | 'taklons'
  | 'ambas'
  | 'hadsch-hallas'
  | 'ivits'
  | 'geodens'
  | 'baltaks'
  | 'firaks'
  | 'bescods'
  | 'nevlas'
  | 'itars'
  // Lost Fleet 4 族
  | 'tinkeroids'
  | 'darkanians'
  | 'moweyds'
  | 'space-giants';

export type PlayerIndex = number; // 0..playerCount-1

/** 科技板（标准 9 种 + Lost Fleet 飞船新标准板 3 种）。 */
export type TechTileId =
  | 'tech1'
  | 'tech2'
  | 'tech3'
  | 'tech4'
  | 'tech5'
  | 'tech6'
  | 'tech7'
  | 'tech8'
  | 'tech9'
  // Lost Fleet 飞船新标准板（3 种各 1 块）
  | 'techlf1' // 免费建矿（最多 2 免费步）
  | 'techlf2' // 基本射程 +1
  | 'techlf3'; // 一次性 +1o+3k

/** 高级科技板（15 种 + Lost Fleet 6 种各 1）。 */
export type AdvTechTileId =
  | 'advtech1'
  | 'advtech2'
  | 'advtech3'
  | 'advtech4'
  | 'advtech5'
  | 'advtech6'
  | 'advtech7'
  | 'advtech8'
  | 'advtech9'
  | 'advtech10'
  | 'advtech11'
  | 'advtech12'
  | 'advtech13'
  | 'advtech14'
  | 'advtech15'
  | 'advtechlf1' // big：一次性每 PI/学院 +6vp
  | 'advtechlf2' // deep：一次性每深空扇区 +4vp
  | 'advtechlf3' // asteroidpass：Pass 时每小行星 +2vp
  | 'advtechlf4' // deeppass：Pass 时每深空扇区 +2vp
  | 'advtechlf5' // qaction：每次 Q.I.C. 行动 +4vp（触发器）
  | 'advtechlf6'; // terra：每次 terraform 步 +2vp（含免费步；触发器）

/** 联邦标记。fed1..fed6 基础 6 种 + gleens 专属 + Lost Fleet 金框 8 种（各 1 枚）。 */
export type FederationTokenId =
  | 'fed1' // 12vp（双面灰，不可翻）
  | 'fed2' // 8vp+1q
  | 'fed3' // 8vp+2 power tokens
  | 'fed4' // 7vp+2o
  | 'fed5' // 7vp+6c
  | 'fed6' // 6vp+2k
  | 'gleens' // 1o+1k+2c（Gleens 专属）
  | 'fedlf1' // 12vp（有绿面，可翻）
  | 'fedlf2' // 立即拿 1 科技板
  | 'fedlf3' // 免费建矿（无限射程，费用照付）
  | 'fedlf4' // 免费建矿（3 免费 terraform 步，可加程）
  | 'fedlf5' // 8vp+8c
  | 'fedlf6' // 4vp+4k
  | 'fedlf7' // 4vp+2o+1q
  | 'fedlf8'; // 7vp+2 power token 直接 III 区

/** 回合计分板（10 基础 + 3 LF）。 */
export type ScoringTileId =
  | 'score1'
  | 'score2'
  | 'score3'
  | 'score4'
  | 'score5'
  | 'score6'
  | 'score7'
  | 'score8'
  | 'score9'
  | 'score10'
  | 'scorelf1'
  | 'scorelf2'
  | 'scorelf3';

/** 终局计分板（6 基础 + 3 LF）。 */
export type FinalTileId =
  | 'structure'
  | 'structureFed'
  | 'planetType'
  | 'gaia'
  | 'sector'
  | 'satellite'
  | 'asteroid'
  | 'deepSpace'
  | 'piAcademyDistance';

/** 回合助推器（10 基础 + 4 LF）。 */
export type BoosterId =
  | 'booster1'
  | 'booster2'
  | 'booster3'
  | 'booster4'
  | 'booster5'
  | 'booster6'
  | 'booster7'
  | 'booster8'
  | 'booster9'
  | 'booster10'
  | 'boosterlf1'
  | 'boosterlf2'
  | 'boosterlf3'
  | 'boosterlf4';

/** 研究板上的 power / qic 行动格。 */
export type BoardActionId =
  | 'power1' // 7pw→3k
  | 'power2' // 5pw→建矿(2 免费步)
  | 'power3' // 4pw→2o
  | 'power4' // 4pw→7c
  | 'power5' // 4pw→2k
  | 'power6' // 3pw→建矿(1 免费步)
  | 'power7' // 3pw→+2 power tokens
  | 'qic1' // 4q→拿科技板
  | 'qic2' // 3q→重结算联邦标记
  | 'qic3'; // 2q→3vp+每星球类型 1vp

/** 特殊行动（来自科技板/助推器/种族）。id 即来源。 */
export type SpecialActionId =
  | 'tech9' // 充能 4pw
  | 'advtech3' // +1q+5c
  | 'advtech11' // +3o
  | 'advtech13' // +3k
  | 'booster4' // 建矿(1 免费步)
  | 'booster5' // 建矿/盖亚计划 基本射程+3
  | 'boosterlf4' // 免费立即盖亚计划
  | 'ac2' // QIC 学院：+1q（baltaks 为 +4c）
  | 'ivits-sp' // Ivits PI：放空间站
  | 'ambas-swap' // Ambas PI：交换 PI 与 mine
  | 'firaks-down' // Firaks PI：lab 降级推进研究
  | 'bescods-up' // Bescods：推进最低轨
  | 'gleens-range' // LF Gleens 探索板：射程+2
  | 'moweyds-ring' // Moweyds PI：放 Power Ring
  | 'tinkeroids-tile' // Tinkeroids PI：使用当前 Tinkering tile
  | 'space-giants-mine'; // Space Giants 探索板：建矿(2 免费步)

/** 标准科技板在研究板上的位置（6 条轨正下方 + 底排 3 块；开局洗入，见 setup）。 */
export type TechTilePosition = ResearchTrack | 'free1' | 'free2' | 'free3';

/** Lost Fleet 飞船。 */
export type ShipId = 'twilight' | 'rebellion' | 'tfmars' | 'eclipse';

/** 飞船行动格（效果语义 id；费用与效果见 data/prices.ts SHIP_ACTIONS）。 */
export type ShipActionId =
  | 'ship-rescore-fed' // Twilight 3q→重触发已有联邦标记（含即时效果）
  | 'ship-upgrade-ts-lab' // Twilight 3pw+2o→免费升 ts→lab
  | 'ship-range3' // Twilight 1k→+3 射程
  | 'ship-tech-tile' // Rebellion 3q→拿 1 科技板（可拿船上）
  | 'ship-upgrade-mine-ts' // Rebellion 3pw+1o→免费升 mine→ts
  | 'ship-2c1q' // Rebellion 2k→+2c+1q
  | 'ship-vp-per-tech' // T F Mars 2q→2vp+每标准科技板 1vp
  | 'ship-instant-gaia' // T F Mars 2pw→立即盖亚转化
  | 'ship-terraform-step' // T F Mars 3c→1 个 terraform 步建矿（矿费与后续步照付）
  | 'ship-vp-per-planet' // Eclipse 2q→2vp+每星球类型 1vp
  | 'ship-research' // Eclipse 3pw+2k→任意轨升 1 级
  | 'ship-asteroid-mine'; // Eclipse 6c→范围内小行星免费建矿（不耗 gaiaformer）

/** Artifact（Twilight 飞船，13 枚各不相同）。 */
export type ArtifactId =
  | 'art-1k1o' // 收入 +1k+1o
  | 'art-3c3o' // 一次性 +3c+3o
  | 'art-3k1q' // 一次性 +3k+1q
  | 'art-5c2o' // 一次性 +5c+2o
  | 'art-asteroid' // +7vp，视作无扇区小行星上的 1 矿
  | 'art-proto' // +7vp，视作无扇区原行星上的 1 矿（不得 proto 6vp）
  | 'art-sci' // Science 轨每级 +3vp
  | 'art-gaia' // Gaiaforming 轨每级 +3vp
  | 'art-track' // 每条 ≥L3 轨 +3vp
  | 'art-planet' // +3vp + 每已殖民星球类型 +1vp
  | 'art-deep' // 每已殖民深空扇区 +3vp（Lost Planet 计入）
  | 'art-fed' // 重新触发 1 枚已有联邦标记
  | 'art-pwt'; // 收入 2 power token 直接 III 区

/** Tinkering tile（Tinkeroids）。 */
export type TinkeringTileId = 'tink1' | 'tink2' | 'tink3' | 'tink4' | 'tink5' | 'tink6';

/** Artifact 实例（13 种各不相同，无品种参数）。 */
export interface ArtifactState {
  id: ArtifactId;
}

/** 免费建矿待决选项（fedlf3/fedlf4/techlf1/ship-asteroid-mine 等来源）。 */
export interface FreeMineOptions {
  /** 前 N 步 terraform 免费。 */
  freeTerraformSteps?: number;
  /** 免矿费 1o+2c（fedlf3/fedlf4/techlf1；asteroid 本就免矿费）。 */
  waiveMineCost?: boolean;
  /** 无限射程（fedlf3；仍付 terraform 与 Gaia 居住费）。 */
  unlimitedRange?: boolean;
  /** 小行星免 gaiaformer（ship-asteroid-mine）。 */
  asteroidNoGaiaformer?: boolean;
}

// ---------------------------------------------------------------------------
// 资源
// ---------------------------------------------------------------------------

export interface Resources {
  ore: number;
  credits: number;
  knowledge: number;
  qic: number;
}

/** power 三区 + gaia 区。brainstone 单独记录位置（taklons）。 */
export interface PowerState {
  bowl1: number;
  bowl2: number;
  bowl3: number;
  gaia: number;
  /** brainstone 所在区（仅 taklons）；'none' 表示无 brainstone */
  brainstone: 'bowl1' | 'bowl2' | 'bowl3' | 'gaia' | 'none';
}

// ---------------------------------------------------------------------------
// 地图
// ---------------------------------------------------------------------------

export interface HexBuilding {
  type: BuildingType;
  player: PlayerIndex;
}

export interface HexState {
  planet: PlanetType;
  /** 扇区编号（'1'..'10'、深空 '11'..'16'、'interspace'、'none'）。 */
  sector: string;
  /** 是否深空扇区（终局计分/新种族用）。 */
  deepSpace: boolean;
  building?: HexBuilding;
  /** Lantids 在对手星球上的附加矿。 */
  additionalMine?: PlayerIndex;
  /** 盖亚计划完成后留置在星球上的 gaiaformer 所属。 */
  gaiaformerOf?: PlayerIndex;
  /** 卫星所属（每格每色最多 1 颗）。 */
  satelliteOf?: PlayerIndex;
  /** 该格已属于哪些玩家的联邦。 */
  federations: PlayerIndex[];
  /** Moweyds 的 Power Ring。 */
  powerRing?: boolean;
  /** Lost Fleet 飞船格。 */
  ship?: ShipId;
  /** Tinkeroids/Moweyds 的 3 步 terraform 标记由种族数据决定，不在 hex 上。 */
}

// ---------------------------------------------------------------------------
// 玩家
// ---------------------------------------------------------------------------

/** 玩家面板上剩余建筑（=还没放到地图上的）。收入由"已移除数量"推导。 */
export interface BuildingSupply {
  mine: number; // 8
  ts: number; // 4
  lab: number; // 3
  pi: number; // 1
  ac1: number; // 1
  ac2: number; // 1
}

export interface GaiaformerState {
  /** 已解锁总数（gaia 轨 L1/L3/L4 各 +1）。 */
  total: number;
  /** 面板上可用的。 */
  available: number;
  /** 报废于小行星的。 */
  lost: number;
  /** Bal T'aks 免费行动暂存在 Gaia 区的 gaiaformer 数（下轮盖亚阶段返回面板）。 */
  inGaia: number;
}

export interface FederationTokenState {
  id: FederationTokenId;
  /** 绿面朝上=false；翻到灰面=true。 */
  flipped: boolean;
  /** 来自 Terraforming 轨 L5 预设位（ivits 扩展联邦计数时排除）。 */
  fromTerraformingL5?: boolean;
}

export interface PlayerState {
  faction: FactionId;
  resources: Resources;
  power: PowerState;
  vp: number;
  research: Record<ResearchTrack, number>; // 0..5
  /** 已持有科技板（标准 + 船上新标准板）。 */
  techTiles: TechTileId[];
  /** 高级科技板（覆盖在某块标准板上）。 */
  advTechTiles: { id: AdvTechTileId; covers: TechTileId }[];
  federationTokens: FederationTokenState[];
  buildings: BuildingSupply;
  gaiaformers: GaiaformerState;
  booster: BoosterId | null;
  /** 本轮已用的特殊行动。 */
  specialUsed: SpecialActionId[];
  /** 本轮已做的每轮一次能力（ambas-swap/bescods-up/moweyds-ring/tinkeroids-tile 等）。 */
  roundAbilityUsed: string[];
  /** 已殖民计数（终局/板块计分用，随行动增量维护）。 */
  colonizedPlanetTypes: PlanetType[];
  colonizedSectors: string[];
  /** 已放卫星总数。 */
  satellites: number;
  /** Ivits 空间站数（算卫星终局计分）。 */
  spaceStations: number;
  /** Lost Planet 是否已放置。 */
  lostPlanetPlaced: boolean;
  /** --- Lost Fleet --- */
  shuttles: { ship: ShipId; slot: number }[];
  artifacts: ArtifactState[];
  /** Tinkeroids/Moweyds：需 3 terraform 步的 3 种基础星球（setup 时 rng 抽取【简化】）。 */
  terraformThreeStep: HomePlanetType[];
  /** Tinkeroids：本轮选择的 tinkering tile 与剩余池。 */
  tinkering: { current: TinkeringTileId | null; pool: TinkeringTileId[] };
  /** Moweyds：剩余 Power Ring 数。 */
  powerRings: number;
  /** Geodens：已触发 +3k 的星球类型。 */
  geodensTriggered: PlanetType[];
  /** Darkanians：已触发 +2c+1k 的扇区。 */
  darkaniansTriggered: string[];
  /** 已探索的飞船（计分板扩展条条件）。 */
  exploredShips: ShipId[];
  /** power token 获得/弃置累计（fuzz 守恒校验用；burn 弃置计入 discarded，itars 入 gaia 区不算弃置）。 */
  powerStats: { gained: number; discarded: number };
}

// ---------------------------------------------------------------------------
// 公共板块
// ---------------------------------------------------------------------------

export interface ShipState {
  id: ShipId;
  hex: HexKey;
  techTiles: TechTileId[];
  /** 已拿过该船科技板的玩家（每人至多 1 块；全员拿过后板从船上移除——参考引擎 count 模型）。 */
  techTileClaims: PlayerIndex[];
  federationToken: FederationTokenId | null;
  artifacts: ArtifactState[];
  /** 编号穿梭机位（index 即编号），null=空位。 */
  shuttleSlots: (PlayerIndex | null)[];
}

export interface BoardState {
  roundScoring: ScoringTileId[]; // 6 张，按轮
  finalScoring: FinalTileId[]; // 2 张
  /** 标准科技板供应（id → 剩余块数）。 */
  techTiles: Record<string, number>;
  /** 标准科技板在研究板上的位置（开局洗入；拿板升轨规则依赖位置）。 */
  techTilePositions: Record<TechTilePosition, TechTileId>;
  /** 高级科技板槽位（6 + LF 第 7 槽），null=已被拿。 */
  advTechTiles: (AdvTechTileId | null)[];
  /** 联邦标记供应（id → 剩余枚数）。 */
  federationTokens: Record<string, number>;
  /** Terraforming 轨 L5 预设的联邦标记。 */
  terraformingL5Token: FederationTokenId | null;
  /** 可供选择的回合助推器。 */
  boosters: BoosterId[];
  /** 本轮已用的研究板行动格。 */
  boardActionsUsed: BoardActionId[];
  /** 本轮已用的飞船行动格（shipId:actionId）。 */
  shipActionsUsed: string[];
  /** 每轨已达 L5 的玩家（每轨仅 1 人）。 */
  researchLevel5: Partial<Record<ResearchTrack, PlayerIndex>>;
  /** LF：Economy 轨 L3/L4 覆盖板的随机面（null = 基础游戏无覆盖板）。 */
  economyOverlay: 'pw' | 'vp' | null;
  /**
   * LF：计分板扩展条（第 7 高级板槽）面（null = 基础游戏无扩展条）。
   * 'vp' = ≥25vp 条件；'ships' = 已探索 3 艘飞船条件（§E6：2 人局固定 'vp'，3–4 人局随机）。
   */
  scoringExtension: 'vp' | 'ships' | null;
  /** Lost Fleet 飞船。 */
  ships: ShipState[];
}

// ---------------------------------------------------------------------------
// 待决决策
// ---------------------------------------------------------------------------

/** 一次被动充能邀约。 */
export interface ChargeOffer {
  player: PlayerIndex;
  /** 可充能量（=范围内最高 power value 建筑）。 */
  amount: number;
  /** 对应 VP 代价（amount-1）。 */
  vpCost: number;
}

export type PendingDecision =
  | { kind: 'charge'; queue: ChargeOffer[] }
  /** Itars PI：盖亚阶段可反复弃 4 gaia power 换科技板。 */
  | { kind: 'itars-gaia'; player: PlayerIndex }
  /** Terrans PI：盖亚阶段把 gaia 区 power 当资源兑换。 */
  | { kind: 'terrans-gaia'; player: PlayerIndex }
  /** Tinkeroids：每轮开始选择本轮 Tinkering tile。 */
  | { kind: 'tinkering'; player: PlayerIndex }
  /**
   * 立即拿 1 块科技板（fedlf2、space-giants PI、ship-rescore-fed 重结算 fedlf2）；
   * fromShips=true 时可拿已探索飞船上的标准板。thenCharge = 本决策结算完后
   * 再响应的充能邀约（如升级产生的）。
   */
  | { kind: 'gain-tech-tile'; player: PlayerIndex; fromShips: boolean; thenCharge: ChargeOffer[] }
  /** 免费建矿（fedlf3/fedlf4/techlf1/ship-rescore-fed 重结算）。thenCharge 同上。 */
  | { kind: 'free-mine'; player: PlayerIndex; opts: FreeMineOptions; thenCharge: ChargeOffer[] };

// ---------------------------------------------------------------------------
// 游戏状态
// ---------------------------------------------------------------------------

export type GamePhase = 'setup' | 'action' | 'game-over';

/** setup 阶段细分。 */
export type SetupStage =
  | 'mines-1' // 第一轮起始矿（正序）
  | 'mines-2' // 第二轮起始矿（倒序）
  | 'extra' // Xenos 第 3 矿 → LF 新种族建筑 → Ivits PI
  | 'boosters'; // 选起始助推器（倒序）

export interface GameConfig {
  playerCount: number;
  seed: number;
  /** 每座位种族（长度 = playerCount）。 */
  factions: FactionId[];
  /** 是否启用 Lost Fleet 扩展（默认 true——本项目目标即含扩展）。 */
  lostFleet?: boolean;
  /**
   * 每座位起始 VP（长度 = playerCount；缺省每人 10——规则书标准起始分）。
   * 竞选取族（auction）场景 = 10 − 各自出价。起始研究轨 L1 的一次性 VP 奖励
   * 仍在此基础之上叠加（与标准开局一致）。
   */
  startingVp?: number[];
  /**
   * 完整指定 setup 抽取结果（差分对拍/回放用）；提供时 newGame 跳过 rng 抽签，
   * 地图/板块/助推器/L5 标记全部按 preset 摆放（rngState 仍按 seed 初始化）。
   * 不带 preset 时行为完全不变。
   */
  preset?: SetupPreset;
}

/** setup 抽取结果的完整指定（newGame 的 preset）。 */
export interface SetupPreset {
  /** 扇区摆放（id + 旋转 + 绝对中心；顺序任意）。 */
  map: { sectors: { id: string; rotation: number; center: Hex }[] };
  /** 6 张回合计分板（按轮）。 */
  roundScoring: ScoringTileId[];
  /** 2 张终局计分板。 */
  finalScoring: FinalTileId[];
  /** 高级科技板槽位（6 槽；LF 7 槽）。 */
  advTechTiles: AdvTechTileId[];
  /** 9 个位置 → 标准科技板。 */
  techTilePositions: Record<TechTilePosition, TechTileId>;
  /** 可供选择的回合助推器。 */
  boosters: BoosterId[];
  /** Terraforming 轨 L5 预设的联邦标记。 */
  terraformingL5Token: FederationTokenId;
  /**
   * Lost Fleet 扩展的 setup 抽取结果（提供 preset 且 lostFleet=true 时必填）：
   * Interspace 孔位内容、深空三角格内容、飞船分配、覆盖板面、3 步 terraform 抽取。
   * 全部按绝对格给出，newGame 跳过对应 rng 抽签。
   */
  lostFleet?: {
    /** Interspace 每孔内容（ship = 该孔停放的飞船）。 */
    interspace: { hex: HexKey; planet: PlanetType; ship?: ShipId }[];
    /** 深空三角格内容（tile = 深空板号 11–18；sector 记为 String(tile)、deepSpace=true）。 */
    deepSpace: { hex: HexKey; planet: PlanetType; tile: number }[];
    /** 每艘飞船：孔位、科技槽标准板、金框联邦标记、artifacts（仅 twilight）。 */
    ships: {
      id: ShipId;
      hex: HexKey;
      techTile: TechTileId | null;
      federationToken: FederationTokenId | null;
      artifacts: ArtifactId[];
    }[];
    /** Economy 轨 L3/L4 覆盖板面。 */
    economyOverlay: 'pw' | 'vp';
    /** 计分板扩展条面（第 7 高级板槽条件；§E6）。 */
    scoringExtension: 'vp' | 'ships';
    /** Tinkeroids/Moweyds 的 3 种 3 步 terraform 星球（按种族；其他种族缺省）。 */
    terraformThreeStep?: Partial<Record<FactionId, HomePlanetType[]>>;
  };
}

export interface GameState {
  config: Required<Omit<GameConfig, 'preset'>> & Pick<GameConfig, 'preset'>;
  rngState: number;
  round: number; // 1..6
  phase: GamePhase;
  setupStage: SetupStage | null;
  /** setup 阶段放置队列（玩家座位顺序）。 */
  setupQueue: PlayerIndex[];
  turnOrder: PlayerIndex[];
  currentPlayerIdx: PlayerIndex;
  passedPlayers: PlayerIndex[];
  /** 下轮先手（本轮首个 pass 者）。 */
  firstPlayer: PlayerIndex;
  map: Record<HexKey, HexState>;
  players: PlayerState[];
  board: BoardState;
  pending: PendingDecision | null;
  /** 转化中的盖亚计划：下轮盖亚阶段转化。 */
  gaiaProjectsInProgress: { player: PlayerIndex; hex: HexKey }[];
  /** 盖亚阶段待处理 PI 决策的玩家队列（terrans/itars PI；按桌序逐个置为 pending）。 */
  gaiaPhaseQueue: PlayerIndex[];
  winner: PlayerIndex[] | null;
  lastEvents: string[];
}

// ---------------------------------------------------------------------------
// 行动
// ---------------------------------------------------------------------------

/** 主行动（消耗本回合）。 */
export type MainAction =
  | { type: 'build-mine'; hex: HexKey }
  | {
      type: 'start-gaia-project';
      hex: HexKey;
      /**
       * power 来源区覆盖（harness 对拍用；缺省=III→II→I 规范化约定）。
       * 枚举不产出；带覆盖的行动需 assumeLegal 应用。
       */
      powerFrom?: PowerAreaAmounts;
    }
  | {
      type: 'upgrade';
      hex: HexKey;
      to: 'ts' | 'lab' | 'pi' | 'ac1' | 'ac2';
      /** lab/学院升级立即拿科技板；null=放弃（原则上不该放弃）。 */
      techTile?: TechTileId;
      /** 拿高级板时的选择。 */
      advTechTile?: AdvTechTileId;
      coverTechTile?: TechTileId;
      /** 翻面的绿面联邦标记（拿高级板必翻；标准板升 L5 时为 L5 翻面）。 */
      flipToken?: FederationTokenId;
      /** 拿板后选择推进的研究轨；null/缺省=不推进。 */
      research?: ResearchTrack | null;
      /** 拿板升轨恰好到 nav L5 时的 Lost Planet 放置格。 */
      lostPlanetHex?: HexKey;
      /** LF：从该飞船拿标准板（升 lab/学院且有穿梭机时）。 */
      ship?: ShipId;
    }
  | {
      type: 'form-federation';
      /** 参与联邦的星球格。 */
      hexes: HexKey[];
      /** 新建卫星格。 */
      satellites: HexKey[];
      token: FederationTokenId;
      /** 卫星弃 token 的来源区覆盖（harness 对拍用；缺省=I→II→III 规范化约定）。 */
      powerFrom?: PowerAreaAmounts;
    }
  | {
      type: 'research';
      track: ResearchTrack;
      /** 升 L5 时翻面的联邦标记。 */
      flipToken?: FederationTokenId;
      /** nav L5：Lost Planet 放置格（可达空格）。 */
      hex?: HexKey;
    }
  | { type: 'power-action'; action: BoardActionId; payload?: ActionPayload }
  | { type: 'qic-action'; action: BoardActionId; payload?: ActionPayload }
  | { type: 'special-action'; action: SpecialActionId; payload?: ActionPayload }
  | { type: 'ship-action'; action: ShipActionId; ship: ShipId; payload?: ActionPayload }
  | { type: 'explore-ship'; ship: ShipId }
  /** art-fed 需指定重触发的联邦标记。 */
  | { type: 'inspect-artifact'; artifact: ArtifactId; federationToken?: FederationTokenId }
  | { type: 'pass'; booster: BoosterId | null };

/** 行动附加 payload（依行动种类使用不同字段）。 */
export interface ActionPayload {
  hex?: HexKey;
  track?: ResearchTrack;
  techTile?: TechTileId;
  advTechTile?: AdvTechTileId;
  coverTechTile?: TechTileId;
  federationToken?: FederationTokenId;
  flipToken?: FederationTokenId;
  /** 研究推进恰好到 nav L5 时的 Lost Planet 放置格。 */
  lostPlanetHex?: HexKey;
  /** ship-range3/gleens-range：以临时射程探索的飞船；ship-tech-tile 等：从该船拿标准板。 */
  ship?: ShipId;
  /** booster5 盖亚计划的 power 来源区覆盖（harness 对拍用）。 */
  powerFrom?: PowerAreaAmounts;
}

/** power 三区数量指定（harness 对拍覆盖：从哪些区移/弃 power）。 */
export interface PowerAreaAmounts {
  area1?: number;
  area2?: number;
  area3?: number;
}

/** 免费行动（不消耗回合）。 */
export type FreeAction =
  | {
      type: 'free-conversion';
      conversion: FreeConversionId;
      /**
       * 行为人覆盖（harness 对拍用）：参考对局记录里同一 entry 内主行动之后的
       * 免费行动仍属该玩家，但我们引擎此时已推进回合；缺省=当前回合玩家。
       */
      actor?: PlayerIndex;
      /** 重复次数（harness 对拍用；缺省 1；枚举不产出）。 */
      times?: number;
      /**
       * power 支付先用 III 区 brainstone 当 3（溢出作废；harness 对拍用——
       * 参考引擎由玩家选择是否使用 brainstone，枚举不产出）。
       */
      brainstone?: boolean;
    }
  | {
      type: 'burn';
      /** 行为人覆盖（同 free-conversion.actor）。 */
      actor?: PlayerIndex;
    };

/** 免费兑换 id（数据表定义比率；各族扩展兑换单列）。 */
export type FreeConversionId =
  | 'pw4-q' // 4pw→1q
  | 'pw3-o' // 3pw→1o
  | 'q-o' // 1q→1o
  | 'pw4-k' // 4pw→1k
  | 'pw1-c' // 1pw→1c
  | 'k-c' // 1k→1c
  | 'o-c' // 1o→1c
  | 'o-t' // 1o→1 power token
  | 'nevlas-pw-k' // Nevlas：III 区 1pw→gaia 区换 1k
  | 'nevlas-pw4-oc' // Nevlas PI：4pw→1o+1c
  | 'nevlas-pw6-2o' // Nevlas PI：6pw→2o
  | 'hadsch-c4-q' // Hadsch Hallas PI：4c→1q
  | 'hadsch-c3-o' // 3c→1o
  | 'hadsch-c4-k' // 4c→1k
  | 'baltaks-gf-q' // Bal T'aks：gaiaformer→gaia 区换 1q
  | 'xenos-o-t3' // LF Xenos：1o→1 power 放 III 区
  | 'terrans-gaia-q' // Terrans PI（盖亚阶段）：gaia 4pw→1q
  | 'terrans-gaia-o' // 3pw→1o
  | 'terrans-gaia-k' // 4pw→1k
  | 'terrans-gaia-c' // 1pw→1c
  | 'nevlas-pw2-2c'; // Nevlas PI：2pw→2c（便利兑换，1 token 当 2 不找零）

/** 设置/响应行动。 */
export type SetupAction =
  | { type: 'place-initial-mine'; hex: HexKey }
  | { type: 'choose-booster'; booster: BoosterId };

export type ResponseAction =
  | {
      type: 'charge';
      /**
       * 部分接受量（harness 对拍覆盖；缺省=邀约全量）。
       * 枚举个数不变（只产出全量接受）；带 amount 的行动需 assumeLegal 应用。
       */
      amount?: number;
    }
  | { type: 'decline-charge' }
  | {
      type: 'itars-gaia-tech';
      /** 标准板 id；null + 无 advTechTile = 结束盖亚阶段决策。 */
      techTile: TechTileId | null;
      advTechTile?: AdvTechTileId;
      coverTechTile?: TechTileId;
      flipToken?: FederationTokenId;
      /** 拿板后选择推进的研究轨；null/缺省=不推进。 */
      research?: ResearchTrack | null;
    }
  | { type: 'terrans-gaia-done' }
  /** Tinkeroids：每轮开始选本轮 Tinkering tile（响应 pending tinkering）。 */
  | { type: 'choose-tinkering'; tile: TinkeringTileId }
  /**
   * 拿 1 块科技板（响应 pending gain-tech-tile）；
   * techTile=null 且无 advTechTile = 放弃（仅无可拿板时合法）。
   * ship = 从该飞船拿标准板。
   */
  | {
      type: 'gain-tech-tile';
      techTile: TechTileId | null;
      advTechTile?: AdvTechTileId;
      coverTechTile?: TechTileId;
      flipToken?: FederationTokenId;
      research?: ResearchTrack | null;
      lostPlanetHex?: HexKey;
      ship?: ShipId;
    }
  /** 免费建矿（响应 pending free-mine）；hex=null = 无合法目标跳过。 */
  | { type: 'free-mine'; hex: HexKey | null };

export type Action = MainAction | FreeAction | SetupAction | ResponseAction;
