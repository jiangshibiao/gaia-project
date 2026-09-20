/**
 * 舰队面板（整图重做）：Lost Fleet 4 艘飞船卡片。
 *
 * 每张卡片 = 船板整图（保持原始宽高比完整显示，不裁切）+ 按
 * ship-calibration 的相对坐标（0..1）叠加的交互层（ShipOverlays，悬浮大图复用）：
 * - 探索轨 4 格穿梭机位：空位显示空圈，有主显示穿梭机图 + 玩家色点
 *   （格上充能值 0/2/2/3 为船板印刷，不重画）；
 * - 科技板槽（有板显示板图；Twilight 无槽，改为 4 个神器位横/方阵）；
 * - 金框联邦标记槽（图）；
 * - 3 个行动格：透明热区盖在船板印刷的六边形格上，本轮已用的置灰 +
 *   放 action token 标记；可点击发起 ship-action（legalActions 含对应
 *   候选时高亮）；
 * - 「探索」按钮：右上角小按钮，不遮挡船板主体；
 * - 悬浮非交互区 ≥2 秒 → 弹出 ≈2 倍宽大图（含科技片/联邦片/圣器等全部叠加层，
 *   仅展示不可点；半透明遮罩，点击任意处关闭）。
 *
 * 交互契约同前：onShipAction / onExplore 由 GameScreen 走 selection
 * 状态机预填 ship/action（后续 hex/track 等字段照常追问）。
 */
