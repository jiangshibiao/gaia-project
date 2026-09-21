/**
 * 行动红框高亮（伯明翰式提示）：任一玩家确认一步行动后（即使未按最终完成），
 * 涉及地图/版图/轨道/板块的位置用红框标出 ~5 秒：
 * - 建造/放矿/免费矿：地图 hex + 其个人版图刚解锁的空槽；
 * - 升级：地图 hex + 目标建筑解锁槽；
 * - 爬轨：研究轨到达的等级格；
 * - 拿科技片/高级片/联邦片：持有者横条里对应片；
 * - Pass 换助推器：持有者竖列里的助推片。
 * 充能邀约 pending 期间，触发 hex 持续红框（供判断是否蹭能量）。
 */
import type { Action, BuildingType, GameState, HexKey, PlayerIndex, ResearchTrack } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';

export interface ActionFlash {
  /** 地图红框 hex 集合。 */
  hexes: HexKey[];
  /** 版图解锁槽红框（建筑类型 + 刚解锁的槽位下标）。 */
  matSlot: { player: PlayerIndex; building: BuildingType; slotIndex: number } | null;
  /** 研究轨红框（轨 + 到达等级）。 */
  research: { track: ResearchTrack; level: number } | null;
  /** 持有者横条里红框的片（科技/高级/联邦，按 id）。 */
  tileIds: string[];
  /** 片/助推片所属玩家（行动的发动者）。 */
  tilesPlayer: PlayerIndex | null;
  /** 持有者助推片红框。 */
  boosterPlayer: PlayerIndex | null;
}

const SUPPLY_BUILDINGS: readonly BuildingType[] = ['mine', 'ts', 'lab', 'pi', 'ac1', 'ac2'];

function payloadHex(action: Action): HexKey | undefined {
  const direct = (action as { hex?: HexKey }).hex;
  if (direct !== undefined) return direct;
  const payload = (action as { payload?: { hex?: HexKey | null } }).payload;
  return payload?.hex ?? undefined;
}

/** 从行动 + 应用后状态推导红框目标；无关行动返回 null。 */
export function flashForAction(action: Action, after: FilteredState, player: PlayerIndex): ActionFlash | null {
  const flash: ActionFlash = { hexes: [], matSlot: null, research: null, tileIds: [], tilesPlayer: null, boosterPlayer: null };
  const hex = payloadHex(action);
  if (hex !== undefined) flash.hexes.push(hex);
  const p = after.players[player];

  switch (action.type) {
    case 'build-mine':
    case 'place-initial-mine':
      flash.matSlot = freedSlot(after, player, 'mine');
      break;
    case 'upgrade':
      flash.matSlot = freedSlot(after, player, action.to);
      break;
    case 'research':
      if (p !== undefined) flash.research = { track: action.track, level: p.research[action.track] };
      break;
    case 'pass':
      if (action.booster !== null) flash.boosterPlayer = player;
      break;
    default:
      break;
  }

  // 科技片/高级片/联邦片（顶层字段或 payload）
  const payload = (action as { payload?: Record<string, unknown> }).payload ?? {};
  for (const key of ['techTile', 'advTechTile', 'federationToken'] as const) {
    const v = (action as unknown as Record<string, unknown>)[key] ?? payload[key];
    if (typeof v === 'string') {
      flash.tileIds.push(v);
      flash.tilesPlayer = player;
    }
  }

  return flash.hexes.length > 0 || flash.matSlot !== null || flash.research !== null || flash.tileIds.length > 0 || flash.boosterPlayer !== null
    ? flash
    : null;
}

/** 刚解锁的空槽下标：slots.length - remaining - 1（supply 从左取用、剩余靠右）。 */
function freedSlot(after: FilteredState, player: PlayerIndex, building: BuildingType): ActionFlash['matSlot'] {
  const p = after.players[player];
  if (p === undefined || !SUPPLY_BUILDINGS.includes(building)) return null;
  const remaining = p.buildings[building as keyof typeof p.buildings];
  return { player, building, slotIndex: -(remaining + 1) + slotCount(building, after, player) };
}

/** 各建筑槽位总数（mine 8 / ts 4 / lab 3 / pi 1 / ac1 1 / ac2 1）。 */
function slotCount(building: BuildingType, _after: FilteredState, _player: PlayerIndex): number {
  switch (building) {
    case 'mine':
      return 8;
    case 'ts':
      return 4;
    case 'lab':
      return 3;
    default:
      return 1;
  }
}

/** pending 充能邀约的触发 hex：日志里最近一次带 hex 的行动（建矿/盖亚计划等）。 */
export function chargeTriggerHex(log: readonly { player: number; action: Action }[]): HexKey | null {
  for (let i = log.length - 1; i >= 0; i--) {
    const hex = payloadHex(log[i]!.action);
    if (hex !== undefined) return hex;
  }
  return null;
}
