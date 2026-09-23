/**
 * 计分表：按回合顺位列出玩家（ faction / VP / pass 状态 / 先手标记 /
 * AI 思考中），供对局画面侧栏与终局结算复用。
 */
import type { ReactElement } from 'react';
import type { PlayerIndex } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import { factionName, playerColor } from './display';

export interface ScoreTableProps {
  state: FilteredState;
  nicknames?: (string | undefined)[] | undefined;
  thinkingSeats?: readonly PlayerIndex[] | undefined;
  /** 本人座位（"我"标记）。 */
  seat?: PlayerIndex | null | undefined;
}

export function ScoreTable({ state, nicknames, thinkingSeats, seat }: ScoreTableProps): ReactElement {
  return (
    <table className="score-table" data-testid="score-table">
      <thead>
        <tr>
          <th>顺位</th>
          <th>玩家</th>
          <th>种族</th>
          <th>VP</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        {state.turnOrder.map((idx, order) => {
          const p = state.players[idx];
          if (p === undefined) return null;
          // currentPlayerIdx 本身就是座位号（不是 turnOrder 下标）——turnOrder 洗牌后
          // 两者不同序，错用会把"行动中"标到 turnOrder[currentPlayerIdx] 那个倒霉座位。
          const isCurrent = state.phase === 'action' && state.currentPlayerIdx === idx;
          const passed = state.passedPlayers.includes(idx);
          return (
            <tr
              key={idx}
              className={`${isCurrent ? 'current' : ''}${passed ? ' passed' : ''}`}
              data-testid={`score-row-${idx}`}
            >
              <td>{order + 1}</td>
              <td>
                <span className="faction-chip" style={{ background: playerColor(state, idx) }} aria-hidden="true" />
                {nicknames?.[idx] ?? `玩家 ${idx + 1}`}
                {seat === idx ? <span className="me-chip">（我）</span> : null}
                {state.firstPlayer === idx ? <span className="first-chip" title="下轮先手">先</span> : null}
              </td>
              <td>{factionName(p.faction)}</td>
              <td data-testid={`score-vp-${idx}`}>{p.vp}</td>
              <td>
                {thinkingSeats?.includes(idx) === true ? 'AI 思考中…' : passed ? '已 Pass' : isCurrent ? '行动中' : ''}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
