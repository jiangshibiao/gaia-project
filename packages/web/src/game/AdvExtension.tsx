/**
 * LF 计分板扩展条：第 7 槽高级科技片（v6 右栏计分区，回合弧与终局板之间）。
 *
 * 实体上这张高级科技片放在时代标记（计分板）下方，而非研究板上——故从
 * ResearchBoard 迁出。含解锁条件指示（vp/ships 面，读 board.scoringExtension：
 * 25 胜点 / 探索 3 艘飞船）与拿取交互（选择态命中 advTechTile 字段可点）。
 * 仅 LF（advTechTiles.length > 6）渲染。
 */
import type { ReactElement } from 'react';
import type { FilteredState } from '@gaia/protocol';
import { advConditionImage, advTechTileImage } from '../assets';
import { advTechTileName } from './display';

export interface AdvExtensionProps {
  state: FilteredState;
  /** 当前选择问题的字段 key（null = 纯展示）。 */
  activeField?: string | null | undefined;
  /** 当前字段的可选值集合（命中才可点）。 */
  activeOptions?: ReadonlySet<string> | null | undefined;
  onPick?: ((fieldKey: string, value: string) => void) | undefined;
}

export function AdvExtension({ state, activeField, activeOptions, onPick }: AdvExtensionProps): ReactElement | null {
  const board = state.board;
  if (board.advTechTiles.length <= 6) return null;
  const pickable = (value: string): boolean =>
    activeField === 'advTechTile' && activeOptions?.has(value) === true && onPick !== undefined;
  return (
    <div className="adv-extension" data-testid="adv-extension">
      <img
        className="advcond-img"
        src={advConditionImage(board.scoringExtension ?? 'vp')}
        alt="第 7 高级板槽解锁条件"
        title={board.scoringExtension === 'ships' ? '解锁条件：探索 3 艘飞船' : '解锁条件：25 胜点'}
      />
      {board.advTechTiles.slice(6).map((tile, k) => {
        const i = k + 6;
        if (tile === null) {
          return (
            <span key={i} className="adv-slot empty" data-testid={`adv-slot-${i}`}>
              已拿
            </span>
          );
        }
        const can = pickable(tile);
        return (
          <button
            key={i}
            type="button"
            className={`adv-slot img${can ? ' pickable' : ''}`}
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
  );
}
