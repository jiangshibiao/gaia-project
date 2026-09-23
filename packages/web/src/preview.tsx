/**
 * 开发预览页（仅 vite dev 使用，不进生产 bundle）：
 * 构造 LF 局 FilteredState，渲染各栏组件（ResearchBoard / FleetPanel /
 * ScoreboardBoard / BoostersStrip / ExplorationBoard）/ BoardSvg / PlayerMat
 * （族板整图叠加，逐族目视验证校准）。
 * 末尾挂一个带假 store 的完整 GameScreen（本地引擎驱动、其他座位自动走
 * 第一个合法行动），用于目视验证三栏布局、拖拽建矿/升级与 power 行动格直点。
 * 访问 http://localhost:5175/preview.html
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyAction, enumerateActions, newGame } from '@gaia/engine';
import type { Action, FactionId } from '@gaia/engine';
import { actorOf, filterStateFor } from '@gaia/protocol';
import { BoardSvg } from './board/BoardSvg';
import { BoostersStrip } from './game/BoostersStrip';
import { ExplorationBoard } from './game/ExplorationBoard';
import { FleetPanel } from './game/FleetPanel';
import { GameScreen } from './game/GameScreen';
import { PlayerMat } from './game/PlayerMat';
import { ResearchBoard } from './game/ResearchBoard';
import { ScoreboardBoard } from './game/ScoreboardBoard';
import type { GameStore, GameStoreState, LogEntry } from './game/store';
import './style.css';

const state = filterStateFor(
  newGame({
    playerCount: 4,
    seed: 42,
    factions: ['terrans', 'xenos', 'geodens', 'itars'],
    lostFleet: true,
  }),
);

// 构造有内容的画面：穿梭机、已用行动格、爬轨、L5 占用；Twilight 放 2 个圣器（目视圣器尺寸）。
for (const ship of state.board.ships) {
  ship.shuttleSlots[0] = 0;
  ship.shuttleSlots[2] = 1;
}
{
  const twilight = state.board.ships.find((s) => s.id === 'twilight');
  if (twilight !== undefined) twilight.artifacts.push({ id: 'art-1k1o' }, { id: 'art-3k1q' });
}
state.board.shipActionsUsed.push(`${state.board.ships[0]!.id}:${'ship-rescore-fed'}`);
state.board.shipActionsUsed.push('eclipse:ship-vp-per-planet');
state.board.boardActionsUsed.push('power1', 'qic2');
state.players[0]!.research = { terra: 3, nav: 2, int: 0, gaia: 1, eco: 0, sci: 4 };
state.players[1]!.research = { terra: 3, nav: 0, int: 2, gaia: 0, eco: 1, sci: 0 };
state.players[2]!.research = { terra: 0, nav: 5, int: 1, gaia: 0, eco: 0, sci: 2 };
state.players[3]!.research = { terra: 1, nav: 0, int: 0, gaia: 0, eco: 0, sci: 0 };
state.board.researchLevel5.nav = 2;
// 科技板错落堆叠目视验证：terra 位剩 2 张（看到 2 层）、nav 位拿完（露空槽），其余满 4 层
{
  const terraTile = state.board.techTilePositions.terra;
  const navTile = state.board.techTilePositions.nav;
  state.board.techTiles[terraTile] = 2;
  state.board.techTiles[navTile] = 0;
  // 详情弹窗两区目视验证：玩家 0 持有标准板（tech5 被高级板覆盖）+ 助推器
  state.players[0]!.techTiles = ['tech2', 'tech5'];
  state.players[0]!.advTechTiles = [{ id: 'advtech3', covers: 'tech5' }];
  state.players[0]!.booster = 'booster4';
}

// 星球叠加层目视验证：把一个印刷 transdim 改为盖亚转化态、一个空格改为失落星球
// （引擎仅有的两种星球变化；贴图/纯色圆应与原画星球等大且居中，盖住底下印刷内容）。
{
  const candidates = Object.values(state.map).filter((h) => !h.deepSpace && h.sector !== 'interspace');
  const gaiaHex = candidates.find((h) => h.planet === 'transdim');
  if (gaiaHex !== undefined) gaiaHex.planet = 'gaia';
  const lostHex = candidates.find((h) => h.planet === 'empty');
  if (lostHex !== undefined) lostHex.planet = 'lost';
}

/** 逐族面板预览（校准目视验证）：每族单独 1 人局，构造有内容的局面。 */
const MAT_FACTIONS: readonly FactionId[] = [
  'terrans',
  'taklons',
  'bescods',
  'nevlas',
  'space-giants',
  'tinkeroids',
  'darkanians',
  'moweyds',
  'ambas',
  'itars',
  'gleens',
];

