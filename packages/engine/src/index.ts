/**
 * @gaia/engine 公共 API。
 * 消费方（protocol/server/web/llm）只许从包根导入，不许 deep import
 * （有 public-api 测试守护）。
 */

// 类型全量 re-export
export type * from './types.js';

// 开局与 setup 推进
export { newGame, advanceSetup } from './setup.js';

// 行动系统：枚举 / 应用 / 自对弈
export { enumerateActions } from './enumerate.js';
export { applyAction, settleSetupSkips, type ApplyOptions } from './apply.js';
export { RandomAgent, playGame, MAX_STEPS, type PlayerAgent } from './agents/random.js';

// 确定性随机 / 序列化 / 错误
export { createRng, type Rng } from './rng.js';
export { stableStringify } from './serialize.js';
export { IllegalActionError } from './errors.js';

// 计分与建筑 pv（测试与消费方查询用）
export { countUnits, finalCount, finalScoring } from './score.js';
export { buildingPowerValue } from './actions/charge.js';
export { rangeOf, terraformStepsFor } from './actions/mine.js';

// hex 几何工具
export {
  hexKey,
  parseHexKey,
  hexS,
  hexAdd,
  hexSub,
  hexDistance,
  HEX_DIRECTIONS,
  hexNeighbors,
  rotateRight,
  SECTOR_POSITIONS,
  type Hex,
  type HexKey,
} from './hex.js';

// 地图构建与纯查询
export {
  buildMap,
  isValidMap,
  mapNeighbors,
  hexesWithin,
  minDistanceToAny,
  playerBuildings,
  colonizedHexes,
} from './map.js';

// 数据表（只读查询用）
export { SECTORS, SECTOR_CHAR_TO_PLANET, type SectorId, type SectorDef, type SectorChar } from './data/sectors.js';
export {
  smallMapCenters,
  bigMapCenters,
  STANDARD_SECTORS_SMALL,
  STANDARD_SECTORS_BIG,
} from './data/maps.js';
export { TERRAFORM_CYCLE, HOME_PLANET_TYPES, terraformingSteps, PLANET_NAMES } from './data/planets.js';
export {
  RESEARCH_TRACKS,
  LEVEL3_CHARGE_POWER,
  BASE_TERRAFORM_COST_PER_STEP,
  BASE_RANGE,
  type ResearchLevelEffect,
  type ResearchTrackDef,
} from './data/research.js';
export {
  TECH_TILES,
  ADV_TECH_TILES,
  type TechTileDef,
  type AdvTechTileDef,
  type TechEffect,
  type TechTrigger,
} from './data/techs.js';
export { FEDERATION_TOKENS, type FederationTokenDef } from './data/federations.js';
export {
  ROUND_SCORING,
  FINAL_SCORING,
  FINAL_RANK_VP,
  type RoundScoringDef,
  type RoundScoringTrigger,
  type FinalScoringDef,
  type FinalCondition,
} from './data/scoring.js';
export { BOOSTERS, type BoosterDef } from './data/boosters.js';
export {
  FACTIONS,
  type FactionDef,
  type FactionAbility,
  type IncomeTrackDef,
} from './data/factions.js';
export {
  BUILDING_COST,
  UPGRADE_CHAIN,
  UPGRADE_CHAIN_BESCODS,
  BUILDING_POWER_VALUE,
  FEDERATION_MIN_POWER,
  BOARD_ACTIONS,
  FREE_CONVERSIONS,
  SHIP_ACTIONS,
  EXPLORE_SHIP_COST_VP,
  EXPLORE_SHIP_COST_VP_BALTAKS,
  INSPECT_ARTIFACT_COST_POWER,
  type BuildingCost,
  type BoardActionDef,
  type BoardActionEffect,
  type FreeConversionDef,
  type ConversionCost,
  type ShipActionDef,
  type ShipActionEffect,
} from './data/prices.js';
export { type ResourceGain, type CountUnit } from './data/rewards.js';
export {
  lfStandardCenters,
  lfHolePositions,
  lfDeepSpaceNotches,
  lfDeepSpaceTilePool,
  DEEP_SPACE_TILES,
  LF_INTERSPACE_FILL,
  lfShipsFor,
  SHIP_ACTION_SPACES,
  SHIP_TECH_SLOT_SHIPS,
  shuttleSlotCharge,
  shuttlesPerPlayer,
  artifactPool,
  TINKERING_TILES,
  tinkeringGroupForRound,
  ECONOMY_OVERLAY,
  type TinkeringTileDef,
  type DeepSpaceTileDef,
  type EconomyOverlayFace,
} from './data/lostfleet.js';
