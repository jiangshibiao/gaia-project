/**
 * @gaia/protocol — 客户端/服务器协议契约（M2b）。
 *
 * 与 Brass 的关键差异：
 * - 盖亚无隐藏信息：FilteredState 仅剥 rngState（见 filter.ts）；
 * - 每回合 1 个主行动、apply 后自动轮下一位：无 turnHold/end_turn/draft 机制；
 * - 但存在**非当前玩家的待决决策**（pending：被动充能、terrans/itars 盖亚决策、
 *   tinkering、gain-tech-tile、free-mine）与 setup 阶段（setupQueue）——
 *   "谁该行动"统一由 actorOf 裁决。
 */
import type { Action, FactionId, GameConfig, GameState, PlayerIndex } from '@gaia/engine';

export const PROTOCOL_VERSION = 1;

export { filterStateFor, type FilteredState } from './filter.js';
import type { FilteredState } from './filter.js';

/**
 * 导出/导入对局记录：engine GameConfig（含种子与每座位种族）+ 全量行动日志，
 * 确定性重放（newGame(config) + 逐条 applyAction）。导入仅用于复盘查看，不进房间。
 */
export interface GameRecord {
  version: 1;
  config: GameConfig;
  actions: Action[];
}

/**
 * 当前应行动的玩家（null = 对局已结束）。
 * 裁决顺序：
 * 1. pending 非空 → 待决玩家（charge 取邀约队列队首，其余 kind 取 .player）；
 *    ——setup 阶段放置起始矿同样可能产生充能邀约，故 pending 优先于 setup 判定；
 * 2. phase==='setup' → setupQueue[0]；
 * 3. 否则 → currentPlayerIdx（盖亚的 currentPlayerIdx 即座位号）。
 */
export function actorOf(state: GameState): PlayerIndex | null {
  if (state.phase === 'game-over') return null;
  const pending = state.pending;
  if (pending !== null) {
    if (pending.kind === 'charge') {
      return pending.queue[0]?.player ?? null;
    }
    return pending.player;
  }
  if (state.phase === 'setup') {
    return state.setupQueue[0] ?? null;
  }
  return state.currentPlayerIdx;
}

// ---------------------------------------------------------------------------
// 房间配置与大厅
// ---------------------------------------------------------------------------

export type AIDifficulty = 'easy' | 'normal' | 'hard';

/** 一个 AI 座位的配置：难度 + 可选插件 spec（如 'builtin:random'；缺省用服务器默认）。 */
export interface AISeatConfig {
  difficulty: AIDifficulty;
  spec?: string;
}

/**
 * 种族选取方案（开局前 RoomConfig.factionMode，缺省 'random'）：
 * - friendly：按座位顺序交互式选族，每人锁定一个未被选取的种族，其他人可见；
 * - random：开局时服务器按 seed 随机分配（现状）；
 * - auction：竞技竞拍（gaia-project.io BidWhileChoosing）——选空闲族出价 0 持有，
 *   或对已被持有的族出更高价挤走原持有者，起始 VP = 10 − 出价。
 */
export type FactionMode = 'friendly' | 'random' | 'auction';

/**
 * 大厅房间配置。lostFleet 缺省 = true（本项目目标即含扩展）。
 * seed：可选自定义种子（缺省开局时 crypto 随机落地）；aiSeats：start_game 时按序
 * 填充空位，长度须 ≤ playerCount-1（create_room 校验，非法回 'invalid-config'）。
 * factionMode 缺省 'random'；friendly/auction 时 start_game 先进入 draft 阶段，
 * 选族结果（factions + startingVp）再落地为 engine GameConfig。
 * factions 不在此列——random 模式 start_game 时由服务器按 seed 随机分配（18 族（lostFleet）
 * 或 14 族抽 playerCount 个不重复）。
 */
export interface RoomConfig {
  playerCount: 2 | 3 | 4;
  lostFleet?: boolean;
  seed?: number;
  aiSeats?: AISeatConfig[];
  factionMode?: FactionMode;
}

export interface SeatInfo {
  seat: PlayerIndex;
  nickname: string;
  isAI: boolean;
  connected: boolean;
}

/** customSeed：client 供 seed 时 true（公开标记）；广播 config 不含 seed 值。 */
export interface RoomState {
  code: string;
  config: RoomConfig;
  customSeed: boolean;
  seats: (SeatInfo | null)[];
  started: boolean;
  /** true = 房间处于 draft（种族选取）阶段（friendly/auction；选族状态走 draft_state 消息）。 */
  drafting: boolean;
}

