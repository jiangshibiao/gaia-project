/**
 * 舰队面板（整图重做）：Lost Fleet 4 艘飞船卡片。
 *
 * 每张卡片 = 船板整图（保持原始宽高比完整显示，不裁切）+ 按
 * ship-calibration 的相对坐标（0..1）叠加的交互层：
 * - 探索轨 4 格穿梭机位：空位显示空圈，有主显示穿梭机图 + 玩家色点
 *   （格上充能值 0/2/2/3 为船板印刷，不重画）；
 * - 科技板槽（有板显示板图；Twilight 无槽，改为 4 个神器位横/方阵）；
 * - 金框联邦标记槽（图）；
 * - 3 个行动格：透明热区盖在船板印刷的六边形格上，本轮已用的置灰 +
 *   放 action token 标记；可点击发起 ship-action（legalActions 含对应
 *   候选时高亮）；
 * - 「探索」按钮：右上角小按钮，不遮挡船板主体。
 *
 * 交互契约同前：onShipAction / onExplore 由 GameScreen 走 selection
 * 状态机预填 ship/action（后续 hex/track 等字段照常追问）。
 */
import type { CSSProperties, ReactElement } from 'react';
import { SHIP_ACTION_SPACES, SHIP_TECH_SLOT_SHIPS } from '@gaia/engine';
import type { Action, PlayerIndex, ShipActionId, ShipId } from '@gaia/engine';
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
import type { RelPoint } from './ship-calibration';

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

export function FleetPanel({ state, seat, legalActions, onShipAction, onExplore }: FleetPanelProps): ReactElement {
  const ships = state.board.ships;
  /** legal 判定：存在对应该 (ship, action) 的 ship-action 候选。 */
  const canShipAction = (ship: ShipId, action: ShipActionId): boolean =>
    legalActions.some((a) => a.type === 'ship-action' && a.ship === ship && a.action === action);
  const canExplore = (ship: ShipId): boolean =>
    legalActions.some((a) => a.type === 'explore-ship' && a.ship === ship);

  return (
    <div className="fleet-panel" data-testid="fleet-panel">
      {ships.length === 0 ? <p className="hint">本局未启用 Lost Fleet 飞船。</p> : null}
      <div className="fleet-cards">
        {ships.map((ship) => {
          const cal = SHIP_CALIBRATION[ship.id];
          const actions = SHIP_ACTION_SPACES[ship.id];
          const myShuttle = ship.shuttleSlots.includes(seat);
          return (
            <section key={ship.id} className={`ship-card${myShuttle ? ' unlocked' : ''}`} data-testid={`ship-card-${ship.id}`}>
              <div className="ship-board">
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

                {/* 金框联邦标记槽 */}
                {ship.federationToken !== null ? (
                  <img
                    className="tile-img fed gold overlay"
                    style={{ ...at(cal.fedToken), width: `${cal.fedWidth * 100}%` }}
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
                  const can = canShipAction(ship.id, actionId);
                  return (
                    <button
                      key={actionId}
                      type="button"
                      className={`ship-action-cell overlay${used ? ' used' : ''}${can ? ' pickable' : ''}`}
                      style={{ ...at(cal.actionSpaces[i]!), width: `${cal.actionSize * 100}%` }}
                      data-testid={`ship-action-${ship.id}-${actionId}`}
                      disabled={!can}
                      title={used ? `${shipActionLabel(actionId)}（本轮已用）` : myShuttle ? shipActionLabel(actionId) : '需先探索该飞船'}
                      onClick={() => onShipAction(ship.id, actionId)}
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
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
