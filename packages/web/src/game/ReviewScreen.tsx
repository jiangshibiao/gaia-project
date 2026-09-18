/**
 * 复盘回放画面：导入对局记录后的全屏只读对局，**行动栏/操作按钮全部换成回放控制条**。
 *
 * 布局复用 GameScreen 的三栏只读部分（PlayerMat / BoardSvg / FleetPanel /
 * BoostersStrip / ResearchBoard / RoundArc / AdvExtension / FinalsProgress /
 * ScoreTable），全部以回放状态渲染：不接选择机、无拖拽、无高亮、无行动按钮。
 *
 * - 顶栏 = 回放控制条：⏮ 开头 / ◀ 上一步（长按连退）/ 播放·暂停 / ▶ 下一步
 *   （长按连播）/ ⏭ 结尾 / 速度 1×2×4× / 可拖进度条 + 步数 / 退出复盘；
 * - 行动栏区域（地图顶部浮动条）= 当前步行动描述与行动者（复用 display.ts
 *   的 describeAction）；
 * - 状态机：store.review（step/playing/speed），本地 newGame(config) + 前 step 条
 *   applyAction 重放（replay.ts）；连播由本组件定时器驱动 store.reviewTick()，
 *   拖进度条 = setReviewStep 从头重放到目标步；重放失败显示错误并停止。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { GameState, PlayerIndex } from '@gaia/engine';
import { actorOf, filterStateFor } from '@gaia/protocol';
import { BoardSvg } from '../board/BoardSvg';
import { AdvExtension } from './AdvExtension';
import { BoostersStrip } from './BoostersStrip';
import { FinalsProgress } from './FinalsProgress';
import { FleetPanel } from './FleetPanel';
import { PlayerMat } from './PlayerMat';
import { ResearchBoard } from './ResearchBoard';
import { RoundArc } from './RoundArc';
import { ScoreTable } from './ScoreTable';
import { describeAction, factionName } from './display';
import { replayFrame } from './replay';
import { useGameStore } from './store';
import type { GameStore, ReviewSpeed } from './store';

const SPEEDS: readonly ReviewSpeed[] = [1, 2, 4];
/** 连播基础间隔（1× 毫秒/步；2×、4× 等比加快）。 */
const BASE_TICK_MS = 1200;
/** 长按连发：按下 400ms 后开始每 150ms 连发（单击本身走 onClick，不重复计数）。 */
const HOLD_DELAY_MS = 400;
const HOLD_REPEAT_MS = 150;

/** 长按连发 handlers：返回铺到按钮上的指针事件（onClick 仍承担单击步进）。 */
function useHoldRepeat(action: () => void): {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
} {
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stop = (): void => {
    if (delayRef.current !== null) {
      clearTimeout(delayRef.current);
      delayRef.current = null;
    }
    if (repeatRef.current !== null) {
      clearInterval(repeatRef.current);
      repeatRef.current = null;
    }
  };
  const onPointerDown = (): void => {
    stop();
    delayRef.current = setTimeout(() => {
      repeatRef.current = setInterval(action, HOLD_REPEAT_MS);
    }, HOLD_DELAY_MS);
  };
  // 组件卸载时兜底清理
  useEffect(() => stop, []);
  return { onPointerDown, onPointerUp: stop, onPointerLeave: stop, onPointerCancel: stop };
}

