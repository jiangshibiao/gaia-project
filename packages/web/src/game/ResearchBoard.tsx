/**
 * 研究轨道面板（整图重做 · 底部栏合并面板左侧）：以 ResearchBoard.jpg 整图为背景
 * （保持原始宽高比），按 research-calibration 的相对坐标叠加：
 * - 6 轨等级格：各玩家爬轨 token（玩家色小圆片，同格错开）+ L5 已被占标记；
 * - 标准科技板 9 位（轨道内 6 槽 + 底排 3 自由槽，已空槽置灰）；
 * - 高级科技板槽（图上 6 槽；LF 第 7 槽在计分区扩展条，见 AdvExtension）；
 * - power/qic 行动格（透明热区盖在印刷格上，本轮已用放 action token + 置灰）；
 * - Terraforming L5 预设联邦标记；LF economy 轨 L3/L4 覆盖板（pw/vp 面）。
 *
 * 整板按自然宽（1838px）布局后经 .rb-scale 外壳 transform scale 回缩显示；
 * scale 由 ResizeObserver 按外壳实际渲染宽度动态计算（researchBoardScale），
 * 叠加相对坐标与点击热区随板面同步缩放，任何宽度下不失准。
 *
 * 回合计分/终局计分已迁 ScoreboardBoard（实图计分板）；助推器供应为 BoostersStrip（中央底条）。
 *
 * 交互：GameScreen 传入当前选择问题的字段（activeField/activeOptions），
 * 命中元素高亮并可点击（track/action/techTile/advTechTile 字段直接点板面）。
 */
import type { CSSProperties, ReactElement } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { BoardActionId, FederationTokenId, ResearchTrack, TechTilePosition } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import {
  ACTION_TOKEN_IMAGE,
  RESEARCH_BOARD_BG,
  advTechTileImage,
  economyOverlayImage,
  federationTokenImage,
  QIC_COVER_IMAGE,
  techTileImage,
} from '../assets';
import type { CategoryId } from './interactions';
import {
  advTechTileName,
  boardActionLabel,
  federationTokenName,
  playerColor,
  techTileName,
  trackName,
} from './display';
import { fedTokenMaxWidth } from './fedRow';
import { TRACK_ORDER } from './PlayerMat';
import {
  ACTION_TOKEN_SIZE,
  ACTION_ZONE_SIZE,
  ADV_TECH_Y,
  ADV_TILE_WIDTH,
  BOARD_ACTION_SLOTS,
  ECONOMY_OVERLAY_POS,
  ECON_OVERLAY_WIDTH,
  L5_FED_WIDTH,
  LEVEL_BOX_RATIO,
  LEVEL_BOX_WIDTH,
  LEVEL_DOT_FRAC,
  LEVEL_DOT_STAGGER_FRAC,
  QIC_COVER_RECT,
  TECH_TILE_ASPECT,
  TECH_STACK_OFFSET_PCT,
  TECH_TILE_WIDTH,
  TRACK_COLUMN_X,
  TRACK_LEVEL_Y,
  researchBoardScale,
  techTileSlot,
} from './research-calibration';
import type { RelPoint } from './research-calibration';

const BOARD_ACTION_ORDER: readonly BoardActionId[] = [
  'power1',
  'power2',
  'power3',
  'power4',
  'power5',
  'power6',
  'power7',
  'qic1',
  'qic2',
  'qic3',
];

const TECH_POSITION_ORDER: readonly TechTilePosition[] = [
  'terra',
  'nav',
  'int',
  'gaia',
  'eco',
  'sci',
  'free1',
  'free2',
  'free3',
];

/** 相对坐标 → 居中定位 style。 */
function at(p: RelPoint): CSSProperties {
  return {
    left: `${(p.x * 100).toFixed(2)}%`,
    top: `${(p.y * 100).toFixed(2)}%`,
    transform: 'translate(-50%, -50%)',
  };
}