const matStates = MAT_FACTIONS.map((f, i) => {
  const s = filterStateFor(
    newGame({ playerCount: 1, seed: 7 + i, factions: [f], lostFleet: true }),
  );
  const p = s.players[0]!;
  p.buildings.mine = 8 - (i % 4) - 2;
  p.buildings.ts = 4 - (i % 3);
  p.buildings.lab = 3 - (i % 2);
  if (i % 3 === 0) p.buildings.pi = 0;
  if (i % 4 === 0) p.buildings.ac1 = 0;
  // terrans：tech9 特殊行动已用盖片目视验证（片上盖 token 置灰）
  if (i === 0) {
    p.techTiles = ['tech9'];
    p.specialUsed = ['tech9'];
    p.acquisitions = [{ kind: 'tech', id: 'tech9' }];
  }
  // gleens：面板特殊行动格盖片目视验证（本轮已用 → 盖 action token 置灰）
  if (f === 'gleens') p.specialUsed = ['gleens-range'];
  p.power = { ...p.power, bowl1: 2 + (i % 3), bowl2: 3 + (i % 4), bowl3: i % 5, gaia: i % 3 };
  if (i % 2 === 0) p.gaiaformers = { total: 3, available: 2, lost: 0, inGaia: i % 4 === 0 ? 1 : 0 };
  p.vp = 10 + i * 3;
  // 联邦标记单行自适应验证：各家枚数不同（含翻灰面）
  const FED_COUNTS = [5, 2, 3, 1, 6, 4, 2, 3, 1, 5, 2] as const;
  const FED_IDS = ['fed1', 'fed2', 'fed3', 'fed4', 'fed5', 'fed6'] as const;
  p.federationTokens = FED_IDS.slice(0, FED_COUNTS[i]!).map((id, j) => ({ id, flipped: j % 2 === 1 }));
  return s;
});

/** gleens 面板特殊行动格"未用"对照态（热区可点）。 */
const gleensUnusedState = filterStateFor(
  newGame({ playerCount: 1, seed: 17, factions: ['gleens'], lostFleet: true }),
);

/**
 * 假 GameStore（preview 拖拽实测）：本地引擎对局，seat 0 为人类；
 * submitAction 直接 applyAction，其他座位自动应用第一个合法行动直到
 * 回到 seat 0（或对局结束），随后刷新快照并通知订阅者。
 */
class PreviewStore {
  private game;

