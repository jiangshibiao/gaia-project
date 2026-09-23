/**
 * 计分板（实图版）：用户自拍抠图的实体计分板整图（含外圈行星装饰），
 * 按 scoreboard-calibration 相对坐标叠加：
 * - 6 张回合计分片：扇形槽位、径向旋转，当前轮金框、过往轮置灰（板面已印
 *   数字圆与中央绿星球，不再自绘母星环/数字/星球）；
 * - 2 张终局计分片：方形区右侧灰面板槽；
 * - 终局实时进度：绿色计数轨上按 count（0..10 截断）放玩家色圆点
 *   （引擎 finalCount 口径；领先者金圈，并列同标）；
 * - LF：主板下方接梯形扩展片（按 board.scoringExtension 选面，解锁条件已印刷），
 *   其上是第 7 高级科技片槽（选择态命中 advTechTile 可拿）。
 */
import type { CSSProperties, ReactElement } from 'react';
import { FINAL_SCORING, finalCount } from '@gaia/engine';
import type { GameState, PlayerIndex } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import { SCOREBOARD_BASE_IMAGE, advTechTileImage, finalScoringImage, roundScoringImage, scoreboardExtImage } from '../assets';
import { advTechTileName, finalScoringName, playerColor, roundScoringName } from './display';
import {
  SB_EXT_ADV_SLOT,
  SB_EXT_WIDTH_FRAC,
  SB_FINAL_MARKER,
  SB_FINAL_ROWS,
  SB_FINAL_SLOTS,
  SB_ROUND_SLOTS,
} from './scoreboard-calibration';

/** 各玩家在指定终局条件下的实时计数（引擎口径）。 */
export function finalCounts(state: FilteredState, tileId: keyof typeof FINAL_SCORING): number[] {
  const def = FINAL_SCORING[tileId];
  return state.players.map((_, i) => finalCount(state as GameState, i, def.condition));
}

export interface ScoreboardBoardProps {
  state: FilteredState;
  nicknames: readonly (string | undefined)[];
  seat: PlayerIndex;
  /** 当前选择问题的字段 key（null = 纯展示）。 */
  activeField?: string | null | undefined;
  /** 当前字段的可选值集合（命中才可点）。 */
  activeOptions?: ReadonlySet<string> | null | undefined;
  onPick?: ((fieldKey: string, value: string) => void) | undefined;
}

