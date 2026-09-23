/**
 * 行动对话浮层（地图顶部浮动条，不挡棋盘交互）：
 * 选择对话框（选项/列表）+ pending 决策条（charge/decline、tinkering、
 * terrans/itars 盖亚决策、gain-tech-tile、free-mine）+ 等待提示。
 *（setup 阶段不设文字横幅——放置引导仅靠棋盘 hex 高亮。）
 *
 * 类别按钮已移至 TopActionBar（顶栏）；本组件只负责"选择进行中"与
 * "pending/setup"的展示与响应。交互流：
 * 1. currentQuestion 为 choice 字段 → 渲染选项按钮；为 hex 字段 →
 *    提示"在棋盘点选"（GameScreen 把棋盘点击路由回 pick）；hex 问题的
 *    null 选项（如 free-mine 跳过）在此渲染为按钮；
 * 2. 选择完整 → GameScreen.tryDirectSubmit 直接提交（无确认条，后悔走撤销条）。
 * 联邦类别为列表模式：完整枚举逐条列出（"N 星球+M 卫星 → 标记名"）。
 */
import type { ReactElement } from 'react';
import type { Action, GameState, PlayerIndex } from '@gaia/engine';
import { actorOf } from '@gaia/protocol';
import type { FilteredState } from '@gaia/protocol';
import { tinkeringTileImage } from '../assets';
import { factionName } from './display';
import {
  categoryDef,
  currentQuestion,
  describeCandidate,
  findResponse,
} from './interactions';
import type { Selection } from './interactions';

export interface ActionBarProps {
  state: FilteredState;
  legalActions: Action[];
  seat: PlayerIndex;
  selection: Selection | null;
  onPick: (fieldKey: string, value: string | null) => void;
  onCancelSelection: () => void;
  onSubmit: (action: Action) => void;
}