  private state: GameStoreState;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly playerCount: 2 | 4 = 4) {
    this.game = newGame({
      playerCount: this.playerCount,
      seed: 42,
      factions: (['terrans', 'xenos', 'geodens', 'itars'] as const).slice(0, this.playerCount),
      lostFleet: true,
    });
    // 快进到主阶段 seat 0 首个回合（setup 全部自动行动），
    // 使建矿/升级拖拽与行动格直点都能在 preview 实测
    this.autoPlay(() => this.game.phase !== 'setup' && actorOf(this.game) === 0);
    // 塞科技片/高级片/联邦片/助推器，验证左栏横条有内容时的布局；
    // tech9 特殊行动已用 → 片上盖片位置目视验证
    {
      const p = this.game.players[0]!;
      p.techTiles = ['tech9', 'tech2', 'tech5'];
      p.specialUsed = ['tech9'];
      p.advTechTiles = [{ id: 'advtech3', covers: 'tech5' }];
      p.booster = 'booster4';
      p.federationTokens = [
        { id: 'fed1', flipped: false },
        { id: 'fed2', flipped: false },
        { id: 'fed3', flipped: true },
      ];
      p.acquisitions = [
        { kind: 'tech', id: 'tech9' },
        { kind: 'tech', id: 'tech2' },
        { kind: 'fed', id: 'fed1' },
        { kind: 'adv', id: 'advtech3' },
        { kind: 'fed', id: 'fed2' },
        { kind: 'tech', id: 'tech5' },
        { kind: 'fed', id: 'fed3' },
      ];
    }
    this.state = this.buildState(1);
  }

  /** 所有座位自动应用第一个合法行动，直到 done 或无法继续（同步记行动日志）。 */
  private autoPlay(done: () => boolean): void {
    for (let guard = 0; guard < 600 && !done(); guard++) {
      const actor = actorOf(this.game);
      if (actor === null) break;
      const legal = enumerateActions(this.game, actor);
      if (legal.length === 0) break;
      const action = legal[0]!;
      this.game = applyAction(this.game, action);
      this.log.push({ seq: this.log.length, player: actor, action, events: [] });
    }
  }

  private log: LogEntry[] = [];

  private buildState(seq: number): GameStoreState {
    const NAMES = ['我', '乙', '丙', '丁'] as const;
    return {
      connection: 'connected',
      room: {
        code: 'PREV',
        config: { playerCount: this.playerCount, lostFleet: true },
        customSeed: false,
        seats: NAMES.slice(0, this.playerCount).map((nickname, seat) => ({
          seat,
          nickname,
          isAI: seat !== 0,
          connected: true,
        })),
        started: true,
        drafting: false,
      },
      seat: 0,
      draft: null,
      token: 'preview',
      snapshot: filterStateFor(this.game),
      legalActions: enumerateActions(this.game, 0),
      seq,
      log: this.log,
      thinkingSeats: [],
      gameOver: null,
      lastError: null,
      agentPlugins: [],
      defaultAISpec: null,
      review: null,
    };
  }

  getState = (): GameStoreState => this.state;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  submitAction = (action: Action): void => {
    this.log = [...this.log, { seq: this.log.length, player: 0, action, events: [] }];
    this.game = applyAction(this.game, action);
    // 其他座位自动行动（首个合法行动），直到回到 seat 0 / 对局结束
    this.autoPlay(() => actorOf(this.game) === 0 || actorOf(this.game) === null);
    this.state = this.buildState(this.state.seq + 1);
    for (const cb of this.listeners) cb();
  };

  leaveRoom = (): void => {};
}

const previewStore = new PreviewStore(4) as unknown as GameStore;
const previewStore2p = new PreviewStore(2) as unknown as GameStore;

function App() {
  return (
    <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2>完整对局画面（本地引擎假 store：拖拽建矿/升级、power 格直点实测；其他座位自动行动）</h2>
      <GameScreen store={previewStore} />
      <h2>2 人局（左栏下块唯一对手免 TAB 直接显示）</h2>
      <GameScreen store={previewStore2p} />
      <h2>玩家面板（族板整图 + 叠加，逐族校准验证）</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {MAT_FACTIONS.map((f, i) => (
          <div key={f}>
            <h3 style={{ margin: '4px 0' }}>{f}</h3>
            <PlayerMat state={matStates[i]!} playerIdx={0} nickname={`玩家${i + 1}`} active={i === 0} />
          </div>
        ))}
      </div>
      <h2>玩家详情弹窗（detailed 变体：科技板块/推进片两区）</h2>
      <div style={{ maxWidth: 640 }}>
        <PlayerMat state={state} playerIdx={0} nickname="玩家1" detailed />
      </div>
      <h2>飞船面板特殊行动格（gleens：左 = 本轮已用盖片置灰；右 = 自己回合热区可点）</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: 130 }}>
          <ExplorationBoard state={matStates[MAT_FACTIONS.indexOf('gleens')]!} seat={0} />
        </div>
        <div style={{ width: 130 }}>
          <ExplorationBoard state={gleensUnusedState} seat={0} specialAvailable onSpecialAction={() => {}} />
        </div>
      </div>
      <h2>各栏组件（研究轨道 / 舰队 2×2 + 助推器池 / 实图计分板）</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <div style={{ width: '30vw', flex: 'none' }}>
          <ResearchBoard state={state} />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <FleetPanel state={state} seat={0} legalActions={[]} onShipAction={() => {}} onExplore={() => {}} />
          <BoostersStrip state={state} />
        </div>
        <div style={{ width: '24vw', flex: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <ScoreboardBoard state={state} nicknames={[]} seat={0} />
        </div>
      </div>
      <h2>中央地图（滚轮缩放 / 拖拽平移 / 双击复位）</h2>
      <div style={{ height: 480, display: 'flex' }}>
        <BoardSvg state={state} />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