/** AI 插件元信息（list_agent_plugins 的应答载荷，与 llm agents/contract.ts 的 meta 对齐）。 */
export interface AgentPluginMeta {
  name: string;
  version: string;
  description: string;
  author?: string;
}

// ---------------------------------------------------------------------------
// 种族选取（draft）阶段
// ---------------------------------------------------------------------------

/** 一个座位的选族结果：friendly 锁定 bid=0；auction 持有 bid=出价。 */
export interface DraftPickInfo {
  faction: FactionId;
  bid: number;
}

/**
 * draft 阶段广播状态（广播安全：无 token；选族全程公开）。
 * - turnOrder：行动顺序（= 座位序）；
 * - currentActor：当前应行动座位（finished 后为 null）；
 * - picks：座位 → 持有信息（null = 未持有；auction 中被挤走的玩家回到 null）；
 * - available：当前无人持有的种族（draft_pick 可选）；
 * - finished：全员持有 → 可 draft_confirm 开局。
 */
export interface DraftState {
  mode: Exclude<FactionMode, 'random'>;
  turnOrder: PlayerIndex[];
  currentActor: PlayerIndex | null;
  picks: Record<PlayerIndex, DraftPickInfo | null>;
  available: FactionId[];
  finished: boolean;
}

// ---------------------------------------------------------------------------
// 下行
// ---------------------------------------------------------------------------

export type ServerMessage =
  | { type: 'room_state'; protocolVersion: number; room: RoomState; yourSeat: PlayerIndex | null } // 广播安全：绝不含 token
  | { type: 'draft_state'; protocolVersion: number; draft: DraftState } // 种族选取阶段状态（广播安全）
  | { type: 'credentials'; protocolVersion: number; seat: PlayerIndex; token: string } // 仅 create/join/resume 时单发给本人
  | { type: 'snapshot'; protocolVersion: number; seq: number; state: FilteredState; legalActions: Action[] } // legalActions 仅"当前应行动座位"非空
  | { type: 'action_applied'; protocolVersion: number; seq: number; player: PlayerIndex; action: Action; events: unknown[]; reason?: string; degraded?: boolean } // reason：AI 决策理由（真人行动无此字段）；degraded=true：非 LLM 降级路径（启发式/兜底）
  | { type: 'ai_thinking'; protocolVersion: number; seat: PlayerIndex; thinking: boolean } // AI 决策中指示（true→false 成对）
  | { type: 'game_over'; protocolVersion: number; winner: PlayerIndex[]; finalScores: number[] } // finalScores = 终局 state.players[].vp 按座位序
  | { type: 'export_data'; protocolVersion: number; record: GameRecord } // export_game 的应答：整局记录（开局到当前进度）
  | { type: 'agent_plugins'; protocolVersion: number; plugins: AgentPluginMeta[]; defaultSpec: string } // list_agent_plugins 的应答：可用 AI 插件清单 + 服务器默认 spec
  | { type: 'error'; protocolVersion: number; code: string; message: string }
  | { type: 'pong'; protocolVersion: number };

// ---------------------------------------------------------------------------
// 上行
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'create_room'; protocolVersion: number; nickname: string; config: RoomConfig }
  | { type: 'join_room'; protocolVersion: number; code: string; nickname: string }
  | { type: 'start_game'; protocolVersion: number; token: string }
  | { type: 'draft_pick'; protocolVersion: number; token: string; faction: FactionId } // friendly 锁定 / auction 选无人持有的族（bid 0）
  | { type: 'draft_bid'; protocolVersion: number; token: string; faction: FactionId; bid: number } // auction 对已被持有的族抬价（须 > 当前价）
  | { type: 'draft_confirm'; protocolVersion: number; token: string } // draft 全员就绪后确认开局
  | { type: 'submit_action'; protocolVersion: number; token: string; action: Action }
  | { type: 'resume'; protocolVersion: number; token: string }
  | { type: 'leave'; protocolVersion: number; token: string } // 主动退出：清座位索引 + 广播 + 断开本连接（对局继续）
  | { type: 'export_game'; protocolVersion: number; token: string } // 导出当前对局记录（服务器从库读出整局行动日志）
  | { type: 'import_game'; protocolVersion: number; record: GameRecord; seat?: PlayerIndex } // 重放校验后回 snapshot（复盘查看用，不进房间；seat=查看视角，缺省 0）
  | { type: 'list_agent_plugins'; protocolVersion: number } // 查询可用 AI 插件清单（无需 token）
  | { type: 'ping'; protocolVersion: number };
