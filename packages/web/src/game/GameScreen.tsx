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
import { FACTIONS, FINAL_RANK_VP, FINAL_SCORING, finalCount, mapNeighbors } from '@gaia/engine';
import type { Action, BoardActionId, BuildingType, FederationTokenId, FinalTileId, GameState, HexKey, PlayerIndex, ShipActionId, ShipId } from '@gaia/engine';
import { actorOf } from '@gaia/protocol';
import type { FilteredState } from '@gaia/protocol';
import { flashForAction, chargeTriggerHex } from './actionFlash';
import type { ActionFlash } from './actionFlash';
import { BUILDING_COLOR_FILTER, buildingImage } from '../assets';
import { BoardSvg } from '../board/BoardSvg';
import type { BoardSvgHandle } from '../board/BoardSvg';
import { ActionBar } from './ActionBar';
import { BoostersStrip } from './BoostersStrip';
import { FleetPanel } from './FleetPanel';
import { LeftRail } from './LeftRail';
import { PanelBoosterStack } from './ExplorationBoard';
import { PlayerMat } from './PlayerMat';
import { ResearchBoard } from './ResearchBoard';
import { ScoreTable } from './ScoreTable';
import { ScoreboardBoard } from './ScoreboardBoard';
import { TopActionBar } from './TopActionBar';
import { describeAction, describeDelta, factionName, federationTokenName, finalScoringName } from './display';

/** 连接状态文案（右栏状态行用）。 */
const CONNECTION_LABEL: Record<string, string> = {
  connected: '已连接',
  connecting: '重连中…',
  disconnected: '已断线',
};
import { applyDragDrop, planDrag, snapHex } from './drag';
import type { DragBuilding, DragPlan } from './drag';
import { currentQuestion, hexTargets, isReady, pick, readyAction, startSelection } from './interactions';
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

/** 轻量选择类行动：选完即直接提交，连确认条也跳过（放建筑/选助推器；撤销条兜底）。 */
const DIRECT_SUBMIT_TYPES: ReadonlySet<Action['type']> = new Set(['place-initial-mine', 'build-mine', 'choose-booster']);

/** 组建联邦两步交互的阶段：点卫星格 → 星球组合（同卫星集多解时）→ 选联邦片。 */
type FedStage =
  | { stage: 'satellites'; selected: HexKey[]; error?: string }
  | { stage: 'planets'; satellites: HexKey[]; options: { hexes: HexKey[]; tokens: FederationTokenId[] }[] }
  | { stage: 'token'; hexes: HexKey[]; satellites: HexKey[]; tokens: FederationTokenId[] };