import type { CSSProperties, MouseEvent, ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import { SHIP_ACTION_SPACES, SHIP_TECH_SLOT_SHIPS } from '@gaia/engine';
import type { Action, PlayerIndex, ShipActionId, ShipId, ShipState } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import {
  SHIP_BOARD_IMAGE,
  SHUTTLE_IMAGE,
  artifactImage,
  federationTokenImage,
  markerImage,
  techTileImage,
} from '../assets';
import { artifactName, factionName, federationTokenName, playerColor, shipActionLabel, shipName, techTileName } from './display';
import { SHIP_CALIBRATION } from './ship-calibration';
import type { RelPoint, ShipCalibration } from './ship-calibration';

export interface FleetPanelProps {
  state: FilteredState;
  seat: PlayerIndex;
  legalActions: Action[];
  onShipAction: (ship: ShipId, action: ShipActionId) => void;
  onExplore: (ship: ShipId) => void;
}

/** 相对坐标 → 居中定位 style（left/top % + translate）。 */
function at(p: RelPoint): CSSProperties {
  return {
    left: `${(p.x * 100).toFixed(2)}%`,
    top: `${(p.y * 100).toFixed(2)}%`,
    transform: 'translate(-50%, -50%)',
  };
}

/** 船板叠加层（卡片与悬浮大图共用）：穿梭机位 / 科技板槽 / 金框联邦标记 / 圣器位 / 行动格。 */
function ShipOverlays({
  ship,
  state,
  seat,
  cal,
  interactive,
  canShipAction,
  onShipAction,
}: {
  ship: ShipState;
  state: FilteredState;
  seat: PlayerIndex;
  cal: ShipCalibration;
  /** false = 悬浮大图（全部禁用，纯展示）。 */
  interactive: boolean;
  canShipAction?: ((ship: ShipId, action: ShipActionId) => boolean) | undefined;
  onShipAction?: ((ship: ShipId, action: ShipActionId) => void) | undefined;
}): ReactElement {
  const actions = SHIP_ACTION_SPACES[ship.id];
  const myShuttle = ship.shuttleSlots.includes(seat);
  return (
    <>
      {/* 探索轨：4 格穿梭机位（空圈 / 穿梭机图 + 玩家色点） */}
      {ship.shuttleSlots.map((occupant, i) => (
        <div
          key={i}
          className={`ship-slot overlay${occupant !== null ? ' occupied' : ''}`}
          style={{ ...at(cal.shuttleSlots[i]!), width: `${cal.shuttleSize * 100}%` }}
          data-testid={`ship-slot-${ship.id}-${i}`}
          title={`穿梭机位 ${i + 1}`}
        >
          {occupant !== null ? (
            <>
              <img className="slot-shuttle" src={SHUTTLE_IMAGE} alt="" aria-hidden="true" />
              <span
                className="slot-owner"
                data-player={occupant}
                style={{ background: playerColor(state, occupant) }}
                title={factionName(state.players[occupant]?.faction ?? 'terrans')}
              />
            </>
          ) : (
            <span className="slot-empty" aria-hidden="true" />
          )}
        </div>
      ))}

      {/* 科技板槽（Twilight 无槽） */}
      {SHIP_TECH_SLOT_SHIPS.includes(ship.id) && cal.techSlot !== null ? (
        <div
          className="ship-tech overlay"
          style={{ ...at(cal.techSlot), width: `${cal.techWidth * 100}%` }}
          title="船上科技板槽"
        >
          {ship.techTiles.length > 0 ? (
            ship.techTiles.map((t) => (
              <img key={t} className="tile-img" src={techTileImage(t)} alt={techTileName(t)} title={techTileName(t)} />
            ))
          ) : (
            <span className="hint">已拿完</span>
          )}
        </div>
      ) : null}

      {/* 金框联邦标记槽（固定 34px，与右侧联邦标记等大；不再按图宽比例） */}
      {ship.federationToken !== null ? (
        <img
          className="tile-img fed gold overlay"
          style={at(cal.fedToken)}
          src={federationTokenImage(ship.federationToken)}
          alt={federationTokenName(ship.federationToken)}
          title={`金框联邦标记：${federationTokenName(ship.federationToken)}`}
        />
      ) : null}

      {/* Twilight artifacts（4 个神器位） */}
      {cal.artifacts !== null
        ? cal.artifacts.map((pos, i) => {
            const art = ship.artifacts[i];
            return art !== undefined ? (
              <img
                key={art.id}
                className="tile-img artifact overlay"
                style={{ ...at(pos), width: `${cal.artifactWidth * 100}%` }}
                src={artifactImage(art.id)}
                alt={artifactName(art.id)}
                title={artifactName(art.id)}
              />
            ) : (
              <span
                key={`empty-${i}`}
                className="artifact-empty overlay"
                style={{ ...at(pos), width: `${cal.artifactWidth * 100}%` }}
                aria-hidden="true"
              />
            );
          })
        : null}

      {/* 行动格（透明热区盖在船板印刷格上；已用置灰 + action token） */}
      {actions.map((actionId, i) => {
        const used = state.board.shipActionsUsed.includes(`${ship.id}:${actionId}`);
        const can = interactive && canShipAction?.(ship.id, actionId) === true;
        return (
          <button
            key={actionId}
            type="button"
            className={`ship-action-cell overlay${used ? ' used' : ''}${can ? ' pickable' : ''}`}
            style={{ ...at(cal.actionSpaces[i]!), width: `${cal.actionSize * 100}%` }}
            data-testid={`ship-action-${ship.id}-${actionId}`}
            disabled={!can}
            title={used ? `${shipActionLabel(actionId)}（本轮已用）` : myShuttle ? shipActionLabel(actionId) : '需先探索该飞船'}
            onClick={can ? () => onShipAction?.(ship.id, actionId) : undefined}
          >
            {used ? (
              <img
                className="action-token"
                src={markerImage('ActionToken')}
                alt="已用"
                style={{ width: `${(cal.actionTokenSize / cal.actionSize) * 100}%` }}
              />
            ) : null}
          </button>
        );
      })}
    </>
  );
}

/** 悬浮大图（≈2 倍卡片宽）：鼠标移动超过阈值或点击任意处关闭；不动则保持。 */
function ShipZoom({
  ship,
  state,
  seat,
  width,
  onClose,
}: {
  ship: ShipState;
  state: FilteredState;
  seat: PlayerIndex;
  width: number;
  onClose: () => void;
}): ReactElement {
  // 打开瞬间记录指针位置；此后 mousemove 超过 6px 即关闭（点击也关闭）
  const origin = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onMove = (e: globalThis.MouseEvent): void => {
      if (origin.current === null) {
        origin.current = { x: e.clientX, y: e.clientY };
        return;
      }
      if (Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 6) {
        onClose();
      }
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
    };
  }, [onClose]);
  return (
    <div className="ship-zoom-backdrop" data-testid="ship-zoom" onClick={onClose}>
      <div className="ship-board ship-zoom-content" style={{ width: `${width.toFixed(0)}px` }}>
        <img className="ship-board-img" src={SHIP_BOARD_IMAGE[ship.id]} alt={shipName(ship.id)} />
        <div className="ship-corner">
          <span className="ship-hex" title={`${shipName(ship.id)} 所在格`}>@{ship.hex}</span>
        </div>
        <ShipOverlays ship={ship} state={state} seat={seat} cal={SHIP_CALIBRATION[ship.id]} interactive={false} />
      </div>
    </div>
  );
}

