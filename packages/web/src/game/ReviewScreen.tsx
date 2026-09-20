/**
 * 复盘回放画面：导入对局记录后的全屏只读对局，**布局与对局同构**（左栏视角座位
 * 版图 + 对手 TAB / 中央星图 / 右研究计分栏），行动栏/操作按钮换成回放控制。
 *
 * - 顶栏 = 左区（标题 + 第 x/6 轮 + 「此处开始对局」残局分支）+ 右区（轮到 + 退出复盘，
 *   位置与对局「离开房间」对齐）；
 * - 回放控制条（⏮/◀/播放·暂停/▶/⏭/速度 1×2×4×/可拖进度条 + 步数）置于星图正上方
 *   （center-panel 顶部）；当前步行动描述保留为地图顶部浮动条；
 * - 第一视角座位（review.viewSeat）：左栏上块为其版图，详情按钮前「视角⇄」轮换；
 *   「此处开始对局」把 record 截断到当前步发 branch_game（其余座位 AI 托管）；
 * - 状态机：store.review（step/playing/speed/viewSeat），本地 newGame(config) + 前 step 条
 *   applyAction 重放（replay.ts）；连播由本组件定时器驱动 store.reviewTick()，
 *   拖进度条 = setReviewStep 从头重放到目标步；重放失败显示错误并停止。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { GameState, PlayerIndex } from '@gaia/engine';
import { actorOf, filterStateFor } from '@gaia/protocol';
import { BoardSvg } from '../board/BoardSvg';
import { BoostersStrip } from './BoostersStrip';
import { FleetPanel } from './FleetPanel';
import { LeftRail } from './LeftRail';
import { PlayerMat } from './PlayerMat';
import { ResearchBoard } from './ResearchBoard';
import { ScoreTable } from './ScoreTable';
import { ScoreboardBoard } from './ScoreboardBoard';
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
  const viewSeat = review.viewSeat;
  const stepAction = step > 0 ? record.actions[step - 1] : undefined;

  return (
    <main className="app game-screen review-screen" data-testid="review-screen" data-lf={state.config.lostFleet === true ? '1' : '0'}>
      <header className="game-topbar review-topbar" data-testid="review-topbar">
        <div className="topbar-left">
          <span className="topbar-title">盖亚计划 · 复盘</span>
          <span className="topbar-item" data-testid="review-round-info">
            {state.phase === 'setup' ? '设置阶段' : state.phase === 'game-over' ? '对局结束' : `第 ${state.round} / 6 轮`}
          </span>
          <button
            type="button"
            className="top-act"
            data-testid="review-start-here"
            disabled={state.phase === 'game-over'}
            title={state.phase === 'game-over' ? '终局面不可实战' : '以当前局面为残局开新房间（其余座位 AI 托管）'}
            onClick={() => store.startFromReview()}
          >
            此处开始对局
          </button>
        </div>
        <div className="topbar-center" />
        <div className="topbar-leave">
          <span className="topbar-item actor" data-testid="review-actor">
            {actor !== null ? `轮到：${displayNames[actor] ?? `玩家 ${actor + 1}`}` : '对局结束'}
          </span>
          <button type="button" className="top-act leave" data-testid="review-exit" onClick={() => store.exitReview()}>
            退出复盘
          </button>
        </div>
      </header>

      <div className="game-main" data-players={state.players.length}>
        {/* 左栏：与对局同构（上 = 视角座位版图 + 面板/助推片；下 = 对手版图 TAB 切换） */}
        <LeftRail
          state={filtered}
          seat={viewSeat}
          nicknames={displayNames}
          actor={actor}
          thinkingSeats={[]}
          onShowDetail={(p) => setDetailPlayer(p)}
          onCycleViewSeat={() => store.setReviewViewSeat(((viewSeat + 1) % state.players.length) as PlayerIndex)}
        />

        {/* 中央：回放控制条（星图正上方）+ 星图（只读）+ 底部舰队/助推器池 */}
        <section className="center-panel">
          <div className="review-controls-bar" data-testid="review-controls">
            <button type="button" data-testid="review-first" disabled={step === 0} title="开头" onClick={() => store.setReviewStep(0)}>
              ⏮
            </button>
            <button type="button" data-testid="review-prev" disabled={step === 0} title="上一步（长按连退）" onClick={() => stepBy(-1)} {...prevHold}>
              ◀
            </button>
            <button type="button" data-testid="review-play" title={review.playing ? '暂停' : '播放'} onClick={() => store.reviewTogglePlay()}>
              {review.playing ? '⏸' : '▶'}
            </button>
            <button type="button" data-testid="review-next" disabled={step >= total} title="下一步（长按连播）" onClick={() => stepBy(1)} {...nextHold}>
              ▶
            </button>
            <button type="button" data-testid="review-last" disabled={step >= total} title="结尾" onClick={() => store.setReviewStep(total)}>
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
          </div>

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
            <ScoreboardBoard state={filtered} nicknames={displayNames} seat={viewSeat} />
            <div className="scoreboard-ext-row">
              <span className="scoreboard-misc" data-testid="scoring-round-info">
                回合 {state.round}/6
              </span>
              <span className="scoreboard-misc">
                先手：{displayNames[state.firstPlayer] ?? `玩家 ${state.firstPlayer + 1}`}
              </span>
            </div>
            <ScoreTable state={filtered} nicknames={displayNames} thinkingSeats={[]} seat={viewSeat} />
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
