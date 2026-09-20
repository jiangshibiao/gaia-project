/**
 * 对局画面（v6 布局重构）：**顶栏 + 左族板栏 + 中央星图 + 右研究/计分栏**。
 *
 * - 顶栏（TopActionBar）：左 = 标识 + 进度信息（轮次/本轮计分/终局/先手/
 *   当前行动者/连接态）；右 = 行动按钮组（当前可用高亮）+ 兑换下拉 + 离开房间；
 * - 左栏（v7 两块布局，LeftRail）：上 = 我的版图 + 科技/推进实图小横条；
 *   下 = 对手版图（TAB 细条切换，当前行动者带指示点；2 人局免 TAB）；
 *   宽度 --mat-w（较 v6 略收窄让地图更宽），当前行动者高亮边框，
 *   点击"详情"弹完整面板 modal；
 * - 中央：BoardSvg 星图占满剩余高度（滚轮缩放/拖拽平移/双击复位/hex 交互/
 *   拖拽建矿升级不变）；底部横条 = 左助推器池（BoostersStrip）+ 右舰队 2×2
 *   （FleetPanel，v7 右移）；pending/setup/选择对话为地图顶部浮动条（ActionBar）；
 *   事件日志为地图左下角可折叠浮层；
 * - 右栏：上 = 研究轨道整图（ResearchBoard，ResizeObserver 动态 scale）；
 *   下 = 计分区（ScoreboardBoard 实图计分板：回合计分片入扇形槽 + 终局片入灰面板槽
 *   + 绿轨计数点 + LF 梯形扩展片/第 7 高级板槽；下方常驻计分表 ScoreTable）。
 *
 * 选择状态机协作（不变）：
 * - 本组件持有 selection（interactions.Selection），新快照（seq 变化）自动清空；
 * - 棋盘点击：当前问题为 hex 字段且命中高亮 → pick；
 * - ResearchBoard 的元素点击（track/action/techTile/advTechTile）同样路由进 pick；
 * - FleetPanel 的船行动格/探索按钮 → startSelection 后预填 ship/action 字段，
 *   剩余字段（hex/track 等）照常由棋盘高亮/选项框追问；
 * - 候选收窄到唯一 → 确认条 → store.submitAction(原对象)。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { FACTIONS, FINAL_RANK_VP, FINAL_SCORING, finalCount } from '@gaia/engine';
import type { Action, BoardActionId, BuildingType, FinalTileId, GameState, HexKey, PlayerIndex, ShipActionId, ShipId } from '@gaia/engine';
import { actorOf } from '@gaia/protocol';
import type { FilteredState } from '@gaia/protocol';
import { BUILDING_COLOR_FILTER, buildingImage } from '../assets';
import { BoardSvg } from '../board/BoardSvg';
import type { BoardSvgHandle } from '../board/BoardSvg';
import { ActionBar } from './ActionBar';
import { BoostersStrip } from './BoostersStrip';
import { FleetPanel } from './FleetPanel';
import { LeftRail } from './LeftRail';
import { PlayerMat } from './PlayerMat';
import { ResearchBoard } from './ResearchBoard';
import { ScoreTable } from './ScoreTable';
import { ScoreboardBoard } from './ScoreboardBoard';
import { TopActionBar } from './TopActionBar';
import { describeAction, factionName, finalScoringName } from './display';

/** 连接状态文案（右栏状态行用）。 */
const CONNECTION_LABEL: Record<string, string> = {
  connected: '已连接',
  connecting: '重连中…',
  disconnected: '已断线',
};
import { applyDragDrop, planDrag, snapHex } from './drag';
import type { DragBuilding, DragPlan } from './drag';
import { currentQuestion, hexTargets, pick, startSelection } from './interactions';
import type { CategoryId, Selection } from './interactions';
import { useGameStore } from './store';
import type { GameStore } from './store';

/**
 * 某张终局计分板给各玩家带来的 vp（复刻 engine finalScoring 的排名/平分逻辑：
 * 计数降序排名，同名次平分该区间 FINAL_RANK_VP 均值；计数 0 不得分；
 * ≤2 人局加中立占位）。仅供结算画面展示，与引擎结算口径一致。
 */
