/**
 * 左栏（v8 两块布局）：
 * - 上块 = 我自己的版图（PlayerMat）+ 正右方种族飞船面板（ExplorationBoard 实图，
 *   LF 限定）+ 下方科技板/推进片实图小横条（TechBoosterStrip，与详情弹窗共享逻辑）；
 * - 下块 = 其他玩家版图同款组合：>1 个对手时顶部一条 TAB 细条（座位色小方块 + 昵称，
 *   当前行动者带指示点），点击切换下方 PlayerMat；默认选中第一个对手；
 *   2 人局唯一对手不渲染 TAB 直接显示。
 * 当前行动者高亮、详情弹窗入口、拖拽建矿（仅自己面板且轮到自己）保持不变。
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import type { BuildingSupply, PlayerIndex, SpecialActionId } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import { playerColor } from './display';
import { PanelBoosterStack } from './ExplorationBoard';
import type { ActionFlash } from './actionFlash';
import { PlayerMat, TechBoosterStrip } from './PlayerMat';
import type { LogEntry } from './store';

export interface LeftRailProps {
  state: FilteredState;
  seat: PlayerIndex;
  nicknames: readonly (string | undefined)[];
  /** 当前应行动玩家（actorOf 裁决，含 pending/setup）；null = 对局结束等。 */
  actor: PlayerIndex | null;
  thinkingSeats: readonly PlayerIndex[];
  onShowDetail: (player: PlayerIndex) => void;
  /** 拖拽建矿源（仅自己面板且轮到自己时由 GameScreen 传入）。 */
  onBuildingDragStart?: ((b: keyof BuildingSupply, e: React.PointerEvent<HTMLImageElement>) => void) | undefined;
  /** 星际要塞特殊行动可用（自己回合且 legalActions 含 special-action）。 */
  specialAvailable?: boolean | undefined;
  /** 点击星际要塞（PI 热区）→ 与「特殊行动」按钮同效（仅自己面板传入）。 */
  onSpecialAction?: (() => void) | undefined;
  /** 点击具体特殊行动八边形（tech9/助推片/高级板）→ 锁定该行动发起（前端推断，仅自己面板传入）。 */
  onSpecialTile?: ((id: SpecialActionId) => void) | undefined;
  /** 全量行动日志（传给各 PlayerMat 的"最近行动"行与全部行动弹窗）。 */
  actionLog?: readonly LogEntry[] | undefined;
  /** 复盘第一视角切换（仅复盘传入；渲染在我的版图详情按钮前）。 */
  onCycleViewSeat?: (() => void) | undefined;
  /** 行动红框（按玩家路由到对应版图/横条/竖列）。 */
  flash?: ActionFlash | null | undefined;
}

export function LeftRail({ state, seat, nicknames, actor, thinkingSeats, onShowDetail, onBuildingDragStart, specialAvailable, onSpecialAction, onSpecialTile, onCycleViewSeat, flash, actionLog }: LeftRailProps): ReactElement {
  const opponents = state.players.map((_, i) => i).filter((i) => i !== seat);
  // null = 未手动选择 → 默认第一个对手；座位数/座位变化导致选中失效时同样回退
  const [oppTab, setOppTab] = useState<PlayerIndex | null>(null);
  const selected = oppTab !== null && opponents.includes(oppTab) ? oppTab : opponents[0];

  return (
    <aside className="rail-l" data-testid="rail-l">
      {/* 上块：我的版图（右侧贴种族飞船面板）+ 科技/推进小横条 */}
      <div className="rail-block" data-testid="rail-mine">
        <div className="rail-block-main">
          <PlayerMat
            state={state}
            playerIdx={seat}
            nickname={nicknames[seat]}
            isMe
            thinking={thinkingSeats.includes(seat)}
            active={actor === seat}
            onShowDetail={onShowDetail}
            onCycleViewSeat={onCycleViewSeat}
            onBuildingDragStart={actor === seat ? onBuildingDragStart : undefined}
            specialAvailable={specialAvailable}
            onSpecialAction={actor === seat ? onSpecialAction : undefined}
            onSpecialTile={actor === seat ? onSpecialTile : undefined}
            flashSlot={flash?.matSlot?.player === seat ? flash.matSlot : null}
            actionLog={actionLog}
          />
          <PanelBoosterStack state={state} seat={seat} flashBooster={flash?.boosterPlayer === seat} specialAvailable={specialAvailable} onSpecialAction={actor === seat ? onSpecialAction : undefined} onSpecialTile={actor === seat ? onSpecialTile : undefined} />
        </div>
        <div className="rail-mine-bottom">
          <TechBoosterStrip state={state} playerIdx={seat} flashTileIds={flash?.tilesPlayer === seat ? flash.tileIds : []} onSpecialTile={actor === seat ? onSpecialTile : undefined} />
        </div>
      </div>

      {/* 下块：对手版图（TAB 切换；单对手免 TAB） */}
      {selected !== undefined ? (
        <div className="rail-block" data-testid="rail-opponents">
          {opponents.length > 1 ? (
            <div className="opp-tabs" data-testid="opp-tabs" role="tablist">
              {opponents.map((i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={selected === i}
                  className={`opp-tab${selected === i ? ' selected' : ''}`}
                  data-testid={`opp-tab-${i}`}
                  onClick={() => setOppTab(i)}
                >
                  <span className="faction-chip" style={{ background: playerColor(state, i) }} aria-hidden="true" />
                  <span className="opp-tab-name">{nicknames[i] ?? `玩家 ${i + 1}`}</span>
                  {actor === i ? <span className="actor-dot" data-testid={`opp-tab-actor-${i}`} title="当前行动者" /> : null}
                </button>
              ))}
            </div>
          ) : null}
          <div className="rail-block-main">
            <PlayerMat
              state={state}
              playerIdx={selected}
              nickname={nicknames[selected]}
              thinking={thinkingSeats.includes(selected)}
              active={actor === selected}
              onShowDetail={onShowDetail}
              flashSlot={flash?.matSlot?.player === selected ? flash.matSlot : null}
              actionLog={actionLog}
            />
            <PanelBoosterStack state={state} seat={selected} flashBooster={flash?.boosterPlayer === selected} />
          </div>
          <div className="rail-mine-bottom">
            <TechBoosterStrip state={state} playerIdx={selected} flashTileIds={flash?.tilesPlayer === selected ? flash.tileIds : []} />
          </div>
        </div>
      ) : null}
    </aside>
  );
}
