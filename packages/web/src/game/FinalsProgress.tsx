/**
 * 终局实时进度（v6 右栏计分区中部）：2 张终局板图 + 每家当前计数与领先标注。
 *
 * 计数直接用引擎导出的 finalCount（终局板 condition 口径，与结算一致）；
 * 领先 = 计数最高且 >0 的所有玩家（并列全部标注「并列领先」）。
 */
import type { ReactElement } from 'react';
import { FINAL_SCORING, finalCount } from '@gaia/engine';
import type { GameState, PlayerIndex } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import { finalScoringImage } from '../assets';
import { finalScoringName, playerColor } from './display';

export interface FinalsProgressProps {
  state: FilteredState;
  nicknames: (string | undefined)[];
  seat: PlayerIndex;
}

/** 各玩家在指定终局条件下的实时计数（引擎口径）。 */
export function finalCounts(state: FilteredState, tileId: keyof typeof FINAL_SCORING): number[] {
  const def = FINAL_SCORING[tileId];
  return state.players.map((_, i) => finalCount(state as GameState, i, def.condition));
}

export function FinalsProgress({ state, nicknames, seat }: FinalsProgressProps): ReactElement {
  return (
    <div className="finals-progress" data-testid="finals-progress">
      {state.board.finalScoring.map((tileId) => {
        const counts = finalCounts(state, tileId);
        const max = Math.max(...counts);
        const order = state.players
          .map((_, i) => i)
          .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0) || a - b);
        const leaders = order.filter((i) => (counts[i] ?? 0) === max && max > 0);
        return (
          <div className="final-item" key={tileId} data-testid={`final-tile-${tileId}`}>
            <div className="final-img" style={{ backgroundImage: `url(${finalScoringImage(tileId)})` }} title={finalScoringName(tileId)} />
            <div className="final-prog">
              <span className="final-name">{finalScoringName(tileId)}</span>
              {order.map((i) => {
                const count = counts[i] ?? 0;
                const lead = leaders.includes(i);
                return (
                  <span
                    key={i}
                    className={`final-count${lead ? ' lead' : ''}`}
                    data-testid={`final-count-${tileId}-${i}`}
                    data-lead={lead || undefined}
                    title={lead ? (leaders.length > 1 ? '并列领先' : '领先') : undefined}
                  >
                    <span className="faction-chip" style={{ background: playerColor(state, i) }} aria-hidden="true" />
                    {nicknames[i] ?? `玩家${i + 1}`}
                    {i === seat ? '（我）' : ''} <b>{count}</b>
                    {lead && leaders.length > 1 ? ' 并列' : null}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