export function ScoreboardBoard({ state, nicknames, seat, activeField, activeOptions, onPick }: ScoreboardBoardProps): ReactElement {
  const board = state.board;
  const gameOver = state.phase === 'game-over';
  const pickableAdv = (value: string): boolean =>
    activeField === 'advTechTile' && activeOptions?.has(value) === true && onPick !== undefined;

  return (
    <div className="scoreboard-board" data-testid="scoreboard-board">
      {/* 主板+梯形片纵向栈（高度自适应，富余空间留给下方常驻计分表） */}
      <div className={`sb-stack${state.config.lostFleet === true ? ' lf' : ''}`}>
        <div className="sb-base">
          <img className="sb-base-img" src={SCOREBOARD_BASE_IMAGE} alt="计分板" />

        {/* 6 张回合计分片（扇形槽、径向旋转；当前轮金框、过往置灰） */}
        {board.roundScoring.map((t, i) => {
          const slot = SB_ROUND_SLOTS[i];
          if (slot === undefined) return null;
          const cur = !gameOver && state.round === i + 1;
          const past = gameOver || state.round > i + 1;
          const style: CSSProperties = {
            left: `${slot.x * 100}%`,
            top: `${slot.y * 100}%`,
            width: `${slot.w * 100}%`,
            transform: `translate(-50%, -50%) rotate(${slot.rot}deg)`,
          };
          return (
            <img
              key={`${t}-${i}`}
              className={`sb-round-tile${cur ? ' cur' : ''}${past ? ' past' : ''}`}
              style={style}
              src={roundScoringImage(t)}
              alt={roundScoringName(t)}
              title={`第 ${i + 1} 轮：${roundScoringName(t)}`}
              data-testid={`round-arc-tile-${i + 1}`}
            />
          );
        })}

        {/* 2 张终局计分片（右侧灰面板槽） */}
        {board.finalScoring.map((f, i) => {
          const slot = SB_FINAL_SLOTS[i];
          if (slot === undefined) return null;
          return (
            <img
              key={f}
              className="sb-final-tile"
              style={{ left: `${slot.x * 100}%`, top: `${slot.y * 100}%`, width: `${slot.w * 100}%` }}
              src={finalScoringImage(f)}
              alt={finalScoringName(f)}
              title={finalScoringName(f)}
              data-testid={`final-tile-${f}`}
            />
          );
        })}

        {/* 终局实时进度：绿轨上按 count 放玩家色点（0..10 截断；同 count 纵向错开） */}
        <div className="finals-progress" data-testid="finals-progress">
          {board.finalScoring.map((tileId, row) => {
            const track = SB_FINAL_ROWS[row];
            if (track === undefined) return null;
            const counts = finalCounts(state, tileId);
            const max = Math.max(...counts);
            return counts.map((count, i) => {
              const clamped = Math.max(0, Math.min(10, count));
              const x = track.x0 + (clamped / 10) * (track.x1 - track.x0);
              const lead = count === max && max > 0;
              const style: CSSProperties = {
                left: `${x * 100}%`,
                top: `${track.y * 100}%`,
                width: `${SB_FINAL_MARKER * 100}%`,
                background: playerColor(state, i),
              };
              return (
                <span
                  key={`${tileId}-${i}`}
                  className={`sb-final-marker${lead ? ' lead' : ''}`}
                  style={style}
                  data-testid={`final-count-${tileId}-${i}`}
                  data-count={count}
                  data-lead={lead || undefined}
                  title={`${finalScoringName(tileId)}：${nicknames[i] ?? `玩家${i + 1}`}${i === seat ? '（我）' : ''} ${count}${lead ? '（领先）' : ''}`}
                />
              );
            });
          })}
        </div>
      </div>

      {/* LF：梯形扩展片（解锁条件已印刷）+ 第 7 高级科技片槽 */}
      {state.config.lostFleet === true ? (
        <div className="sb-ext" style={{ width: `${SB_EXT_WIDTH_FRAC * 100}%` }}>
          <img
            className="sb-ext-img"
            src={scoreboardExtImage(board.scoringExtension ?? 'vp')}
            alt={board.scoringExtension === 'ships' ? '扩展计分片（探索 3 船解锁）' : '扩展计分片（25 胜点解锁）'}
            title={board.scoringExtension === 'ships' ? '第 7 高级板解锁条件：探索 3 艘飞船' : '第 7 高级板解锁条件：25 胜点'}
          />
          <div className="adv-extension" data-testid="adv-extension">
            {board.advTechTiles.slice(6).map((tile, k) => {
              const i = k + 6;
              if (tile === null) {
                return (
                  <span
                    key={i}
                    className="adv-slot empty"
                    style={{ left: `${SB_EXT_ADV_SLOT.x * 100}%`, top: `${SB_EXT_ADV_SLOT.y * 100}%`, width: `${SB_EXT_ADV_SLOT.w * 100}%` }}
                    data-testid={`adv-slot-${i}`}
                  >
                    已拿
                  </span>
                );
              }
              const can = pickableAdv(tile);
              return (
                <button
                  key={i}
                  type="button"
                  className={`adv-slot img${can ? ' pickable' : ''}`}
                  style={{ left: `${SB_EXT_ADV_SLOT.x * 100}%`, top: `${SB_EXT_ADV_SLOT.y * 100}%`, width: `${SB_EXT_ADV_SLOT.w * 100}%` }}
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
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