export interface ResearchBoardProps {
  state: FilteredState;
  /** 当前选择问题的字段 key（null = 纯展示）。 */
  activeField?: string | null | undefined;
  /** 当前类别（区分 power/qic 行动格）。 */
  activeCategory?: CategoryId | null | undefined;
  /** 当前字段的可选值集合（命中才可点）。 */
  activeOptions?: ReadonlySet<string> | null | undefined;
  onPick?: ((fieldKey: string, value: string) => void) | undefined;
  /** 未在选择态时可直接点击发起的 power/qic 行动格（legalActions 中存在）。 */
  availableActions?: ReadonlySet<string> | null | undefined;
  /** 直接点击行动格（未在选择态）→ 由 GameScreen 开选择并预填 action 字段。 */
  onBoardAction?: ((id: BoardActionId) => void) | undefined;
  /** 行动红框：爬轨到达的等级格（~5s 提示）。 */
  flashResearch?: { track: ResearchTrack; level: number } | null | undefined;
  /** 联邦标记选择态（组建联邦第二步）：可拿的标记 id 集合（命中才可点）。 */
  fedTokenOptions?: ReadonlySet<string> | null | undefined;
  /** 点击供应区联邦片 → 选为联邦标记。 */
  onFedTokenPick?: ((token: FederationTokenId) => void) | undefined;
}

