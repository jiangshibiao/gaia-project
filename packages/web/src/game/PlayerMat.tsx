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
import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { FACTIONS } from '@gaia/engine';
import type { BuildingSupply, FactionId, PlayerIndex, PlayerState, ResearchTrack } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import {
  BUILDING_COLOR_FILTER,
  advTechTileImage,
  artifactImage,
  boosterImage,
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
  boosterName,
  factionName,
  federationTokenName,
  playerColor,
  shipName,
  techTileName,
  trackName,
} from './display';
import { ExplorationBoard } from './ExplorationBoard';

const TRACK_ORDER: readonly ResearchTrack[] = ['terra', 'nav', 'int', 'gaia', 'eco', 'sci'];
const TRACK_SHORT: Record<ResearchTrack, string> = {
  terra: '地',
  nav: '航',
  int: '智',
  gaia: '盖',
  eco: '经',
  sci: '科',
};

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
  /** 收入轨建筑拖拽源（仅自己的面板且轮到自己时传入；pointerdown 发起拖拽）。 */
  onBuildingDragStart?: ((b: keyof BuildingSupply, e: React.PointerEvent<HTMLImageElement>) => void) | undefined;
}

export function PlayerMat({ state, playerIdx, nickname, isMe, thinking, active, detailed, onShowDetail, onBuildingDragStart }: PlayerMatProps): ReactElement | null {
  const p = state.players[playerIdx];
  const [imgBroken, setImgBroken] = useState(false);
  if (p === undefined) return null;
  const def = FACTIONS[p.faction];
  const color = playerColor(state, playerIdx);
  const passed = state.passedPlayers.includes(playerIdx);
  const cal = factionCalibration(p.faction);
  const legacy = cal.image === null || imgBroken;
  // 详情弹窗用：被高级板覆盖的标准板（仍持有，置灰缩小垫在高级板下）
  const covered = new Set(p.advTechTiles.map((t) => t.covers));
  const uncoveredTech = p.techTiles.filter((t) => !covered.has(t));

  return (
    <section
      className={`player-mat${active === true ? ' active' : ''}${passed ? ' passed' : ''}${detailed === true ? ' detailed' : ''}${legacy ? ' legacy' : ''}`}
      data-testid={`player-mat-${playerIdx}`}
      style={{ borderColor: color }}
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

      {legacy ? (
        <LegacyBoard p={p} playerIdx={playerIdx} color={def.color} />
      ) : (
        <FactionBoard p={p} playerIdx={playerIdx} faction={p.faction} color={def.color} onImgError={() => setImgBroken(true)} onBuildingDragStart={onBuildingDragStart} />
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
              {TRACK_SHORT[t]}
              {p.research[t]}
            </span>
          ))}
        </span>
      </div>

      {p.shuttles.length > 0 || p.artifacts.length > 0 ? (
        <div className="mat-row mat-lf">
          {p.shuttles.map((sh) => (
            <span key={`${sh.ship}-${sh.slot}`} className="lf-chip" title={`${shipName(sh.ship)} ${sh.slot + 1} 号位`}>
              穿梭机·{shipName(sh.ship)}
            </span>
          ))}
          {p.artifacts.map((a) => (
            <img key={a.id} className="tile-img sm artifact" src={artifactImage(a.id)} alt={artifactName(a.id)} title={artifactName(a.id)} />
          ))}
        </div>
      ) : null}

      {detailed === true ? (
        <div className="mat-detail-strip">
          <ExplorationBoard state={state} seat={playerIdx} />
          <TechBoosterStrip state={state} playerIdx={playerIdx} />
        </div>
      ) : null}
    </section>
  );
}

/**
 * 科技板（含高级板/覆盖叠放，可两行）+ 推进片（右对齐满高）横条：
 * 左栏版图下方展示，与详情弹窗 mat-detail-sections 共享覆盖/叠放逻辑。
 * 三者皆空时不渲染（不占纵向空间）。
 */
export function TechBoosterStrip({ state, playerIdx }: { state: FilteredState; playerIdx: PlayerIndex }): ReactElement | null {
  const p = state.players[playerIdx];
  if (p === undefined) return null;
  const covered = new Set(p.advTechTiles.map((t) => t.covers));
  const uncoveredTech = p.techTiles.filter((t) => !covered.has(t));
  if (uncoveredTech.length === 0 && p.advTechTiles.length === 0 && p.booster === null && p.federationTokens.length === 0) return null;
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
          if (item.kind === 'tech') {
            return (
              <img
                key={`tech-${item.id}-${i}`}
                className="tile-img"
                src={techTileImage(item.id as Parameters<typeof techTileImage>[0])}
                alt={techTileName(item.id as Parameters<typeof techTileName>[0])}
                title={techTileName(item.id as Parameters<typeof techTileName>[0])}
              />
            );
          }
          if (item.kind === 'adv') {
            const adv = p.advTechTiles.find((t) => t.id === item.id);
            if (adv === undefined) return null;
            return (
              <span
                key={`adv-${item.id}-${i}`}
                className="tech-stack"
                title={`${advTechTileName(adv.id)}（覆盖 ${techTileName(adv.covers)}）`}
              >
                <img
                  className="tile-img covered"
                  src={techTileImage(adv.covers)}
                  alt={techTileName(adv.covers)}
                  title={`${techTileName(adv.covers)}（被覆盖）`}
                />
                <img className="tile-img adv-top" src={advTechTileImage(adv.id)} alt={advTechTileName(adv.id)} />
              </span>
            );
          }
          const f = fedState(item.id);
          return (
            <img
              key={`fed-${item.id}-${i}`}
              className={`tile-img fed${f?.flipped === true ? ' flipped' : ''}`}
              data-testid={`strip-fed-${playerIdx}-${i}`}
              src={federationTokenImage(item.id as Parameters<typeof federationTokenImage>[0])}
              alt={federationTokenName(item.id as Parameters<typeof federationTokenName>[0])}
              title={`${federationTokenName(item.id as Parameters<typeof federationTokenName>[0])}${f?.flipped === true ? '（已翻灰面）' : ''}`}
            />
          );
        })}
      </div>
      {p.booster !== null ? (
        <div className="strip-boosters">
          <img className="tile-img booster" src={boosterImage(p.booster)} alt={boosterName(p.booster)} title={boosterName(p.booster)} />
        </div>
      ) : null}
    </div>
  );
}

/** 族板整图 + 校准叠加（power/建筑/gaiaformer/脑石）。 */
function FactionBoard({
  p,
  playerIdx,
  faction,
  color,
  onImgError,
  onBuildingDragStart,
}: {
  p: PlayerState;
  playerIdx: PlayerIndex;
  faction: FactionId;
  color: string;
  onImgError: () => void;
  onBuildingDragStart?: ((b: keyof BuildingSupply, e: React.PointerEvent<HTMLImageElement>) => void) | undefined;
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
