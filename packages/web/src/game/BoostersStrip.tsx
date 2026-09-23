/**
 * 助推器池横条（中央底部横条左侧）：供应池各助推器图横排 + 已被玩家拿走的
 * 置灰展示。选择态字段为 booster 时（setup 选助推器 / Pass 换助推器）命中
 * 项可点击，走 interactions 状态机 onPick。
 */
import type { ReactElement } from 'react';
import type { BoosterId } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import { boosterImage } from '../assets';
import { boosterName } from './display';

export interface BoostersStripProps {
  state: FilteredState;
  /** 当前选择问题字段 key（'booster' 时供应池可点）。 */
  activeField?: string | null | undefined;
  /** 当前字段可选值集合。 */
  activeOptions?: ReadonlySet<string> | null | undefined;
  onPick?: ((fieldKey: string, value: string) => void) | undefined;
}

export function BoostersStrip({ state, activeField, activeOptions, onPick }: BoostersStripProps): ReactElement {
  const taken = state.players.map((p) => p.booster).filter((b): b is BoosterId => b !== null);
  const pickable = (b: BoosterId): boolean =>
    activeField === 'booster' && activeOptions?.has(b) === true && onPick !== undefined;
  return (
    <div className="boosters-strip" data-testid="boosters-strip">
      <span className="boosters-label">助推器池</span>
      <div className="boosters-row">
        {state.board.boosters.map((b) => {
          const can = pickable(b);
          return (
            <button
              key={b}
              type="button"
              className={`booster-tile${can ? ' pickable' : ''}`}
              data-testid={`booster-${b}`}
              disabled={!can}
              title={boosterName(b)}
              onClick={can ? () => onPick?.('booster', b) : undefined}
            >
              <img src={boosterImage(b)} alt={boosterName(b)} />
            </button>
          );
        })}
        {taken.map((b, i) => (
          <span key={`${b}-${i}`} className="booster-tile taken" data-testid={`booster-taken-${b}`} title={`${boosterName(b)}（已被拿走）`}>
            <img src={boosterImage(b)} alt={boosterName(b)} />
          </span>
        ))}
      </div>
    </div>
  );
}
