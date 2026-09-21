/**
 * 玩家面板（族板整图重构 · 四角）：以 factions/hi/<族>.jpg 族板整图为背景，
 * 按 faction-calibration 的相对坐标叠加——power 三区+gaia 区 token 点阵与计数
 * （含 taklons 脑石）、收入轨剩余建筑（放上地图即从面板消失=收入揭开）、
 * gaiaformer（含 baltaks 暂存 gaia 区的）。
 *
 * 图下：资源（markers 图标条，不遮挡图）/科技板与联邦标记小图
 * （单行自适应）/穿梭机与神器（LF 图外徽标区）。卫星数见终局计分区，
 * 助推器见中央底部助推器池，不再占面板行。
 * 研究等级 mini 条仅详情弹窗（detailed）渲染（v6 左栏紧凑面板移除，爬轨看右栏研究板）。
 *
 * moweyds 无高清图（或整图加载失败）→ 回退旧布局（legacy：头图+文字行）。
 * 当前行动者高亮边框（active）；点击"详情"弹大图模态（detailed 变体）。
 */
import { useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { FACTIONS } from '@gaia/engine';
import type { BuildingSupply, BuildingType, FactionId, PlayerIndex, PlayerState, ResearchTrack, SpecialActionId } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import {
  ACTION_TOKEN_IMAGE,
  BUILDING_COLOR_FILTER,
  advTechTileImage,
  artifactImage,
  buildingImage,
  factionImage,
  federationTokenImage,
  markerImage,
  techTileImage,
} from '../assets';
import {
  BRAINSTONE_WIDTH,
  BUILDING_SPRITE,
  GAIAFORMER_WIDTH,
  POWER_DOT_WIDTH,
  factionCalibration,
} from './faction-calibration';
import type { BuildingSprite } from './faction-calibration';
import type { RelPoint } from './research-calibration';
import {
  advTechTileName,
  artifactName,
  describeAction,
  factionName,
  federationTokenName,
  PLANET_COLORS,
  planetName,
  playerColor,
  techTileName,
  trackName,
} from './display';
import type { LogEntry } from './store';

const TRACK_ORDER: readonly ResearchTrack[] = ['terra', 'nav', 'int', 'gaia', 'eco', 'sci'];

const SUPPLY_ORDER: readonly (keyof BuildingSupply)[] = ['mine', 'ts', 'lab', 'pi', 'ac1', 'ac2'];
const SUPPLY_NAME: Record<string, string> = {
  mine: '矿井',
  ts: '贸易站',
  lab: '实验室',
  pi: '行星研究院',
  ac1: '学院·知识',
  ac2: '学院·QIC',
};

/** 建筑类型 → 叠加规格（图宽 + 内容裁剪）。 */
const BUILDING_SPRITE_OF: Record<keyof BuildingSupply, BuildingSprite> = {
  mine: BUILDING_SPRITE.mine,
  ts: BUILDING_SPRITE.ts,
  lab: BUILDING_SPRITE.lab,
  pi: BUILDING_SPRITE.pi,
  ac1: BUILDING_SPRITE.academy,
  ac2: BUILDING_SPRITE.academy,
};

/** power 点阵单碗最多渲染的圆片数（超出仍以计数为准）。 */
const POWER_DOT_CAP = 10;

type Bowl = 'bowl1' | 'bowl2' | 'bowl3' | 'gaia';
const BOWL_ORDER: readonly Bowl[] = ['bowl1', 'bowl2', 'bowl3', 'gaia'];
const BOWL_TITLE: Record<Bowl, string> = {
  bowl1: 'I 区',
  bowl2: 'II 区',
  bowl3: 'III 区',
  gaia: 'Gaia 区',
};

/** 相对坐标 → 居中定位 style。 */
function at(p: RelPoint): CSSProperties {
  return {
    left: `${(p.x * 100).toFixed(2)}%`,
    top: `${(p.y * 100).toFixed(2)}%`,
    transform: 'translate(-50%, -50%)',
  };
}

export interface PlayerMatProps {
  state: FilteredState;
  playerIdx: PlayerIndex;
  /** 房间昵称（无房间信息时显示"玩家 N"）。 */
  nickname?: string | undefined;
  isMe?: boolean;
  thinking?: boolean;
  /** 当前应行动玩家（actorOf 裁决，含 pending/setup）。 */
  active?: boolean;
  /** 详情弹窗变体（更大图 + 全名）。 */
  detailed?: boolean;
  /** 点击打开详情（仅紧凑模式渲染入口）。 */
  onShowDetail?: ((player: PlayerIndex) => void) | undefined;
  /** 复盘第一视角切换（仅复盘传入；渲染在详情按钮前，点击轮换视角座位）。 */
  onCycleViewSeat?: (() => void) | undefined;
  /** 行动红框：刚解锁的建筑槽位（建造/升级后 ~5s 提示）。 */
  flashSlot?: { building: BuildingType; slotIndex: number } | null | undefined;
  /** 收入轨建筑拖拽源（仅自己的面板且轮到自己时传入；pointerdown 发起拖拽）。 */
  onBuildingDragStart?: ((b: keyof BuildingSupply, e: React.PointerEvent<HTMLImageElement>) => void) | undefined;
  /** 星际要塞特殊行动可用（自己回合且 legalActions 含 special-action）。 */
  specialAvailable?: boolean | undefined;
  /** 点击星际要塞（PI 热区）→ 与「特殊行动」按钮同效。 */
  onSpecialAction?: (() => void) | undefined;
  /** 点击族板能力八边形（bescods 推进最低轨）→ 等效特殊行动按钮并锁定该行动。 */
  onSpecialTile?: ((id: SpecialActionId) => void) | undefined;
  /** 全量行动日志（用于"最近行动"行与全部行动弹窗；无则不渲染该行）。 */
  actionLog?: readonly LogEntry[] | undefined;
}

/** 不算"他干了什么"的被动响应（最近行动行跳过：被动充能/回合完成是应答而非主动操作）。 */
const PASSIVE_RESPONSE_TYPES: ReadonlySet<string> = new Set(['charge', 'decline-charge', 'confirm-turn']);

export function PlayerMat({ state, playerIdx, nickname, isMe, thinking, active, detailed, onShowDetail, onCycleViewSeat, flashSlot, onBuildingDragStart, specialAvailable, onSpecialAction, onSpecialTile, actionLog }: PlayerMatProps): ReactElement | null {
  const p = state.players[playerIdx];
  const [imgBroken, setImgBroken] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const lastActionRowRef = useRef<HTMLDivElement>(null);
  const matRootRef = useRef<HTMLElement>(null);
  if (p === undefined) return null;
  const def = FACTIONS[p.faction];
  const color = playerColor(state, playerIdx);
  const passed = state.passedPlayers.includes(playerIdx);
  const cal = factionCalibration(p.faction);
  const legacy = cal.image === null || imgBroken;
  // 详情弹窗用：被高级板覆盖的标准板（仍持有，置灰缩小垫在高级板下）
  const covered = new Set(p.advTechTiles.map((t) => t.covers));
  const uncoveredTech = p.techTiles.filter((t) => !covered.has(t));
  // 最近行动行（仿伯明翰：玩家打了什么在面板正上方一目了然；被动充能应答不算）+
  // 右侧「全部 ›」开该玩家历史行动弹窗
  const myLog = actionLog?.filter((e) => e.player === playerIdx) ?? [];
  const lastAction = [...myLog].reverse().find((e) => !PASSIVE_RESPONSE_TYPES.has(e.action.type));

  return (
    <section
      className={`player-mat${active === true ? ' active' : ''}${passed ? ' passed' : ''}${detailed === true ? ' detailed' : ''}${legacy ? ' legacy' : ''}`}
      data-testid={`player-mat-${playerIdx}`}
      style={{ borderColor: color }}
      ref={matRootRef}
    >
      <header
        className="mat-head"
        style={legacy ? { backgroundImage: `url(${factionImage(p.faction)})` } : undefined}
      >
        {legacy ? <span className="mat-head-overlay" /> : null}
        <span className="faction-chip" style={{ background: color }} aria-hidden="true" />
        <span className="mat-name">
          {nickname ?? `玩家 ${playerIdx + 1}`}
          {isMe === true ? <span className="me-chip">（我）</span> : null}
        </span>
        <span className="mat-faction">
          {factionName(p.faction)}
          {def.homePlanet !== null ? '' : ' · LF'}
        </span>
        <span className="mat-vp" data-testid={`vp-${playerIdx}`}>
          <img className="marker-icon" src={markerImage('VP')} alt="VP" />
          {p.vp}
        </span>
        {thinking === true ? (
          <span className="thinking-badge" data-testid={`thinking-${playerIdx}`}>
            AI 思考中…
          </span>
        ) : null}
        {passed ? <span className="passed-badge">已 Pass</span> : null}
        {onCycleViewSeat !== undefined && detailed !== true ? (
          <button
            type="button"
            className="btn-ghost mat-detail-btn"
            data-testid={`cycle-view-seat-${playerIdx}`}
            title="切换复盘第一视角（轮换至下一位玩家）"
            onClick={onCycleViewSeat}
          >
            视角⇄
          </button>
        ) : null}
        {onShowDetail !== undefined && detailed !== true ? (
          <button
            type="button"
            className="btn-ghost mat-detail-btn"
            data-testid={`mat-detail-${playerIdx}`}
            title="查看完整面板"
            onClick={() => onShowDetail(playerIdx)}
          >
            详情
          </button>
        ) : null}
      </header>

      {lastAction !== undefined ? (
        <div className="mat-last-action" data-testid={`mat-last-action-${playerIdx}`} ref={lastActionRowRef}>
          <span className="last-action-label" title={describeAction(lastAction.action)}>
            最近：{describeAction(lastAction.action)}
          </span>
          <button
            type="button"
            className="btn-ghost last-action-all"
            data-testid={`mat-log-${playerIdx}`}
            title="查看该玩家此前的所有行动"
            onClick={() => setLogOpen(true)}
          >
            全部 ›
          </button>
        </div>
      ) : null}

      {legacy ? (
        <LegacyBoard p={p} playerIdx={playerIdx} color={def.color} />
      ) : (
        <FactionBoard p={p} playerIdx={playerIdx} faction={p.faction} color={def.color} onImgError={() => setImgBroken(true)} gleensTokenAvailable={p.faction === 'gleens' && (state.board.federationTokens['gleens'] ?? 0) > 0} flashSlot={flashSlot} onBuildingDragStart={onBuildingDragStart} specialAvailable={specialAvailable} onSpecialAction={onSpecialAction} onSpecialTile={onSpecialTile} />
      )}

      <div className="mat-resources" data-testid={`resources-${playerIdx}`}>
        <span title="矿石">
          <img className="marker-icon" src={markerImage('Ores')} alt="矿" />
          {p.resources.ore}
        </span>
        <span title="信用">
          <img className="marker-icon" src={markerImage('Credits')} alt="币" />
          {p.resources.credits}
        </span>
        <span title="知识">
          <img className="marker-icon" src={markerImage('Knowledge')} alt="知" />
          {p.resources.knowledge}
        </span>
        <span title="QIC">
          <img className="marker-icon" src={markerImage('Qic')} alt="Q" />
          {p.resources.qic}
        </span>
        {/* 科技轨道高度（右对齐） */}
        <span className="mat-research-inline">
          {TRACK_ORDER.map((t) => (
            <span key={t} className={`research-pip level-${p.research[t]}`} title={`${trackName(t)} L${p.research[t]}`}>
              {p.research[t]}
            </span>
          ))}
        </span>
      </div>

      {detailed === true ? (
        <div className="mat-detail-strip">
          <TechBoosterStrip state={state} playerIdx={playerIdx} />
        </div>
      ) : null}

      {/* 全部行动浮层（portal 到 body：锚定在最近行动行下方的独立下拉框，
          暂时盖住版图但不动任何布局；曾用文档流弹窗把面板顶上去） */}
      {logOpen && lastActionRowRef.current !== null && matRootRef.current !== null
        ? (() => {
            const rowRect = lastActionRowRef.current.getBoundingClientRect();
            const matRect = matRootRef.current.getBoundingClientRect();
            return createPortal(
              <>
                <div className="action-log-backdrop" data-testid="action-log-backdrop" onClick={() => setLogOpen(false)} />
                <div
                  className="action-log-pop"
                  style={{
                    top: rowRect.bottom + 4,
                    left: rowRect.left,
                    width: Math.max(rowRect.width, 320),
                    // 高度与版图一致（用户要求滚轮浏览历史而非矮框截断）
                    height: Math.max(matRect.bottom - rowRect.bottom - 8, 140),
                  }}
                  data-testid={`action-log-modal-${playerIdx}`}
                >
                  <header>
                    <strong>
                      {nickname ?? `玩家 ${playerIdx + 1}`} 的全部行动（{myLog.length}）
                    </strong>
                    <button type="button" className="btn-ghost" data-testid="close-action-log" onClick={() => setLogOpen(false)}>
                      ×
                    </button>
                  </header>
                  <ul className="action-log-list">
                    {[...myLog].reverse().map((e) => (
                      <li key={e.seq}>
                        <span className="log-seq">#{e.seq}</span>
                        <span className="log-desc">{describeAction(e.action)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </>,
              document.body,
            );
          })()
        : null}
    </section>
  );
}

/**
 * 科技/高级（覆盖叠放）/联邦片混排横条（按获得时间序）：
 * 左栏版图下方展示，与详情弹窗共享覆盖/叠放逻辑；推进片已迁出版图右侧竖列
 * （PanelBoosterStack：种族飞船面板 + 当回合助推片）。三者皆空时不渲染。
 */
export function TechBoosterStrip({ state, playerIdx, flashTileIds = [], onSpecialTile }: { state: FilteredState; playerIdx: PlayerIndex; flashTileIds?: readonly string[] | undefined; onSpecialTile?: ((id: SpecialActionId) => void) | undefined }): ReactElement | null {
  const p = state.players[playerIdx];
  if (p === undefined) return null;
  const covered = new Set(p.advTechTiles.map((t) => t.covers));
  const uncoveredTech = p.techTiles.filter((t) => !covered.has(t));
  if (uncoveredTech.length === 0 && p.advTechTiles.length === 0 && p.federationTokens.length === 0 && p.artifacts.length === 0) return null;
  /** 片上特殊行动本轮已用 → 盖 action token（tech9 充能 / advtech3/11/13 资源格）。 */
  const specialUsedSet = new Set<string>(p.specialUsed);
  /** 按获得时间混排（acquisitions 为空/缺失时回退：科技→高级→联邦的分组序）。 */
  const acqs = p.acquisitions ?? [];
  const items =
    acqs.length > 0
      ? acqs
      : ([
          ...uncoveredTech.map((id) => ({ kind: 'tech' as const, id })),
          ...p.advTechTiles.map((t) => ({ kind: 'adv' as const, id: t.id })),
          ...p.federationTokens.map((f) => ({ kind: 'fed' as const, id: f.id })),
        ] as { kind: 'tech' | 'adv' | 'fed'; id: string }[]);
  const fedState = (id: string) => p.federationTokens.find((f) => f.id === id);
  return (
    <div className="tech-booster-strip" data-testid={`tech-booster-strip-${playerIdx}`}>
      <div className="strip-tech">
        {items.map((item, i) => {
          const flashing = flashTileIds.includes(item.id);
          if (item.kind === 'tech') {
            const used = item.id === 'tech9' && specialUsedSet.has('tech9');
            const specialId = item.id === 'tech9' ? ('tech9' as const) : null;
            const canSpecial = specialId !== null && !used && onSpecialTile !== undefined;
            return (
              <span
                key={`tech-${item.id}-${i}`}
                className={`tile-wrap${canSpecial ? ' tile-special-available' : ''}`}
                onClick={canSpecial ? () => onSpecialTile(specialId) : undefined}
                title={canSpecial ? '充能 4 魔力（点击直接发起）' : techTileName(item.id as Parameters<typeof techTileName>[0])}
              >
                <img
                  className={`tile-img${flashing ? ' flash' : ''}${used ? ' used' : ''}`}
                  data-testid={flashing ? `strip-flash-${playerIdx}` : undefined}
                  src={techTileImage(item.id as Parameters<typeof techTileImage>[0])}
                  alt={techTileName(item.id as Parameters<typeof techTileName>[0])}
                />
                {used ? (
                  <img
                    className="action-token tile-used-token"
                    data-testid={`tile-used-tech9-${playerIdx}`}
                    src={ACTION_TOKEN_IMAGE}
                    alt="已用"
                    title="充能 4 魔力：本轮已用"
                  />
                ) : null}
              </span>
            );
          }
          if (item.kind === 'adv') {
            const adv = p.advTechTiles.find((t) => t.id === item.id);
            if (adv === undefined) return null;
            const used = specialUsedSet.has(adv.id);
            const isSpecialAdv = adv.id === 'advtech3' || adv.id === 'advtech11' || adv.id === 'advtech13';
            const canSpecial = isSpecialAdv && !used && onSpecialTile !== undefined;
            return (
              <span
                key={`adv-${item.id}-${i}`}
                className={`tech-stack${flashing ? ' flash' : ''}${canSpecial ? ' tile-special-available' : ''}`}
                data-testid={flashing ? `strip-flash-${playerIdx}` : undefined}
                title={canSpecial ? `${advTechTileName(adv.id)}特殊行动（点击直接发起）` : `${advTechTileName(adv.id)}（覆盖 ${techTileName(adv.covers)}）`}
                onClick={canSpecial ? () => onSpecialTile(adv.id as SpecialActionId) : undefined}
              >
                <img
                  className="tile-img covered"
                  src={techTileImage(adv.covers)}
                  alt={techTileName(adv.covers)}
                  title={`${techTileName(adv.covers)}（被覆盖）`}
                />
                <img className={`tile-img adv-top${used ? ' used' : ''}`} src={advTechTileImage(adv.id)} alt={advTechTileName(adv.id)} />
                {used ? (
                  <img
                    className="action-token tile-used-token"
                    data-testid={`tile-used-${adv.id}-${playerIdx}`}
                    src={ACTION_TOKEN_IMAGE}
                    alt="已用"
                    title="特殊行动：本轮已用"
                  />
                ) : null}
              </span>
            );
          }
          const f = fedState(item.id);
          return (
            <img
              key={`fed-${item.id}-${i}`}
              className={`tile-img fed${f?.flipped === true ? ' flipped' : ''}${flashing ? ' flash' : ''}`}
              data-testid={`strip-fed-${playerIdx}-${i}`}
              src={federationTokenImage(item.id as Parameters<typeof federationTokenImage>[0])}
              alt={federationTokenName(item.id as Parameters<typeof federationTokenName>[0])}
              title={`${federationTokenName(item.id as Parameters<typeof federationTokenName>[0])}${f?.flipped === true ? '（已翻灰面）' : ''}`}
            />
          );
        })}
        {/* 圣器与科技/联邦片同条置版图下方（曾独立一行在资源条下，用户要求并入横条） */}
        {p.artifacts.map((a) => (
          <img
            key={`art-${a.id}`}
            className="tile-img artifact"
            data-testid={`strip-artifact-${playerIdx}-${a.id}`}
            src={artifactImage(a.id)}
            alt={artifactName(a.id)}
            title={artifactName(a.id)}
          />
        ))}
      </div>
    </div>
  );
}

/** 族板整图 + 校准叠加（power/建筑/gaiaformer/脑石）。 */
/** 族板印刷能力八边形对应的特殊行动（热区位置见 faction-calibration specialSlot；仅列板面印有八边形的族）。 */
const BOARD_SPECIAL_ACTION: Partial<Record<FactionId, SpecialActionId>> = {
  bescods: 'bescods-up',
};

/** PI（行星研究院）特殊行动（热区在 piSlot）：已用盖 action token。 */
const PI_SPECIAL_ACTION: Partial<Record<FactionId, SpecialActionId>> = {
  moweyds: 'moweyds-ring',
  ambas: 'ambas-swap',
  firaks: 'firaks-down',
  ivits: 'ivits-sp',
  tinkeroids: 'tinkeroids-tile',
};

function FactionBoard({
  p,
  playerIdx,
  faction,
  color,
  onImgError,
  gleensTokenAvailable,
  flashSlot,
  onBuildingDragStart,
  specialAvailable,
  onSpecialAction,
  onSpecialTile,
}: {
  p: PlayerState;
  playerIdx: PlayerIndex;
  faction: FactionId;
  color: string;
  onImgError: () => void;
  /** 格伦星人专属联邦片仍在供应（未解锁）时 true：叠放在 PI 槽位上。 */
  gleensTokenAvailable?: boolean | undefined;
  /** 行动红框：刚解锁的建筑槽位（建造/升级后 ~5s 提示）。 */
  flashSlot?: { building: BuildingType; slotIndex: number } | null | undefined;
  onBuildingDragStart?: ((b: keyof BuildingSupply, e: React.PointerEvent<HTMLImageElement>) => void) | undefined;
  /** 自己回合且特殊行动合法时为 true（PI 热区高亮可点）。 */
  specialAvailable?: boolean | undefined;
  /** 点击星际要塞（PI 热区）→ 与「特殊行动」按钮同效。 */
  onSpecialAction?: (() => void) | undefined;
  /** 点击族板能力八边形（bescods）→ 等效特殊行动按钮并锁定该行动。 */
  onSpecialTile?: ((id: SpecialActionId) => void) | undefined;
}): ReactElement {
  const cal = factionCalibration(faction);
  const filter = BUILDING_COLOR_FILTER[color];
  const pw = p.power;

  const slotsOf = (b: keyof BuildingSupply): readonly RelPoint[] => {
    switch (b) {
      case 'mine':
        return cal.mineSlots;
      case 'ts':
        return cal.tsSlots;
      case 'lab':
        return cal.labSlots;
      case 'pi':
        return [cal.piSlot];
      case 'ac1':
        return [cal.ac1Slot];
      case 'ac2':
        return [cal.ac2Slot];
    }
  };

  return (
    <div
      className="mat-board"
      style={{ aspectRatio: `${cal.aspect.toFixed(4)}` }}
      data-testid={`mat-board-${playerIdx}`}
      data-faction={faction}
    >
      <img
        className="mat-board-img"
        src={cal.image ?? undefined}
        alt={`${factionName(faction)}族板`}
        onError={onImgError}
      />

      {/* power 三区 + gaia 区：token 点阵 + 计数（脑石按所在区叠加） */}
      {BOWL_ORDER.map((bowl) => {
        const center = cal.power[bowl];
        const count = pw[bowl];
        const dots = Math.min(count, POWER_DOT_CAP);
        return (
          <span key={bowl} className={`mat-power-cluster ${bowl}`} data-testid={`mat-power-${bowl}-${playerIdx}`} data-count={count}>
            {Array.from({ length: dots }, (_, i) => (
              <span
                key={i}
                className="mat-power-dot"
                style={{
                  left: `${((center.x + (i - (dots - 1) / 2) * POWER_DOT_WIDTH * 0.85) * 100).toFixed(2)}%`,
                  top: `${((center.y - 0.012) * 100).toFixed(2)}%`,
                  width: `${(POWER_DOT_WIDTH * 100).toFixed(2)}%`,
                }}
                title={`${BOWL_TITLE[bowl]}：${count}`}
              />
            ))}
            <span
              className="mat-power-count"
              style={{ left: `${(center.x * 100).toFixed(2)}%`, top: `${((center.y + 0.028) * 100).toFixed(2)}%` }}
              title={BOWL_TITLE[bowl]}
            >
              {count}
            </span>
            {pw.brainstone === bowl ? (
              <img
                className="mat-brainstone"
                src={markerImage('Brainstone')}
                alt="脑石"
                title="脑石"
                data-testid={`mat-brainstone-${playerIdx}`}
                style={{
                  ...at({ x: center.x + cal.brainstoneOffset.x, y: center.y + cal.brainstoneOffset.y }),
                  width: `${(BRAINSTONE_WIDTH * 100).toFixed(2)}%`,
                }}
              />
            ) : null}
          </span>
        );
      })}

      {/* 收入轨剩余建筑（从左取用，剩余占靠右槽；放走即从面板消失）。
          transform 由 CSS 管（静态上移 10% 露出下方印刷收入）；clip-path 裁掉棋子图透明边距，
          既放大视觉尺寸又把 hover/拖拽热区收归棋子本体。 */}
      {SUPPLY_ORDER.flatMap((b) => {
        const slots = slotsOf(b);
        const remaining = p.buildings[b];
        const sprite = BUILDING_SPRITE_OF[b];
        return slots.slice(slots.length - remaining).map((slot, i) => (
          <img
            key={`${b}-${i}`}
            className={`mat-bld overlay${onBuildingDragStart !== undefined ? ' draggable' : ''}`}
            style={{
              left: `${(slot.x * 100).toFixed(2)}%`,
              top: `${(slot.y * 100).toFixed(2)}%`,
              width: `${(sprite.width * 100).toFixed(2)}%`,
              clipPath: sprite.clip ?? undefined,
              filter: filter,
            }}
            src={buildingImage(b, color)}
            alt={SUPPLY_NAME[b]}
            title={`${SUPPLY_NAME[b]}（面板剩 ${remaining}）`}
            data-b={b}
            draggable={false}
            onPointerDown={
              onBuildingDragStart !== undefined ? (e) => onBuildingDragStart(b, e) : undefined
            }
          />
        ));
      })}

      {/* 格伦星人专属联邦片：放在族板印有联邦徽章的位置（PI 格右侧大格），不遮挡
          PI 棋子（要塞与其他族同位显示）；PI 建成时获得（算组建一次联邦） */}
      {gleensTokenAvailable === true ? (
        <img
          className="mat-gleens-fed overlay"
          style={{ ...at(cal.gleensFedSlot ?? cal.piSlot), width: '7.5%' }}
          src={federationTokenImage('gleens')}
          alt="格伦星人专属联邦片"
          title="格伦星人专属联邦片：PI 建成时获得"
          data-testid={`mat-gleens-fed-${playerIdx}`}
        />
      ) : null}

      {/* 星际要塞（PI）特殊行动：已建成未用 → 热区可点（与「特殊行动」按钮同效）；
          本轮已用 → 在原槽位盖 action token（moweyds-ring/ambas-swap/firaks-down/ivits-sp/tinkeroids-tile） */}
      {p.buildings.pi === 0 ? (
        (() => {
          const piSpecial = PI_SPECIAL_ACTION[faction];
          const piUsed =
            piSpecial !== undefined && (p.specialUsed.includes(piSpecial) || p.roundAbilityUsed.includes(piSpecial));
          if (piUsed) {
            return (
              <img
                className="mat-used-token overlay"
                style={{ ...at(cal.piSlot), width: `${(BUILDING_SPRITE.pi.width * 100).toFixed(2)}%` }}
                src={ACTION_TOKEN_IMAGE}
                alt="已用"
                title="星际要塞特殊行动：本轮已用"
                data-testid={`mat-pi-used-${playerIdx}`}
              />
            );
          }
          return onSpecialAction !== undefined ? (
            <button
              type="button"
              className={`mat-pi-hotzone overlay${specialAvailable === true ? ' available' : ''}`}
              style={{ ...at(cal.piSlot), width: `${(BUILDING_SPRITE.pi.width * 100).toFixed(2)}%` }}
              data-testid={`mat-pi-action-${playerIdx}`}
              disabled={specialAvailable !== true}
              title={specialAvailable === true ? '星际要塞特殊行动（同特殊行动按钮）' : '星际要塞特殊行动（当前不可用）'}
              onClick={() => onSpecialAction()}
            />
          ) : null;
        })()
      ) : null}

      {/* tinkeroids/moweyds 3 步改造星球标注（setup 抽取的 3 种 3 铲星球，
          放入大轮盘下三小格——物理版用星球标记占格，数字版用色块） */}
      {cal.threeStepSlots !== undefined && p.terraformThreeStep.length > 0
        ? cal.threeStepSlots.map((slot, i) => {
            const planet = p.terraformThreeStep[i];
            if (planet === undefined) return null;
            return (
              <span
                key={planet}
                className="mat-three-step overlay"
                style={{ ...at(slot), background: PLANET_COLORS[planet] }}
                title={`3 步改造星球：${planetName(planet)}`}
                data-testid={`mat-three-step-${playerIdx}-${i}`}
              />
            );
          })
        : null}

      {/* 族板印刷能力八边形（bescods 推进最低轨）：可点时高亮；本轮已用 → 盖 action token */}
      {cal.specialSlot !== undefined && BOARD_SPECIAL_ACTION[faction] !== undefined ? (
        p.roundAbilityUsed.includes(BOARD_SPECIAL_ACTION[faction]!) ? (
          <img
            className="mat-used-token overlay"
            style={{ ...at(cal.specialSlot), width: '11%' }}
            src={ACTION_TOKEN_IMAGE}
            alt="已用"
            title="种族特殊行动：本轮已用"
            data-testid={`mat-special-used-${playerIdx}`}
          />
        ) : onSpecialTile !== undefined ? (
          <button
            type="button"
            className={`mat-pi-hotzone overlay mat-special-hotzone${specialAvailable === true ? ' available' : ''}`}
            style={{ ...at(cal.specialSlot), width: '14%' }}
            data-testid={`mat-special-action-${playerIdx}`}
            disabled={specialAvailable !== true}
            title={specialAvailable === true ? '种族特殊行动（等效特殊行动按钮并锁定）' : '种族特殊行动（当前不可用）'}
            onClick={() => onSpecialTile(BOARD_SPECIAL_ACTION[faction]!)}
          />
        ) : null
      ) : null}

      {/* QIC 学院（ac2）特殊行动八边形：已建成未用 → 热点可点（直发 ac2）；已用 → 盖 action token。
          基础板八边形在学院槽正下方（ac2ActionSlot），LF 板与槽同心（回退 ac2Slot） */}
      {p.buildings.ac2 === 0 ? (
        p.specialUsed.includes('ac2') ? (
          <img
            className="mat-used-token overlay"
            style={{ ...at(cal.ac2ActionSlot ?? cal.ac2Slot), width: `${(BUILDING_SPRITE.academy.width * 0.85 * 100).toFixed(2)}%` }}
            src={ACTION_TOKEN_IMAGE}
            alt="已用"
            title="QIC 学院 +1q：本轮已用"
            data-testid={`mat-used-ac2-${playerIdx}`}
          />
        ) : onSpecialTile !== undefined ? (
          <button
            type="button"
            className={`mat-pi-hotzone overlay mat-special-hotzone${specialAvailable === true ? ' available' : ''}`}
            style={{ ...at(cal.ac2ActionSlot ?? cal.ac2Slot), width: `${(BUILDING_SPRITE.academy.width * 100).toFixed(2)}%` }}
            data-testid={`mat-ac2-action-${playerIdx}`}
            disabled={specialAvailable !== true}
            title={specialAvailable === true ? 'QIC 学院行动（+1Q，baltaks +4c）' : 'QIC 学院行动（当前不可用）'}
            onClick={() => onSpecialTile('ac2')}
          />
        ) : null
      ) : null}

      {/* 行动红框：刚解锁的建筑槽位（建造/升级后 ~5s 提示） */}
      {flashSlot !== null && flashSlot !== undefined
        ? (() => {
            const slots = slotsOf(flashSlot.building as keyof BuildingSupply);
            const slot = slots[flashSlot.slotIndex];
            const sprite = BUILDING_SPRITE_OF[flashSlot.building as keyof BuildingSupply];
            if (slot === undefined) return null;
            return (
              <span
                className="mat-flash-slot overlay"
                data-testid={`mat-flash-slot-${playerIdx}`}
                style={{
                  left: `${(slot.x * 100).toFixed(2)}%`,
                  top: `${(slot.y * 100).toFixed(2)}%`,
                  width: `${(sprite.width * 100).toFixed(2)}%`,
                }}
              />
            );
          })()
        : null}

      {/* gaiaformer：可用占槽（左→右）；baltaks 暂存 gaia 区的叠在 gaia 区旁 */}
      {Array.from({ length: p.gaiaformers.available }, (_, i) =>
        cal.gaiaformerSlots[i] !== undefined ? (
          <img
            key={`gf-${i}`}
            className="mat-gf overlay"
            style={{ ...at(cal.gaiaformerSlots[i]!), width: `${(GAIAFORMER_WIDTH * 100).toFixed(2)}%`, filter }}
            src={buildingImage('gf', color)}
            alt="盖亚形成器"
            title={`盖亚形成器（可用 ${p.gaiaformers.available}/${p.gaiaformers.total}）`}
            data-testid={`mat-gf-${playerIdx}`}
          />
        ) : null,
      )}
      {Array.from({ length: p.gaiaformers.inGaia }, (_, i) => (
        <img
          key={`gfg-${i}`}
          className="mat-gf overlay in-gaia"
          style={{
            ...at({ x: cal.power.gaia.x + 0.05 + i * 0.045, y: cal.power.gaia.y + 0.09 }),
            width: `${(GAIAFORMER_WIDTH * 0.7 * 100).toFixed(2)}%`,
            filter,
          }}
          src={buildingImage('gf', color)}
          alt="盖亚形成器（暂存 Gaia 区）"
          title="盖亚形成器（暂存 Gaia 区，下轮返回）"
        />
      ))}
    </div>
  );
}

/** 旧布局兜底（moweyds 无高清图 / 整图加载失败）：文字行 power + 建筑 supply。 */
function LegacyBoard({ p, playerIdx, color }: { p: PlayerState; playerIdx: PlayerIndex; color: string }): ReactElement {
  const pw = p.power;
  return (
    <>
      <div className="mat-power" data-testid={`power-${playerIdx}`}>
        {BOWL_ORDER.map((bowl) => (
          <span key={bowl} className={`power-bowl ${bowl}`} title={BOWL_TITLE[bowl]}>
            {bowl === 'gaia' ? 'G' : bowl.replace('bowl', '')}:{pw[bowl]}
            {pw.brainstone === bowl ? (
              <img className="marker-icon brainstone" src={markerImage('Brainstone')} alt="脑石" title="脑石" />
            ) : null}
          </span>
        ))}
      </div>

      <div className="mat-row mat-supply">
        {SUPPLY_ORDER.map((b) => (
          <span key={b} className="supply-item" title={`${SUPPLY_NAME[b]} 剩余`}>
            <img className="building-mini" src={buildingImage(b, color)} alt={SUPPLY_NAME[b]} />
            ×{p.buildings[b]}
          </span>
        ))}
        <span className="supply-item" title="盖亚形成器 可用/总数(报废)">
          <img className="building-mini" src={buildingImage('gf', color)} alt="GF" />
          ×{p.gaiaformers.available}/{p.gaiaformers.total}
          {p.gaiaformers.lost > 0 ? `(-${p.gaiaformers.lost})` : ''}
        </span>
      </div>
    </>
  );
}

/** 研究轨顺序导出（ResearchBoard 共用）。 */
export { TRACK_ORDER };