export function ReviewScreen({ store }: { store: GameStore }): ReactElement {
  const review = useGameStore(store).review;
  const [detailPlayer, setDetailPlayer] = useState<PlayerIndex | null>(null);
  const [scoreOpen, setScoreOpen] = useState(false);

  /** 步进 delta 步（供单击与长按连发共用；从 store 现取 step 避免闭包过期）。 */
  const stepBy = (delta: number): void => {
    const r = store.getState().review;
    if (r !== null) store.setReviewStep(r.step + delta);
  };
  const prevHold = useHoldRepeat(() => stepBy(-1));
  const nextHold = useHoldRepeat(() => stepBy(1));

  // 连播定时器：playing 时按速度驱动 reviewTick（到结尾 store 自动停播）
  const playing = review?.playing ?? false;
  const speed = review?.speed ?? 1;
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => store.reviewTick(), Math.round(BASE_TICK_MS / speed));
    return () => clearInterval(timer);
  }, [playing, speed, store]);

  // 本地重放到当前步（重放失败 → 错误帧，界面展示错误并停止）
  const frame = useMemo(() => {
    if (review === null) return null;
    try {
      return { ok: true as const, ...replayFrame(review.record, review.step) };
    } catch (e) {
      return { ok: false as const, error: (e as Error).message };
    }
  }, [review]);

  if (review === null || frame === null) return <></>;
  if (!frame.ok) {
    return (
      <main className="app review-screen review-error-screen" data-testid="review-screen">
        <h1>复盘重放失败</h1>
        <p className="error" data-testid="review-replay-error" role="alert">
          {frame.error}
        </p>
        <button type="button" className="btn-primary" data-testid="review-exit" onClick={() => store.exitReview()}>
          返回大厅
        </button>
      </main>
    );
  }

  const { record, step } = review;
  const total = record.actions.length;
  const state = frame.state;
  const filtered = filterStateFor(state);
  const actor = actorOf(state);
  // GameRecord 不含昵称：以族名相称
  const displayNames = state.players.map((p) => factionName(p.faction));
  const viewSeat = 0 as PlayerIndex;
  const stepAction = step > 0 ? record.actions[step - 1] : undefined;

  return (
    <main className="app game-screen review-screen" data-testid="review-screen">
      <header className="game-topbar review-topbar" data-testid="review-topbar">
        <span className="topbar-title">盖亚计划 · 复盘</span>
        <span className="topbar-item" data-testid="review-round-info">
          {state.phase === 'setup' ? '设置阶段' : state.phase === 'game-over' ? '对局结束' : `第 ${state.round} / 6 轮`}
        </span>

        <div className="topbar-right review-controls" data-testid="review-controls">
          <button
            type="button"
            data-testid="review-first"
            disabled={step === 0}
            title="开头"
            onClick={() => store.setReviewStep(0)}
          >
            ⏮
          </button>
          <button
            type="button"
            data-testid="review-prev"
            disabled={step === 0}
            title="上一步（长按连退）"
            onClick={() => stepBy(-1)}
            {...prevHold}
          >
            ◀
          </button>
          <button
            type="button"
            data-testid="review-play"
            title={review.playing ? '暂停' : '播放'}
            onClick={() => store.reviewTogglePlay()}
          >
            {review.playing ? '⏸' : '▶'}
          </button>
          <button
            type="button"
            data-testid="review-next"
            disabled={step >= total}
            title="下一步（长按连播）"
            onClick={() => stepBy(1)}
            {...nextHold}
          >
            ▶
          </button>
          <button
            type="button"
            data-testid="review-last"
            disabled={step >= total}
            title="结尾"
            onClick={() => store.setReviewStep(total)}
          >
            ⏭
          </button>
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              type="button"
              data-testid={`review-speed-${sp}`}
              className={`review-speed${review.speed === sp ? ' active' : ''}`}
              title={`${sp} 倍速`}
              onClick={() => store.setReviewSpeed(sp)}
            >
              {sp}×
            </button>
          ))}
          <input
            type="range"
            min={0}
            max={total}
            value={step}
            aria-label="回放进度"
            data-testid="review-scrub"
            onChange={(e) => store.setReviewStep(Number(e.target.value))}
          />
          <span className="review-progress" data-testid="review-progress">
            {step}/{total}
          </span>
          <button type="button" className="top-act leave" data-testid="review-exit" onClick={() => store.exitReview()}>
            退出复盘
          </button>
        </div>
      </header>

      <div className="game-main" data-players={state.players.length}>
        {/* 左栏：族板单列（只读，无拖拽） */}
        <aside className="rail-l" data-testid="rail-l">
          {state.players.map((_, i) => (
            <PlayerMat
              key={i}
              state={filtered}
              playerIdx={i}
              nickname={displayNames[i]}
              isMe={false}
              active={actor === i}
              onShowDetail={(p) => setDetailPlayer(p)}
            />
          ))}
        </aside>

        {/* 中央：星图（只读）+ 行动栏区域 = 当前步描述；底部舰队/助推器池 */}
        <section className="center-panel">
          <div className="map-area">
            <BoardSvg state={filtered} />

            {/* 行动栏区域 → 当前步行动描述与行动者 */}
            <div className="map-top-overlay">
              <div className="review-step-bar" data-testid="review-step-bar">
                <span className="review-step-desc" data-testid="review-step-desc">
                  {step === 0 || stepAction === undefined
                    ? '开局'
                    : `#${step} ${displayNames[frame.stepActor ?? -1] ?? '—'}：${describeAction(stepAction)}`}
                </span>
                <span className="review-step-actor" data-testid="review-actor">
                  {actor !== null ? `轮到：${displayNames[actor] ?? `玩家 ${actor + 1}`}` : '对局结束'}
                </span>
              </div>
            </div>
          </div>

          <div className="center-bottom">
            <FleetPanel
              state={filtered}
              seat={viewSeat}
              legalActions={[]}
              onShipAction={() => undefined}
              onExplore={() => undefined}
            />
            <BoostersStrip state={filtered} />
          </div>
        </section>

        {/* 右栏：研究轨道（只读）+ 计分区 */}
        <aside className="rail-r" data-testid="rail-r">
          <ResearchBoard state={filtered} />
          <div className="scoreboard" data-testid="scoreboard">
            <RoundArc state={filtered} />
            <div className="scoreboard-ext-row">
              <span className="scoreboard-misc" data-testid="scoring-round-info">
                回合 {state.round}/6
              </span>
              <AdvExtension state={filtered} />
              <span className="scoreboard-misc">
                先手：{displayNames[state.firstPlayer] ?? `玩家 ${state.firstPlayer + 1}`}
              </span>
              <button
                type="button"
                className="btn-ghost score-toggle"
                data-testid="score-toggle"
                onClick={() => setScoreOpen((v) => !v)}
              >
                计分表 {scoreOpen ? '▴' : '▾'}
              </button>
            </div>
            <FinalsProgress state={filtered} nicknames={displayNames} seat={viewSeat} />
            {scoreOpen ? (
              <div className="score-pop" data-testid="score-pop">
                <ScoreTable state={filtered} nicknames={displayNames} thinkingSeats={[]} seat={viewSeat} />
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      {detailPlayer !== null ? (
        <div className="modal-backdrop" data-testid="player-detail" onClick={() => setDetailPlayer(null)}>
          <div className="modal player-detail-modal" onClick={(e) => e.stopPropagation()}>
            <PlayerMat state={filtered} playerIdx={detailPlayer} nickname={displayNames[detailPlayer]} detailed />
            <button type="button" className="btn-primary" data-testid="close-player-detail" onClick={() => setDetailPlayer(null)}>
              关闭
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