export function FleetPanel({ state, seat, legalActions, onShipAction, onExplore }: FleetPanelProps): ReactElement {
  const ships = state.board.ships;
  /** legal 判定：存在对应该 (ship, action) 的 ship-action 候选。 */
  const canShipAction = (ship: ShipId, action: ShipActionId): boolean =>
    legalActions.some((a) => a.type === 'ship-action' && a.ship === ship && a.action === action);
  const canExplore = (ship: ShipId): boolean =>
    legalActions.some((a) => a.type === 'explore-ship' && a.ship === ship);

  /** 悬浮非交互区 ≥2 秒 → 弹出船板大图（≈2 倍卡片宽，含全部叠加层）；离开/移入叠加层即取消。 */
  const [zoom, setZoom] = useState<{ ship: ShipId; w: number } | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const cancelHoverTimer = (): void => {
    if (hoverTimer.current !== null) {
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
  };
  const onShipBoardHover = (ship: ShipId, e: MouseEvent<HTMLElement>): void => {
    const target = e.target as HTMLElement;
    // 八边形行动格/联邦片/圣器/科技片/按钮等叠加层：不计入悬浮（各自有交互）
    if (target.closest('.overlay') !== null || target.closest('button') !== null) {
      cancelHoverTimer();
      return;
    }
    if (hoverTimer.current === null) {
      const w = e.currentTarget.getBoundingClientRect().width;
      hoverTimer.current = window.setTimeout(() => {
        hoverTimer.current = null;
        setZoom({ ship, w });
      }, 2000);
    }
  };

  const zoomShipState = zoom !== null ? ships.find((s) => s.id === zoom.ship) : undefined;

  return (
    <div className="fleet-panel" data-testid="fleet-panel">
      {ships.length === 0 ? <p className="hint">本局未启用 Lost Fleet 飞船。</p> : null}
      <div className="fleet-cards">
        {ships.map((ship) => {
          const cal = SHIP_CALIBRATION[ship.id];
          const myShuttle = ship.shuttleSlots.includes(seat);
          return (
            <section key={ship.id} className={`ship-card${myShuttle ? ' unlocked' : ''}`} data-testid={`ship-card-${ship.id}`}>
              <div
                className="ship-board"
                onMouseMove={(e) => onShipBoardHover(ship.id, e)}
                onMouseLeave={cancelHoverTimer}
              >
                <img className="ship-board-img" src={SHIP_BOARD_IMAGE[ship.id]} alt={shipName(ship.id)} />

                {/* 右上角：所在 hex + 探索小按钮（不遮挡船板主体） */}
                <div className="ship-corner">
                  <span className="ship-hex" title={`${shipName(ship.id)} 所在格`}>@{ship.hex}</span>
                  <button
                    type="button"
                    className="btn-primary ship-explore"
                    data-testid={`explore-${ship.id}`}
                    disabled={!canExplore(ship.id)}
                    title="探索该飞船（放置穿梭机）"
                    onClick={() => onExplore(ship.id)}
                  >
                    探索
                  </button>
                </div>

                <ShipOverlays
                  ship={ship}
                  state={state}
                  seat={seat}
                  cal={cal}
                  interactive
                  canShipAction={canShipAction}
                  onShipAction={onShipAction}
                />
              </div>
            </section>
          );
        })}
      </div>

      {/* 悬浮 2 秒弹出的船板大图（≈2 倍卡片宽，含科技片/联邦片/圣器等全部叠加层，仅展示；
          鼠标移动或点击任意处即关闭；鼠标不动则保持放大态） */}
      {zoom !== null && zoomShipState !== undefined ? (
        <ShipZoom ship={zoomShipState} state={state} seat={seat} width={zoom.w * 2} onClose={() => setZoom(null)} />
      ) : null}
    </div>
  );
}