export function ResearchBoard({
  state,
  activeField,
  activeCategory,
  activeOptions,
  onPick,
  availableActions,
  onBoardAction,
  flashResearch,
  fedTokenOptions,
  onFedTokenPick,
}: ResearchBoardProps): ReactElement {
  const board = state.board;
  /** 该值是否当前可点。 */
  const pickable = (field: string, value: string): boolean =>
    activeField === field && activeOptions?.has(value) === true && onPick !== undefined;

  // 动态缩放：量外壳实际渲染宽度 → --rb-scale（无 ResizeObserver 环境回退 CSS 默认值）
  const scaleRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);
  useEffect(() => {
    const el = scaleRef.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setScale(researchBoardScale(w));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  return (
    <aside className="research-board" data-testid="research-board">
      {/* 缩放外壳：整板按自然宽布局后 transform scale 回缩（叠加坐标/热区同步缩放） */}
      <div
        className="rb-scale"
        data-testid="rb-scale"
        ref={scaleRef}
        style={scale !== null ? ({ '--rb-scale': scale.toFixed(4) } as CSSProperties) : undefined}
      >
        <div className="rb-board">
        <img className="rb-board-img" src={RESEARCH_BOARD_BG} alt="研究板" />

        {/* 6 条研究轨：列热区 + 等级格 token */}
        {TRACK_ORDER.map((t: ResearchTrack) => {
          const colX = TRACK_COLUMN_X[t];
          const l5Holder = board.researchLevel5[t];
          const can = pickable('track', t);
          return (
            <div key={t} className="rb-track">
              <button
                type="button"
                className={`rb-track-zone${can ? ' pickable' : ''}`}
                style={{ left: `${((colX - 1 / 12) * 100).toFixed(2)}%`, width: `${(100 / 6).toFixed(2)}%` }}
                data-testid={`track-${t}`}
                disabled={!can}
                title={trackName(t)}
                onClick={can ? () => onPick?.('track', t) : undefined}
              />
              {TRACK_LEVEL_Y.map((y, lv) => {
                const here = state.players.flatMap((p, i) => (p.research[t] === lv ? [i] : []));
                const isL5 = lv === 5;
                return (
                  <div
                    key={lv}
                    className={`rb-level overlay${isL5 ? ' l5' : ''}${isL5 && l5Holder !== undefined ? ' occupied' : ''}`}
                    style={{
                      left: `${(colX * 100).toFixed(2)}%`,
                      top: `${(y * 100).toFixed(2)}%`,
                      width: `${LEVEL_BOX_WIDTH * 100}%`,
                      aspectRatio: `${LEVEL_BOX_RATIO}`,
                    }}
                    data-testid={`track-${t}-level-${lv}`}
                    title={`${trackName(t)} L${lv}${isL5 && l5Holder !== undefined ? '（已被占）' : ''}`}
                  >
                    {here.map((i, k) => (
                      <span
                        key={i}
                        className="player-dot"
                        style={
                          {
                            left: `${(50 + (k - (here.length - 1) / 2) * LEVEL_DOT_STAGGER_FRAC * 100).toFixed(2)}%`,
                            width: `${LEVEL_DOT_FRAC * 100}%`,
                            '--pc': playerColor(state, i),
                          } as CSSProperties
                        }
                        data-player={i}
                      />
                    ))}
                    {isL5 && l5Holder !== undefined ? <span className="l5-ring" aria-hidden="true" /> : null}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Terraforming L5 预设联邦标记 */}
        {board.terraformingL5Token !== null ? (
          <img
            className="tile-img fed overlay"
            style={{
              ...at({ x: TRACK_COLUMN_X.terra + 0.045, y: TRACK_LEVEL_Y[5]! }),
              width: `${L5_FED_WIDTH * 100}%`,
            }}
            src={federationTokenImage(board.terraformingL5Token)}
            alt=""
            title={`Terraforming L5 预设：${federationTokenName(board.terraformingL5Token)}`}
          />
        ) : null}

        {/* 行动红框：爬轨到达的等级格（~5s 提示） */}
        {flashResearch !== null && flashResearch !== undefined && flashResearch.level >= 1 && flashResearch.level <= 5 ? (
          <span
            className="rb-flash overlay"
            data-testid={`rb-flash-${flashResearch.track}`}
            style={{
              left: `${TRACK_COLUMN_X[flashResearch.track] * 100}%`,
              top: `${TRACK_LEVEL_Y[flashResearch.level - 1]! * 100}%`,
              width: `${LEVEL_BOX_WIDTH * 100}%`,
            }}
          />
        ) : null}

        {/* LF 经济轨 L3/L4 覆盖板（pw/vp 面） */}
        {board.economyOverlay !== null ? (
          <img
            className="rb-econ-overlay overlay"
            style={{ ...at(ECONOMY_OVERLAY_POS), width: `${ECON_OVERLAY_WIDTH * 100}%` }}
            src={economyOverlayImage(board.economyOverlay)}
            alt={`经济轨覆盖板（${board.economyOverlay} 面）`}
            title="LF 经济轨 L3/L4 覆盖板"
          />
        ) : null}

        {/* 标准科技板（轨道位 + 底排自由位）：按剩余张数堆叠——**整叠居中于槽位**
            （每层向右上步进，底层在左下露边表张数；顶片不再独占槽中心——
            曾"顶片居中+下层左下"致主片视觉偏右上，用户反馈后改整叠居中）；
            拿完露出印刷空槽 */}
        {TECH_POSITION_ORDER.map((pos) => {
          const tile = board.techTilePositions[pos];
          const left = board.techTiles[tile] ?? 0;
          const can = pickable('techTile', tile);
          const n = Math.max(left, 0);
          return (
            <button
              key={pos}
              type="button"
              className={`tech-tile img overlay stack${left <= 0 ? ' empty' : ''}${can ? ' pickable' : ''}`}
              style={{ ...at(techTileSlot(pos)), width: `${TECH_TILE_WIDTH * 100}%`, aspectRatio: `${TECH_TILE_ASPECT}` }}
              data-testid={`tech-tile-pos-${pos}`}
              data-tile={tile}
              disabled={!can}
              onClick={() => onPick?.('techTile', tile)}
              title={`${techTileName(tile)}（剩 ${left}）`}
            >
              {Array.from({ length: n }, (_, i) => (
                <img
                  key={i}
                  className="tile-img stack-tile"
                  style={{
                    width: '100%',
                    left: `${(i - (n - 1) / 2) * TECH_STACK_OFFSET_PCT}%`,
                    top: `${((n - 1) / 2 - i) * TECH_STACK_OFFSET_PCT * TECH_TILE_ASPECT}%`,
                  }}
                  src={techTileImage(tile)}
                  alt={techTileName(tile)}
                />
              ))}
            </button>
          );
        })}

        {/* 高级科技板槽（图上 6 槽；LF 第 7 槽在计分区扩展条 AdvExtension） */}
        {board.advTechTiles.slice(0, 6).map((tile, i) => {
          const pos = { x: TRACK_COLUMN_X[TRACK_ORDER[i]!], y: ADV_TECH_Y };
          if (tile === null) {
            return (
              <span
                key={i}
                className="adv-slot empty overlay"
                style={{ ...at(pos), width: `${ADV_TILE_WIDTH * 100}%` }}
                data-testid={`adv-slot-${i}`}
              >
                已拿
              </span>
            );
          }
          const can = pickable('advTechTile', tile);
          return (
            <button
              key={i}
              type="button"
              className={`adv-slot img overlay${can ? ' pickable' : ''}`}
              style={{ ...at(pos), width: `${ADV_TILE_WIDTH * 100}%` }}
              data-testid={`adv-slot-${i}`}
              data-tile={tile}
              disabled={!can}
              onClick={() => onPick?.('advTechTile', tile)}
              title={advTechTileName(tile)}
            >
              <img className="tile-img" src={advTechTileImage(tile)} alt={advTechTileName(tile)} />
            </button>
          );
        })}

        {/* LF：QIC 覆盖板盖住右下角 3 个绿水晶行动格（规则：引入飞船后绿水晶行动失效，
            引擎侧 board-actions 已同步禁用；覆盖板同时印刷新改造项 proto/asteroid 说明） */}
        {state.config.lostFleet === true ? (
          <img
            className="qic-cover overlay"
            data-testid="qic-cover"
            style={{
              left: `${QIC_COVER_RECT.x0 * 100}%`,
              top: `${QIC_COVER_RECT.y0 * 100}%`,
              width: `${((QIC_COVER_RECT.x1 - QIC_COVER_RECT.x0) * 100).toFixed(2)}%`,
              height: `${((QIC_COVER_RECT.y1 - QIC_COVER_RECT.y0) * 100).toFixed(2)}%`,
            }}
            src={QIC_COVER_IMAGE}
            alt="QIC 覆盖板（失落舰队）"
            title="失落舰队：绿水晶行动被覆盖失效"
          />
        ) : null}

        {/* power / qic 行动格（透明热区；已用叠 action token + 置灰）。
            选择态内命中字段 → onPick；未在选择态但行动合法 → 直接点击发起（onBoardAction）。
            LF 下 qic 格被覆盖板盖住，不再渲染热区 */}
        {BOARD_ACTION_ORDER.filter((id) => state.config.lostFleet !== true || !id.startsWith('qic')).map((id) => {
          const used = board.boardActionsUsed.includes(id);
          const categoryOk =
            (activeCategory === 'power' && id.startsWith('power')) ||
            (activeCategory === 'qic' && id.startsWith('qic'));
          const can = categoryOk && pickable('action', id) && !used;
          const direct = !can && !used && availableActions?.has(id) === true;
          return (
            <button
              key={id}
              type="button"
              className={`board-action-cell overlay${used ? ' used' : ''}${can ? ' pickable' : ''}${direct ? ' direct' : ''}`}
              style={{ ...at(BOARD_ACTION_SLOTS[id]), width: `${ACTION_ZONE_SIZE * 100}%` }}
              data-testid={`board-action-${id}`}
              disabled={!can && !direct}
              onClick={can ? () => onPick?.('action', id) : direct ? () => onBoardAction?.(id) : undefined}
              title={boardActionLabel(id)}
            >
              {used ? (
                <img
                  className="action-token"
                  src={ACTION_TOKEN_IMAGE}
                  alt="已用"
                  style={{ width: `${(ACTION_TOKEN_SIZE / ACTION_ZONE_SIZE) * 100}%` }}
                />
              ) : null}
            </button>
          );
        })}
        </div>
      </div>

      {/* 扩展区：联邦标记供应 */}
      <div className="rb-extension">
        {/* 联邦标记供应（图）：单行放下，标记随数量等比缩小（fedTokenMaxWidth）；无文字标签 */}
        <div className="fed-supply" data-testid="fed-supply">
          {(() => {
            // 格伦星人专属联邦片不在公共供应展示（实体上放在格伦星人族板 PI 格右侧的
            // 印刷联邦徽章位——PlayerMat 的 gleensFedSlot，PI 建成时获得）
            const supplied = (Object.entries(board.federationTokens) as [string, number][]).filter(
              ([id, n]) => n > 0 && id !== 'gleens',
            );
            return supplied.map(([id, n]) => {
              const canFedPick = fedTokenOptions?.has(id) === true && onFedTokenPick !== undefined;
              return (
                <span
                  key={id}
                  className={`fed-item${canFedPick ? ' fed-pickable' : ''}`}
                  data-fed={id}
                  data-testid={`fed-supply-${id}`}
                  style={{ maxWidth: fedTokenMaxWidth(supplied.length, 6) }}
                  title={`${federationTokenName(id as never)}（剩 ${n}）${canFedPick ? '：点击选为联邦标记' : ''}`}
                  onClick={canFedPick ? () => onFedTokenPick(id as never) : undefined}
                >
                  <img className="tile-img fed" src={federationTokenImage(id as never)} alt={federationTokenName(id as never)} />
                  <span className="fed-count">×{n}</span>
                </span>
              );
            });
          })()}
        </div>
      </div>
    </aside>
  );
}
