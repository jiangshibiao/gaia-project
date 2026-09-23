/**
 * 顶栏（三段式）：左 = 盖亚计划标识 + 第 x/6 轮 + 导出对局；
 * 中 = 行动按钮组（含免费兑换/烧脑下拉）；右 = 进度信息（先手/当前行动者/
 * 连接态）+ 离开房间。
 *
 * 行动按钮：主九个（建矿/盖亚计划/升级建筑/研究/组建联邦/探索飞船/魔力行动/
 * 特殊行动/Pass）常驻，当前可用的高亮（.primary 可点），不可用置灰禁用；
 * 情境类别（飞船行动/QIC 行动/检视神器/setup 放起始矿/选助推器）仅可用时出现。
 * 点击走 interactions 状态机（onStartSelection）；免费兑换逐条直发、烧脑单击
 * 直发，收进「兑换 ▾」下拉（不挤占主按钮行）。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { Action, GameState, PlayerIndex } from '@gaia/engine';
import { actorOf } from '@gaia/protocol';
import type { FilteredState } from '@gaia/protocol';
import { conversionLabel, factionName } from './display';
import { availableCategories, findResponse } from './interactions';
import type { CategoryId } from './interactions';

/** 连接状态文案（顶栏右区状态用）。 */
const CONNECTION_LABEL: Record<string, string> = {
  connected: '已连接',
  connecting: '重连中…',
  disconnected: '已断线',
};

/** 常驻主按钮（按草图顺序）：不可用也占位显示（置灰禁用）。 */
const MAIN_CATEGORIES: readonly CategoryId[] = [
  'mine',
  'gaia-project',
  'upgrade',
  'research',
  'federation',
  'explore',
  'power',
  'special',
  'pass',
];

/** 情境按钮：仅当前可用时出现（setup 入口也在这里）。 */
const CONTEXT_CATEGORIES: readonly CategoryId[] = [
  'setup-mine',
  'setup-booster',
  'ship-action',
  'qic',
  'artifact',
];

export interface TopActionBarProps {
  state: FilteredState;
  legalActions: Action[];
  seat: PlayerIndex;
  nicknames: (string | undefined)[];
  connection: string;
  onStartSelection: (category: CategoryId) => void;
  onSubmit: (action: Action) => void;
  onLeave: () => void;
  /** 导出对局记录（对局中/终局均可；未提供时不渲染入口）。 */
  onExport?: (() => void) | undefined;
}

export function TopActionBar({
  state,
  legalActions,
  seat,
  nicknames,
  connection,
  onStartSelection,
  onSubmit,
  onLeave,
  onExport,
}: TopActionBarProps): ReactElement {
  const actor = actorOf(state as GameState);
  const myTurn = actor === seat;
  const available = myTurn ? new Set(availableCategories(legalActions).map((c) => c.id)) : new Set<CategoryId>();

  // 免费兑换/烧脑下拉（仅轮到我且存在时有点击意义）
  const freeConversions = legalActions.filter(
    (a): a is Extract<Action, { type: 'free-conversion' }> => a.type === 'free-conversion',
  );
  const burnAction = findResponse(legalActions, 'burn');
  const [convertOpen, setConvertOpen] = useState(false);
  const convertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!convertOpen) return;
    const onDown = (e: PointerEvent): void => {
      if (convertRef.current !== null && !convertRef.current.contains(e.target as Node)) {
        setConvertOpen(false);
      }
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [convertOpen]);

  const categoryBtn = (id: CategoryId, label: string, contextual: boolean): ReactElement | null => {
    const can = available.has(id);
    if (contextual && !can) return null;
    return (
      <button
        key={id}
        type="button"
        className={`top-act${can ? ' primary' : ''}`}
        data-testid={`action-${id}`}
        disabled={!can}
        onClick={can ? () => onStartSelection(id) : undefined}
      >
        {label}
      </button>
    );
  };

  return (
    <header className="game-topbar" data-testid="top-action-bar">
      <div className="topbar-left">
        <span className="topbar-title">盖亚计划</span>
        <span className="topbar-item" data-testid="round-info">
          {state.phase === 'setup'
            ? '设置阶段'
            : state.phase === 'game-over'
              ? '对局结束'
              : `第 ${state.round} / 6 轮`}
        </span>
        {onExport !== undefined ? (
          <button type="button" className="top-act" data-testid="export-game" title="下载对局记录 JSON（可导入复盘）" onClick={onExport}>
            导出对局
          </button>
        ) : null}
      </div>

      <div className="topbar-center">
        <div className="topbar-actions" data-testid="topbar-actions">
          {MAIN_CATEGORIES.map((id) => {
            const labels: Record<string, string> = {
              mine: '建矿',
              'gaia-project': '盖亚计划',
              upgrade: '升级建筑',
              research: '研究',
              federation: '组建联邦',
              explore: '探索飞船',
              power: '魔力行动',
              special: '特殊行动',
              pass: 'Pass',
            };
            return categoryBtn(id, labels[id] ?? id, false);
          })}
          {CONTEXT_CATEGORIES.map((id) => {
            const labels: Record<string, string> = {
              'setup-mine': '放起始矿',
              'setup-booster': '选助推器',
              'ship-action': '飞船行动',
              qic: 'QIC 行动',
              artifact: '检视神器',
            };
            return categoryBtn(id, labels[id] ?? id, true);
          })}

          <div className="convert-group" ref={convertRef}>
            {/* 兑换下拉不高亮（它不是提示——可用即可，无需招呼；烧脑/兑换在 dropdown 内逐条直发） */}
            <button
              type="button"
              className="top-act"
              data-testid="convert-toggle"
              disabled={!myTurn || (freeConversions.length === 0 && burnAction === undefined)}
              onClick={() => setConvertOpen((v) => !v)}
            >
              兑换 ▾
            </button>
            {convertOpen ? (
              <div className="convert-menu" data-testid="convert-menu">
                {freeConversions.map((a) => (
                  <button
                    key={a.conversion}
                    type="button"
                    className="convert-item"
                    data-testid={`convert-${a.conversion}`}
                    onClick={() => {
                      onSubmit(a);
                      setConvertOpen(false);
                    }}
                  >
                    {conversionLabel(a.conversion)}
                  </button>
                ))}
                {burnAction !== undefined ? (
                  <button
                    type="button"
                    className="convert-item burn"
                    data-testid="action-burn"
                    onClick={() => {
                      onSubmit(burnAction);
                      setConvertOpen(false);
                    }}
                  >
                    烧脑
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="topbar-leave">
        <span className="topbar-item">
          先手：{nicknames[state.firstPlayer] ?? `玩家 ${state.firstPlayer + 1}`}
        </span>
        {actor !== null ? (
          <span className="topbar-item actor" data-testid="actor-info">
            轮到：{nicknames[actor] ?? `玩家 ${actor + 1}`}（{factionName(state.players[actor]?.faction ?? 'terrans')}）
          </span>
        ) : null}
        <span className={`topbar-item conn ${connection}`} data-testid="conn-status">
          {CONNECTION_LABEL[connection] ?? connection}
        </span>
        <button type="button" className="top-act leave" data-testid="leave-game" onClick={onLeave}>
          离开房间
        </button>
      </div>
    </header>
  );
}