export function ActionBar({
  state,
  legalActions,
  seat,
  selection,
  onPick,
  onCancelSelection,
  onSubmit,
}: ActionBarProps): ReactElement {
  const actor = actorOf(state as GameState);
  const myTurn = actor === seat;
  const pending = state.pending;

  // ---- 选择进行中：选项对话框 / 棋盘提示（确认条已废——选择完整即由
  // GameScreen.tryDirectSubmit 直接提交，本组件不会再见到 isReady 的选择） ----
  if (selection !== null) {
    const def = categoryDef(selection.category);

    // 列表模式（联邦）：完整枚举直选
    if (def.mode === 'list') {
      return (
        <div className="action-bar" data-testid="action-bar">
          <div className="selection-dialog" data-testid="selection-dialog">
            <header className="dialog-head">
              <span>{def.label}：选择一个联邦方案（共 {selection.candidates.length} 个）</span>
              <button type="button" className="btn-ghost" data-testid="selection-cancel" onClick={onCancelSelection}>
                取消
              </button>
            </header>
            <ul className="candidate-list" data-testid="candidate-list">
              {selection.candidates.map((a, i) => (
                <li key={i}>
                  <button type="button" className="candidate-item" onClick={() => onSubmit(a)}>
                    {describeCandidate(a)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    }

    const q = currentQuestion(selection);
    if (q === null) {
      // 候选 >1 但无区分字段（字段表未覆盖的退化情形）：列表直选兜底
      return (
        <div className="action-bar" data-testid="action-bar">
          <div className="selection-dialog" data-testid="selection-dialog">
            <header className="dialog-head">
              <span>{def.label}：选择一项</span>
              <button type="button" className="btn-ghost" data-testid="selection-cancel" onClick={onCancelSelection}>
                取消
              </button>
            </header>
            <ul className="candidate-list">
              {selection.candidates.map((a, i) => (
                <li key={i}>
                  <button type="button" className="candidate-item" onClick={() => onSubmit(a)}>
                    {describeCandidate(a)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    }

    return (
      <div className="action-bar" data-testid="action-bar">
        <div className="selection-dialog" data-testid="selection-dialog">
          <header className="dialog-head">
            <span>
              {def.label} → {q.field.label}
              {q.field.kind === 'hex' ? '（在棋盘点选高亮格）' : ''}
            </span>
            <button type="button" className="btn-ghost" data-testid="selection-cancel" onClick={onCancelSelection}>
              取消
            </button>
          </header>
          {q.field.kind === 'choice' || q.options.some((o) => o.value === null) ? (
            <div className="option-grid" data-testid="option-grid">
              {q.options
                .filter((o) => q.field.kind === 'choice' || o.value === null)
                .map((o) => (
                  <button
                    key={o.value ?? 'null'}
                    type="button"
                    className="option-btn"
                    data-testid={`option-${o.value ?? 'null'}`}
                    onClick={() => onPick(q.field.key, o.value)}
                  >
                    {selection.category === 'tinkering' && o.value !== null ? (
                      <>
                        <img className="tinkering-tile-img" src={tinkeringTileImage(o.value)} alt={o.label} />
                        <span>{o.label}</span>
                      </>
                    ) : (
                      o.label
                    )}
                  </button>
                ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ---- 未在选择中：pending / setup / 等待提示 ----
  const chargeOffer =
    pending?.kind === 'charge' && pending.queue[0]?.player === seat ? pending.queue[0] : null;
  const chargeAction = findResponse(legalActions, 'charge');
  const declineAction = findResponse(legalActions, 'decline-charge');
  const terransDone = findResponse(legalActions, 'terrans-gaia-done');
  const incomeTokensFirst = legalActions.find(
    (a): a is Extract<Action, { type: 'income-order' }> => a.type === 'income-order' && a.order === 'tokens-first',
  );
  const incomeChargeFirst = legalActions.find(
    (a): a is Extract<Action, { type: 'income-order' }> => a.type === 'income-order' && a.order === 'charge-first',
  );

  // 蹭能显示量 = min(邀约量, 实际可充 token 数)：计费按实际充入量−1，显示同步封顶；
  // taklons PI 会先 +1 token 计入。引擎邀约量保持建筑 pv 原文（重放兼容），
  // 不能直接用于显示（可充数不足时按原文会虚高）。
  const chargeableTokens = (idx: PlayerIndex): number => {
    const pw = state.players[idx]?.power;
    if (pw === undefined) return 0;
    const taklonsPi = state.players[idx]?.faction === 'taklons' && state.players[idx]?.buildings.pi === 0;
    return pw.bowl1 + pw.bowl2 + (pw.brainstone === 'bowl1' || pw.brainstone === 'bowl2' ? 1 : 0) + (taklonsPi ? 1 : 0);
  };
  const chargeDisplay =
    chargeOffer !== null
      ? { amount: Math.min(chargeOffer.amount, chargeableTokens(chargeOffer.player)) }
      : null;

  const pendingText = (() => {
    if (pending === null) return null;
    switch (pending.kind) {
      case 'charge':
        return chargeDisplay !== null
          ? `对手在附近建矿：你可充能 ${chargeDisplay.amount} 能量（代价 ${Math.max(0, chargeDisplay.amount - 1)} 分）`
          : `等待对手响应充能邀约（${pending.queue.length} 人）…`;
      case 'itars-gaia':
        return pending.player === seat ? '伊塔星人盖亚阶段：可弃 4 盖亚能量换科技板' : '等待伊塔星人盖亚阶段决策…';
      case 'terrans-gaia':
        return pending.player === seat ? '人类盖亚阶段：可把盖亚区能量兑换为资源' : '等待人类盖亚阶段决策…';
      case 'tinkering':
        return pending.player === seat ? '焊修智械：选择本轮修补板块' : '等待焊修智械选板块…';
      case 'gain-tech-tile':
        return pending.player === seat ? '选择 1 块科技板' : '等待对手选择科技板…';
      case 'free-mine':
        return pending.player === seat ? '免费建矿：在棋盘点选目标格（或跳过）' : '等待对手免费建矿…';
      case 'income-order': {
        if (pending.player !== seat) return '等待对手结算收入…';
        const pw = state.players[pending.player]?.power;
        const bowls = pw !== undefined ? `（当前 I ${pw.bowl1} · II ${pw.bowl2} · III ${pw.bowl3}）` : '';
        return `收入结算顺序${bowls}：+${pending.tokens} 魔力豆 与 充能 ${pending.charge} 谁先？`;
      }
      default:
        return null;
    }
  })();

  // 无任何提示时不占位（浮动条整体隐藏）。回合完成只有地图下方撤销条一个入口
  // （turnhold 期间 confirm-turn 可用时 actor=me，同样隐藏）。
  if (pendingText === null && (myTurn || actor === null)) {
    return <div className="action-bar idle" data-testid="action-bar" hidden />;
  }

  return (
    <div className="action-bar" data-testid="action-bar">
      {pendingText !== null ? (
        <div className="pending-banner" data-testid="pending-banner">
          <span>{pendingText}</span>
          {chargeDisplay !== null && chargeAction !== undefined ? (
            <button type="button" className="btn-primary" data-testid="charge-accept" onClick={() => onSubmit(chargeAction)}>
              充能（-{Math.max(0, chargeDisplay.amount - 1)} 分）
            </button>
          ) : null}
          {chargeOffer !== null && declineAction !== undefined ? (
            <button type="button" className="btn-ghost" data-testid="charge-decline" onClick={() => onSubmit(declineAction)}>
              放弃
            </button>
          ) : null}
          {terransDone !== undefined ? (
            <button type="button" className="btn-primary" data-testid="terrans-done" onClick={() => onSubmit(terransDone)}>
              结束兑换
            </button>
          ) : null}
          {pending?.kind === 'income-order' && pending.player === seat ? (
            <>
              {incomeTokensFirst !== undefined ? (
                <button
                  type="button"
                  className="btn-primary"
                  data-testid="income-tokens-first"
                  onClick={() => onSubmit(incomeTokensFirst)}
                >
                  先拿豆 +{pending.tokens}
                </button>
              ) : null}
              {incomeChargeFirst !== undefined ? (
                <button
                  type="button"
                  className="btn-primary"
                  data-testid="income-charge-first"
                  onClick={() => onSubmit(incomeChargeFirst)}
                >
                  先充能 {pending.charge}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {!myTurn ? (
        <div className="waiting-line" data-testid="waiting-line">
          {actor === null
            ? '对局已结束'
            : `等待 ${factionName(state.players[actor]?.faction ?? 'terrans')}（座位 ${actor + 1}）行动…`}
        </div>
      ) : null}
    </div>
  );
}