export function GameScreen({ store }: { store: GameStore }): ReactElement {
  const s = useGameStore(store);
  const state = s.snapshot;
  const seat = s.seat;
  const [selection, setSelection] = useState<Selection | null>(null);
  /** 行动红框高亮（~5s；任一玩家行动回播后立即标出涉及位置）。 */
  const [flash, setFlash] = useState<ActionFlash | null>(null);
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
    setFedStage(null);
  }, [s.seq]);

  // ---- 组建联邦两步交互（点卫星格 → 选联邦片）----
  // 不做全量形状枚举展示：玩家指定卫星格，引擎候选形状按卫星集精确匹配过滤，
  // 不匹配则说明原因；匹配后进入标记选择（选项按钮 + 研究板/船上联邦片可点）。
  const [fedStage, setFedStage] = useState<FedStage | null>(null);
  const fedCandidates = useMemo(
    () => s.legalActions.filter((a): a is Extract<Action, { type: 'form-federation' }> => a.type === 'form-federation'),
    [s.legalActions],
  );
  /** 卫星集 → 星球组合 → 可拿标记（候选形状按卫星集分组）。 */
  const fedSatGroups = useMemo(() => {
    const m = new Map<string, { satellites: HexKey[]; planets: Map<string, { hexes: HexKey[]; tokens: FederationTokenId[] }> }>();
    for (const a of fedCandidates) {
      const satKey = a.satellites.join('|');
      let g = m.get(satKey);
      if (g === undefined) {
        g = { satellites: a.satellites, planets: new Map() };
        m.set(satKey, g);
      }
      const pKey = a.hexes.join('|');
      let pg = g.planets.get(pKey);
      if (pg === undefined) {
        pg = { hexes: a.hexes, tokens: [] };
        g.planets.set(pKey, pg);
      }
      pg.tokens.push(a.token);
    }
    return m;
  }, [fedCandidates]);
  /** 可点卫星格并集（出现在任一候选形状里的格）。 */
  const fedSatOptions = useMemo(
    () => new Set<HexKey>([...fedSatGroups.values()].flatMap((g) => g.satellites)),
    [fedSatGroups],
  );
  /** 卫星数最少形状的卫星格（强高亮）；其余候选格（弱高亮，不再一条斜线淹没视野）。 */
  const { fedSatBest, fedSatRest } = useMemo(() => {
    let minLen = Infinity;
    for (const g of fedSatGroups.values()) {
      minLen = Math.min(minLen, g.satellites.length);
    }
    const best = new Set<HexKey>();
    const rest = new Set<HexKey>();
    for (const g of fedSatGroups.values()) {
      for (const h of g.satellites) {
        (g.satellites.length === minLen ? best : rest).add(h);
      }
    }
    for (const h of best) rest.delete(h);
    return { fedSatBest: best, fedSatRest: rest };
  }, [fedSatGroups]);
  /** 最少卫星快捷方案：候选形状中卫星数最少；数量并列时选"卫星格邻接的未殖民星球
      最少"的——之后在那些星球上建矿会被吞并进该联邦（参考 addBuildingToNearbyFederation），
      不利于再组新联邦，故越少越有利。 */
  const bestFedShape = useMemo((): { satellites: HexKey[]; adjPlanets: number } | null => {
    if (state === null) return null;
    let best: { satellites: HexKey[]; adjPlanets: number } | null = null;
    for (const g of fedSatGroups.values()) {
      const adj = new Set<HexKey>();
      for (const h of g.satellites) {
        for (const nb of mapNeighbors(state.map, h)) {
          const hex = state.map[nb];
          if (hex !== undefined && hex.planet !== 'empty' && hex.building === undefined) {
            adj.add(nb);
          }
        }
      }
      if (
        best === null ||
        g.satellites.length < best.satellites.length ||
        (g.satellites.length === best.satellites.length && adj.size < best.adjPlanets)
      ) {
        best = { satellites: g.satellites, adjPlanets: adj.size };
      }
    }
    return best;
  }, [fedSatGroups, state]);
  /** 确认卫星：精确匹配候选形状 → 星球组合唯一进标记选择 / 多组合再选 / 不匹配报原因。 */
  const confirmFedSatellites = (): void => {
    if (fedStage?.stage !== 'satellites') return;
    const key = [...fedStage.selected].sort().join('|');
    const g = fedSatGroups.get(key);
    if (g === undefined) {
      setFedStage({
        stage: 'satellites',
        selected: fedStage.selected,
        error: '该卫星组合无法组建联邦（需连通己方建筑且能量值 ≥7、卫星数最少、不与已有联邦相邻）',
      });
      return;
    }
    const options = [...g.planets.values()];
    if (options.length === 1) {
      const pg = options[0]!;
      setFedStage({ stage: 'token', hexes: pg.hexes, satellites: g.satellites, tokens: pg.tokens });
    } else {
      setFedStage({ stage: 'planets', satellites: g.satellites, options });
    }
  };
  /** 提交联邦（形状 + 标记）。 */
  const submitFedToken = (token: FederationTokenId): void => {
    if (fedStage?.stage !== 'token') return;
    onSubmit({ type: 'form-federation', hexes: fedStage.hexes, satellites: fedStage.satellites, token });
    setFedStage(null);
  };

  // ---- 行动确认/撤销条 ----
  // 检查点 = 我上一次提交**行动前**的快照：此后每次提交（seq 前进且上一帧轮到我）
  // 都刷新检查点 → 底部浮条实时显示该行动的资源/VP 增量；
  // [完成] 收起（下次行动再出现）、[撤销] 发 undo（服务端回退到该行动之前，可连撤）。
  const [turnCheckpoint, setTurnCheckpoint] = useState<{ seq: number; state: FilteredState } | null>(null);
  const [undoDismissedAt, setUndoDismissedAt] = useState<number | null>(null);
  const prevFrameRef = useRef<{ seq: number; state: FilteredState; actor: PlayerIndex | null } | null>(null);
  useEffect(() => {
    if (state === null || seat === null) return;
    const cur = actorOf(state as GameState);
    const prev = prevFrameRef.current;
    if (prev !== null && prev.actor === seat && s.seq > prev.seq) {
      setTurnCheckpoint({ seq: prev.seq, state: prev.state });
      setUndoDismissedAt(null);
    }
    prevFrameRef.current = { seq: s.seq, state, actor: cur };
  }, [s.seq, seat, state]);

  const nicknames = useMemo(
    () => s.room?.seats.map((info) => info?.nickname) ?? [],
    [s.room],
  );

  // ---- 行动红框高亮 ----
  // 5 秒消退；充能邀约 pending 期间触发 hex 持续红框（供判断是否蹭能量）
  useEffect(() => {
    if (flash === null || state?.pending?.kind === 'charge') return;
    const t = setTimeout(() => setFlash(null), 5000);
    return () => clearTimeout(t);
  }, [flash, state?.pending?.kind]);
  // 其他玩家/AI 的行动：新 action_applied 日志条目到达即标出（按日志长度增量判定，含首条）
  const lastLogLenRef = useRef(0);
  useEffect(() => {
    const prevLen = lastLogLenRef.current;
    lastLogLenRef.current = s.log.length;
    if (s.log.length <= prevLen || state === null) return; // 无新增（含 undo 裁剪回退）
    const entry = s.log[s.log.length - 1];
    if (entry === undefined) return;
    const f = flashForAction(entry.action, state, entry.player);
    if (f !== null) setFlash(f);
  }, [s.log, state]);
  // 充能邀约 pending：触发 hex 持续红框
  useEffect(() => {
    if (state?.pending?.kind !== 'charge') return;
    const hex = chargeTriggerHex(s.log);
    if (hex === null) return;
    setFlash((f) => {
      if (f?.hexes.includes(hex) === true) return f;
      return {
        hexes: [...(f?.hexes ?? []), hex],
        matSlot: f?.matSlot ?? null,
        research: f?.research ?? null,
        tileIds: f?.tileIds ?? [],
        tilesPlayer: f?.tilesPlayer ?? null,
        boosterPlayer: f?.boosterPlayer ?? null,
      };
    });
  }, [state?.pending, s.log]);

  if (state === null || seat === null) {
    return <main className="app game-screen">等待对局数据…</main>;
  }
  const actor = actorOf(state as GameState);

  // ---- 撤销条可见性与增量 ----
  // 只在我自己的回合有已提交行动时显示：
  // - 检查点（我行动前快照）以来日志里须有我的回合内行动（被动充能响应不算——
  //   那是别人回合的应答，"充能不可撤销"，不该因此弹条）。
  //   **seq 口径**：服务器 action_applied.seq = 行动落库序号（= 行动前快照 seq），
  //   snapshot.seq = 行动后计数；检查点快照 seq=S 时我的首个行动日志 seq=S，
  //   故过滤边界为 >=（> 会把该行动漏掉——曾致撤销条整轮不显示）；
  // - 之后没有其他**真人**座位的回合内行动（有则 server 必拒，显示即误导；
  //   AI 行动不挡——可一并回退）；
  // - 收起后仅当我又产生新的回合内行动才再弹出。
  const meNow = state.players[seat];
  const meThen = turnCheckpoint?.state.players[seat];
  const aiSeats = new Set(
    (s.room?.seats ?? []).flatMap((info) => (info?.isAI === true ? [info.seat] : [])),
  );
  const turnLog =
    turnCheckpoint !== null
      ? s.log.filter(
          (e) =>
            e.seq >= turnCheckpoint.seq &&
            e.action.type !== 'charge' &&
            e.action.type !== 'decline-charge',
        )
      : [];
  const lastMyActionSeq = turnLog.reduce<number | null>(
    (acc, e) => (e.player === seat ? Math.max(acc ?? 0, e.seq) : acc),
    null,
  );
  const blockedByHuman = turnLog.some((e) => e.player !== seat && !aiSeats.has(e.player));
  const undoBarVisible =
    turnCheckpoint !== null &&
    meNow !== undefined &&
    meThen !== undefined &&
    lastMyActionSeq !== null &&
    !blockedByHuman &&
    (undoDismissedAt === null || lastMyActionSeq > undoDismissedAt);
  const undoDelta: [string, number][] =
    undoBarVisible && meNow !== undefined && meThen !== undefined ? describeDelta(meThen, meNow) : [];

  const question = selection !== null ? currentQuestion(selection) : null;
  // 高亮优先级：拖拽落点 > 联邦卫星选择态 > 选择机的 hex 问题目标；
  // 联邦卫星选择态：最少卫星数形状的格强高亮，其余候选格弱高亮（仍可点）
  const highlights =
    drag !== null
      ? drag.plan.targets
      : fedStage?.stage === 'satellites'
        ? fedSatBest
        : selection !== null
          ? hexTargets(selection)
          : undefined;
  const dimHighlights = fedStage?.stage === 'satellites' ? fedSatRest : undefined;
  /** 当前选择问题的可选值集合（ResearchBoard / BoostersStrip 命中高亮用）。 */
  const activeOptions =
    question !== null
      ? new Set(question.options.map((o) => o.value).filter((v): v is string => v !== null))
      : null;

  /**
   * 轻量选择类（放起始矿/建矿/选助推器）：选完即直接提交，连确认条也跳过
   * （建筑立即真实上板便于分析局势；后悔用撤销条回退）。
   * 返回 true = 已直提（选择流结束，调用方不要再 setSelection）。
   */
  const tryDirectSubmit = (sel: Selection): boolean => {
    if (!isReady(sel)) return false;
    const action = readyAction(sel);
    if (action === null || !DIRECT_SUBMIT_TYPES.has(action.type)) return false;
    store.submitAction(action);
    setSelection(null);
    return true;
  };

  const applyPick = (fieldKey: string, value: string | null): void => {
    if (selection === null) return;
    const next = pick(selection, fieldKey, value);
    if (tryDirectSubmit(next)) return;
    setSelection(next);
  };

  const onHexClick = (hex: HexKey): void => {
    // 联邦卫星选择态：点击高亮格放置/撤下卫星
    if (fedStage?.stage === 'satellites') {
      if (!fedSatOptions.has(hex)) return;
      setFedStage((cur) => {
        if (cur?.stage !== 'satellites') return cur;
        const has = cur.selected.includes(hex);
        return {
          stage: 'satellites',
          selected: has ? cur.selected.filter((h) => h !== hex) : [...cur.selected, hex],
        };
      });
      return;
    }
    if (selection === null || question === null || question.field.kind !== 'hex') return;
    if (!question.options.some((o) => o.value === hex)) return;
    applyPick(question.field.key, hex);
  };

  const onStartSelection = (category: CategoryId): void => {
    // 组建联邦：不走选择机列表模式，进"点卫星格 → 选联邦片"两步交互
    if (category === 'federation') {
      if (fedCandidates.length > 0) setFedStage({ stage: 'satellites', selected: [] });
      return;
    }
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
    // 全部行动确认即直接提交服务器（无暂结闸）；后悔用撤销条整回合回退。
    // 红框由服务器回播的 action_applied 日志驱动（全员可见）。
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
        // 拖拽放建筑：落锤即直提（同点选路径），其余进选择流
        if (sel !== null && !tryDirectSubmit(sel)) setSelection(sel);
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
          flash={flash}
        />

        {/* 中央：星图 + 底部横条（舰队 2×2 + 助推器池） */}
        <section className="center-panel">
          <div className="map-area">
            {/* 撤销条：我本回合行动提交后浮出（增量 + [撤销]/[完成]；
                真人对手行动后或充能响应后不显示） */}
            {undoBarVisible ? (
              <div className="undo-bar" data-testid="undo-bar">
                <span className="undo-delta" data-testid="undo-delta">
                  本次行动：{undoDelta.length > 0 ? undoDelta.map(([l, d]) => `${l}${d > 0 ? '+' : ''}${d}`).join(' ') : '无变化'}
                </span>
                <button type="button" className="btn-primary undo-btn" data-testid="undo-turn" onClick={() => store.undo()}>
                  撤销
                </button>
                <button type="button" className="btn-ghost undo-dismiss" data-testid="undo-dismiss" onClick={() => setUndoDismissedAt(lastMyActionSeq ?? s.seq)}>
                  完成
                </button>
              </div>
            ) : null}
            <BoardSvg
              ref={boardRef}
              state={state}
              highlights={highlights}
              dimHighlights={dimHighlights}
              flashHexes={flash?.hexes}
              onHexClick={onHexClick}
              selectedHexes={fedStage?.stage === 'satellites' ? new Set(fedStage.selected) : undefined}
              snapPreview={
                drag !== null && dragSnap !== null
                  ? { hex: dragSnap, building: drag.b as BuildingType, player: seat }
                  : null
              }
              suppressHover={drag !== null}
            />

            {/* 地图顶部浮动条：联邦两步交互 / 选择对话 / pending 决策 / setup 提示 */}
            <div className="map-top-overlay">
              {fedStage !== null ? (
                <div className="action-bar" data-testid="action-bar">
                  {fedStage.stage === 'satellites' ? (
                    <div className="confirm-bar" data-testid="fed-sat-bar">
                      <span className="confirm-text" data-testid="fed-sat-text">
                        组建联邦：点击高亮格放置/撤下卫星（已选 {fedStage.selected.length} 颗）
                        {fedStage.error !== undefined ? `——${fedStage.error}` : ''}
                      </span>
                      <button
                        type="button"
                        className="btn-primary"
                        data-testid="fed-sat-confirm"
                        disabled={fedStage.selected.length === 0 && !fedSatGroups.has('')}
                        onClick={confirmFedSatellites}
                      >
                        确认卫星
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        data-testid="fed-best-sat"
                        disabled={bestFedShape === null}
                        title="自动放置最少卫星方案（数量并列时选卫星邻接未殖民星球最少的——之后在那些星球建矿会被吞并进该联邦）"
                        onClick={() => {
                          if (bestFedShape !== null && fedStage?.stage === 'satellites') {
                            setFedStage({ stage: 'satellites', selected: bestFedShape.satellites });
                          }
                        }}
                      >
                        最少卫星（{bestFedShape?.satellites.length ?? 0}）
                      </button>
                      <button type="button" className="btn-ghost" data-testid="fed-cancel" onClick={() => setFedStage(null)}>
                        取消
                      </button>
                    </div>
                  ) : fedStage.stage === 'planets' ? (
                    <div className="selection-dialog" data-testid="fed-planets-dialog">
                      <header className="dialog-head">
                        <span>同一卫星布局对应多组星球：选择联邦星球组合</span>
                        <button
                          type="button"
                          className="btn-ghost"
                          data-testid="fed-back-sat"
                          onClick={() => setFedStage({ stage: 'satellites', selected: fedStage.satellites })}
                        >
                          返回
                        </button>
                      </header>
                      <ul className="candidate-list">
                        {fedStage.options.map((o) => (
                          <li key={o.hexes.join('|')}>
                            <button
                              type="button"
                              className="candidate-item"
                              data-testid={`fed-planet-${o.hexes.join('_')}`}
                              onClick={() => setFedStage({ stage: 'token', hexes: o.hexes, satellites: fedStage.satellites, tokens: o.tokens })}
                            >
                              {o.hexes.join('、')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="selection-dialog" data-testid="fed-token-dialog">
                      <header className="dialog-head">
                        <span>
                          选择联邦片（{fedStage.hexes.length} 星球 + {fedStage.satellites.length} 卫星；也可直接点研究板供应区/船上的联邦片）
                        </span>
                        <button
                          type="button"
                          className="btn-ghost"
                          data-testid="fed-back-sat2"
                          onClick={() => setFedStage({ stage: 'satellites', selected: fedStage.satellites })}
                        >
                          返回
                        </button>
                      </header>
                      <div className="option-grid" data-testid="fed-token-grid">
                        {fedStage.tokens.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className="option-btn"
                            data-testid={`fed-token-${t}`}
                            onClick={() => submitFedToken(t)}
                          >
                            {federationTokenName(t)}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <ActionBar
                  state={state}
                  legalActions={s.legalActions}
                  seat={seat}
                  selection={selection}
                  onPick={applyPick}
                  onCancelSelection={() => setSelection(null)}
                  onSubmit={onSubmit}
                />
              )}
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
              fedTokenOptions={fedStage?.stage === 'token' ? new Set(fedStage.tokens) : null}
              onFedTokenPick={submitFedToken}
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
            flashResearch={flash?.research ?? null}
            fedTokenOptions={fedStage?.stage === 'token' ? new Set(fedStage.tokens) : null}
            onFedTokenPick={submitFedToken}
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
            <div className="mat-detail-main">
              <PlayerMat state={state} playerIdx={detailPlayer} nickname={nicknames[detailPlayer]} isMe={detailPlayer === seat} detailed />
              <PanelBoosterStack state={state} seat={detailPlayer} />
            </div>
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