function finalTileVp(state: FilteredState, tileId: FinalTileId): number[] {
  const def = FINAL_SCORING[tileId];
  const entries: { player: PlayerIndex | null; count: number }[] = state.players.map((_, i) => ({
    player: i,
    count: finalCount(state as GameState, i, def.condition),
  }));
  if (state.config.playerCount <= 2 && def.neutralValue !== null) {
    entries.push({ player: null, count: def.neutralValue });
  }
  entries.sort((a, b) => b.count - a.count);
  const vp = state.players.map(() => 0);
  for (const e of entries) {
    if (e.player === null || e.count === 0) continue;
    const first = entries.findIndex((x) => x.count === e.count);
    const ties = entries.filter((x) => x.count === e.count).length;
    vp[e.player] = Math.floor(
      FINAL_RANK_VP.slice(first, first + ties).reduce((sum, v) => sum + v, 0) / ties,
    );
  }
  return vp;
}

export function GameScreen({ store }: { store: GameStore }): ReactElement {
  const s = useGameStore(store);
  const state = s.snapshot;
  const seat = s.seat;
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailPlayer, setDetailPlayer] = useState<PlayerIndex | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [overDismissed, setOverDismissed] = useState(false);

  // 面板建筑拖拽（建矿/升级）：pointerdown 发起（plan 随拖随定），
  // window pointermove/pointerup 跟随；落点经 BoardSvg.toSvgPoint（CTM 逆变换）
  // 换算后 snapHex 吸附最近合法格，非法位置松手 = 弹回（不产生行动）。
  const [drag, setDrag] = useState<{ b: DragBuilding; plan: DragPlan; x: number; y: number } | null>(null);
  const [dragSnap, setDragSnap] = useState<HexKey | null>(null);
  const boardRef = useRef<BoardSvgHandle>(null);

  // 新快照（行动被接受/对局推进）→ 清空未完成的选择
  useEffect(() => {
    setSelection(null);
  }, [s.seq]);

  // ---- 行动确认/撤销条 ----
  // 回合起点检查点：actor 变为我（pending 为空、非终局）时记录当时状态；
  // 此后我的每次提交都让 seq 超过检查点 → 底部浮条显示本回合资源/VP 增量，
  // [完成] 收起（下次提交再出现）、[撤销回合] 发 undo（服务端截断重放，状态还原）。
  const [turnCheckpoint, setTurnCheckpoint] = useState<{ seq: number; state: FilteredState } | null>(null);
  const [undoDismissedAt, setUndoDismissedAt] = useState<number | null>(null);
  const prevActorRef = useRef<PlayerIndex | null>(null);
  useEffect(() => {
    if (state === null || seat === null) return;
    const cur = actorOf(state as GameState);
    if (cur !== seat) {
      prevActorRef.current = cur;
      return;
    }
    if (state.pending === null && state.phase !== 'game-over' && prevActorRef.current !== seat) {
      setTurnCheckpoint({ seq: s.seq, state });
      setUndoDismissedAt(null);
    }
    prevActorRef.current = cur;
  }, [s.seq, seat, state]);

  const nicknames = useMemo(
    () => s.room?.seats.map((info) => info?.nickname) ?? [],
    [s.room],
  );

  if (state === null || seat === null) {
    return <main className="app game-screen">等待对局数据…</main>;
  }
  const actor = actorOf(state as GameState);

  // 撤销条可见性与增量（检查点之后有提交且未被[完成]暂时收起）
  const meNow = state.players[seat];
  const meThen = turnCheckpoint?.state.players[seat];
  const undoBarVisible =
    turnCheckpoint !== null &&
    meNow !== undefined &&
    meThen !== undefined &&
    s.seq > turnCheckpoint.seq &&
    (undoDismissedAt === null || s.seq > undoDismissedAt);
  const undoDelta: [string, number][] = [];
  if (undoBarVisible && meNow !== undefined && meThen !== undefined) {
    const diff = (label: string, cur: number, old: number): void => {
      if (cur !== old) undoDelta.push([label, cur - old]);
    };
    diff('矿', meNow.resources.ore, meThen.resources.ore);
    diff('钱', meNow.resources.credits, meThen.resources.credits);
    diff('知', meNow.resources.knowledge, meThen.resources.knowledge);
    diff('Q', meNow.resources.qic, meThen.resources.qic);
    diff('VP', meNow.vp, meThen.vp);
  }

  const question = selection !== null ? currentQuestion(selection) : null;
  // 拖拽中：高亮 = 拖拽合法落点；否则 = 选择机的 hex 问题目标
  const highlights = drag !== null ? drag.plan.targets : selection !== null ? hexTargets(selection) : undefined;
  /** 当前选择问题的可选值集合（ResearchBoard / BoostersStrip 命中高亮用）。 */
  const activeOptions =
    question !== null
      ? new Set(question.options.map((o) => o.value).filter((v): v is string => v !== null))
      : null;

  const applyPick = (fieldKey: string, value: string | null): void => {
    if (selection === null) return;
    setSelection(pick(selection, fieldKey, value));
  };

  const onHexClick = (hex: HexKey): void => {
    if (selection === null || question === null || question.field.kind !== 'hex') return;
    if (!question.options.some((o) => o.value === hex)) return;
    applyPick(question.field.key, hex);
  };

  const onStartSelection = (category: CategoryId): void => {
    const sel = startSelection(s.legalActions, category);
    // 无字段问题的单候选类别（理论兜底）直接进确认条——isReady 时 ActionBar 自处理
    setSelection(sel);
  };

  /** 舰队面板：预填 ship + action 后进入选择流（剩余字段照常追问）。 */
  const onShipAction = (ship: ShipId, action: ShipActionId): void => {
    if (!s.legalActions.some((a) => a.type === 'ship-action' && a.ship === ship && a.action === action)) return;
    let sel = startSelection(s.legalActions, 'ship-action');
    if (sel === null) return;
    sel = pick(sel, 'ship', ship);
    sel = pick(sel, 'action', action);
    setSelection(sel);
  };

  /** 舰队面板：预填 explore-ship 的 ship（通常直接进确认条）。 */
  const onExploreShip = (ship: ShipId): void => {
    if (!s.legalActions.some((a) => a.type === 'explore-ship' && a.ship === ship)) return;
    let sel = startSelection(s.legalActions, 'explore');
    if (sel === null) return;
    sel = pick(sel, 'ship', ship);
    setSelection(sel);
  };

  const onSubmit = (action: Action): void => {
    store.submitAction(action);
    setSelection(null);
  };

  /** 面板建筑 pointerdown 发起拖拽（仅轮到自己且该建筑有可拖行动时）。 */
  const onBuildingDragStart = (b: DragBuilding, e: React.PointerEvent<HTMLImageElement>): void => {
    if (actor !== seat) return;
    const plan = planDrag(s.legalActions, b);
    if (plan === null) return;
    e.preventDefault(); // 阻止 img 原生 drag/选中，后续由 window 监听接管
    setDrag({ b, plan, x: e.clientX, y: e.clientY });
    setDragSnap(null);
  };

  // 拖拽跟随 + 落锤：pointermove 更新 ghost/吸附预览；pointerup 吸附成功
  // 则预填选择机（等价点选 hex），非法位置弹回；pointercancel 取消。
  useEffect(() => {
    if (drag === null) return;
    const onMove = (e: PointerEvent): void => {
      setDrag((d) => (d === null ? null : { ...d, x: e.clientX, y: e.clientY }));
      const p = boardRef.current?.toSvgPoint(e.clientX, e.clientY);
      setDragSnap(p != null ? snapHex(p, drag.plan.targets) : null);
    };
    const onUp = (e: PointerEvent): void => {
      const p = boardRef.current?.toSvgPoint(e.clientX, e.clientY);
      const hex = p != null ? snapHex(p, drag.plan.targets) : null;
      if (hex !== null) {
        const sel = applyDragDrop(s.legalActions, drag.plan, hex);
        if (sel !== null) setSelection(sel);
      }
      setDrag(null);
      setDragSnap(null);
    };
    const onCancel = (): void => {
      setDrag(null);
      setDragSnap(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  /** 研究板 power/qic 行动格直接点击（未在选择态时）→ 开选择并预填行动格。 */
  const availableBoardActions = useMemo(() => {
    if (actor !== seat || selection !== null) return null;
    const set = new Set<string>();
    for (const a of s.legalActions) {
      if (a.type === 'power-action' || a.type === 'qic-action') set.add(a.action);
    }
    return set;
  }, [actor, seat, selection, s.legalActions]);

  const onBoardAction = (id: BoardActionId): void => {
    if (selection !== null) return;
    const category: CategoryId = id.startsWith('power') ? 'power' : 'qic';
    const sel = startSelection(s.legalActions, category);
    if (sel === null) return;
    setSelection(pick(sel, 'action', id));
  };

  const gameOver = s.gameOver;

  return (
    <main className="app game-screen" data-testid="game-screen" data-lf={state.config.lostFleet === true ? '1' : '0'}>
      <TopActionBar
        state={state}
        legalActions={s.legalActions}
        seat={seat}
        nicknames={nicknames}
        connection={s.connection}
        onStartSelection={onStartSelection}
        onSubmit={onSubmit}
        onLeave={() => store.leaveRoom()}
        onExport={() => store.exportGame()}
      />

      {/* 服务器拒绝提示（not-your-turn / illegal-action 等）：上一动被拒绝时上屏，
          否则用户看到的是"完全没反应" */}
      {s.lastError !== null ? (
        <div className="error-toast" data-testid="error-toast" role="alert" onClick={() => store.clearError()}>
          {s.lastError.message}
        </div>
      ) : null}

      <div className="game-main" data-players={state.players.length}>
        {/* 左栏（v7）：上 = 我的版图 + 科技/推进横条；下 = 对手版图 TAB 切换 */}
        <LeftRail
          state={state}
          seat={seat}
          nicknames={nicknames}
          actor={actor}
          thinkingSeats={s.thinkingSeats}
          onShowDetail={(p) => setDetailPlayer(p)}
          onBuildingDragStart={actor === seat ? onBuildingDragStart : undefined}
          specialAvailable={actor === seat && s.legalActions.some((a) => a.type === 'special-action')}
          onSpecialAction={() => onStartSelection('special')}
        />

        {/* 中央：星图 + 底部横条（舰队 2×2 + 助推器池） */}
        <section className="center-panel">
          <div className="map-area">
            {/* 行动确认/撤销条：本回合每次提交后浮出（增量实时计算） */}
            {undoBarVisible ? (
              <div className="undo-bar" data-testid="undo-bar">
                <span className="undo-delta" data-testid="undo-delta">
                  本回合：{undoDelta.length > 0 ? undoDelta.map(([l, d]) => `${l}${d > 0 ? '+' : ''}${d}`).join(' ') : '无变化'}
                </span>
                <button type="button" className="btn-primary undo-btn" data-testid="undo-turn" onClick={() => store.undo()}>
                  撤销回合
                </button>
                <button type="button" className="btn-ghost undo-dismiss" data-testid="undo-dismiss" onClick={() => setUndoDismissedAt(s.seq)}>
                  完成
                </button>
              </div>
            ) : null}
            <BoardSvg
              ref={boardRef}
              state={state}
              highlights={highlights}
              onHexClick={onHexClick}
              snapPreview={
                drag !== null && dragSnap !== null
                  ? { hex: dragSnap, building: drag.b as BuildingType, player: seat }
                  : null
              }
              suppressHover={drag !== null}
            />

            {/* 地图顶部浮动条：选择对话 / pending 决策 / setup 提示（不挡棋盘交互） */}
            <div className="map-top-overlay">
              <ActionBar
                state={state}
                legalActions={s.legalActions}
                seat={seat}
                selection={selection}
                onPick={applyPick}
                onCancelSelection={() => setSelection(null)}
                onSubmit={onSubmit}
              />
            </div>

            {/* 事件日志：地图左下角可折叠浮层 */}
            <section className={`log-panel${logOpen ? ' open' : ''}`}>
              <button type="button" className="log-toggle" data-testid="log-toggle" onClick={() => setLogOpen((v) => !v)}>
                事件日志（{s.log.length}）{logOpen ? '▲' : '▼'}
              </button>
              {logOpen ? (
                <ul className="log-list" data-testid="log-list">
                  {[...s.log].reverse().map((e) => (
                    <li key={e.seq} className="log-entry">
                      <span className="log-seq">#{e.seq}</span>
                      <span className="log-player">{nicknames[e.player] ?? `玩家 ${e.player + 1}`}</span>
                      <span className="log-action">{describeAction(e.action)}</span>
                      {e.reason !== undefined ? <span className="log-reason">（{e.reason}）</span> : null}
                      {e.degraded === true ? <span className="log-degraded">降级</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          </div>

          <div className="center-bottom">
            <BoostersStrip
              state={state}
              activeField={question?.field.key ?? null}
              activeOptions={activeOptions}
              onPick={applyPick}
            />
            <FleetPanel
              state={state}
              seat={seat}
              legalActions={s.legalActions}
              onShipAction={onShipAction}
              onExplore={onExploreShip}
            />
          </div>
        </section>

        {/* 右栏：研究轨道 + 计分区（回合弧 + LF 扩展条 + 终局进度 + 回合/先手 + 计分表） */}
        <aside className="rail-r" data-testid="rail-r">
          <ResearchBoard
            state={state}
            activeField={question?.field.key ?? null}
            activeCategory={selection?.category ?? null}
            activeOptions={activeOptions}
            onPick={applyPick}
            availableActions={availableBoardActions}
            onBoardAction={onBoardAction}
          />
          <div className="scoreboard" data-testid="scoreboard">
            <ScoreboardBoard
              state={state}
              nicknames={nicknames}
              seat={seat}
              activeField={question?.field.key ?? null}
              activeOptions={activeOptions}
              onPick={applyPick}
            />
            <ScoreTable state={state} nicknames={nicknames} thinkingSeats={s.thinkingSeats} seat={seat} />
          </div>
        </aside>
      </div>

      {drag !== null ? (
        <img
          className="bld-drag-ghost"
          data-testid="bld-drag-ghost"
          src={buildingImage(drag.b as BuildingType, FACTIONS[state.players[seat]?.faction ?? 'terrans'].color)}
          style={{
            left: drag.x,
            top: drag.y,
            filter: BUILDING_COLOR_FILTER[FACTIONS[state.players[seat]?.faction ?? 'terrans'].color],
          }}
          alt=""
        />
      ) : null}

      {detailPlayer !== null ? (
        <div className="modal-backdrop" data-testid="player-detail" onClick={() => setDetailPlayer(null)}>
          <div className="modal player-detail-modal" onClick={(e) => e.stopPropagation()}>
            <PlayerMat state={state} playerIdx={detailPlayer} nickname={nicknames[detailPlayer]} isMe={detailPlayer === seat} detailed />
            <button type="button" className="btn-primary" data-testid="close-player-detail" onClick={() => setDetailPlayer(null)}>
              关闭
            </button>
          </div>
        </div>
      ) : null}

      {gameOver !== null && !overDismissed ? (
        <div className="modal-backdrop" data-testid="game-over">
          <div className="modal game-over-modal">
            <h2>对局结束</h2>
            <p className="winner-line" data-testid="winner-line">
              胜者：
              {gameOver.winner
                .map((w) => nicknames[w] ?? `玩家 ${w + 1}`)
                .join('、')}
            </p>
            <table className="final-table">
              <thead>
                <tr>
                  <th>玩家</th>
                  <th>总分</th>
                  {state.board.finalScoring.map((f) => (
                    <th key={f}>{finalScoringName(f)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {state.players.map((p, i) => (
                  <tr key={i} className={gameOver.winner.includes(i) ? 'winner' : ''}>
                    <td>
                      {nicknames[i] ?? `玩家 ${i + 1}`}（{factionName(p.faction)}）
                    </td>
                    <td>{gameOver.finalScores[i] ?? p.vp}</td>
                    {state.board.finalScoring.map((f) => {
                      const def = FINAL_SCORING[f];
                      const count = def !== undefined ? finalCount(state as GameState, i, def.condition) : 0;
                      const vp = finalTileVp(state, f)[i] ?? 0;
                      return (
                        <td key={f}>
                          {count}（+{vp} 分）
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="hint">关闭后可继续查看版图与日志。</p>
            <button type="button" className="btn-primary" data-testid="close-game-over" onClick={() => setOverDismissed(true)}>
              关闭
            </button>
            <button type="button" className="btn-ghost" data-testid="export-game-over" onClick={() => store.exportGame()}>
              导出对局
            </button>
            <button type="button" className="btn-ghost" data-testid="leave-after-game" onClick={() => store.leaveRoom()}>
              返回大厅
            </button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
