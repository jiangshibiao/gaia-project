/**
 * SVG 棋盘（美术重构）：原版扇区整版扫描图作底 + 素材叠加层。
 *
 * 几何：axial (q,r) → pixel，**flat-top**（x = 1.5·size·q，
 * y = √3·size·(r + q/2)，y 向下）。与引擎 buildMap 的 rotateRight
 * 同向——rotateRight 在本像素系为屏幕顺时针 60°（已用校准叠加图验证）。
 *
 * 底图层：
 * - 标准扇区：placements 反推出 (center, rotation) 后，整版扫描图按
 *   calibration 的 (cx,cy,size) 对齐到扇区中心 hex，并旋转
 *   (rotation − CALIBRATION_ROTATION)×60°（图像内容固定 = layout 旋转 4）；
 * - LF 深空三角板：map_deep_<tile><side>.png 按 placements 的锚点/旋转放置；
 * - LF Interspace：map_interspace_*.png 单格图（飞船格为船徽图）。
 *
 * 叠加层：星球（仅"与原画不同"的——gaia 转化/失落星球/无原画格）、
 * 建筑棋子图（buildings/*，LF 青/粉用近似色+hue-rotate）、lantids 附加矿、
 * 卫星（色点）、gaiaformer（GF 图）、进行中盖亚计划、power ring（powerring.png）、
 * 飞船格徽标、联邦标记点。交互层保留透明 hex 热区/高亮/tooltip。
 *
 * 整体旋转：内层 g.board-rotate 绕全图中心转任意角度（viewBox 缩放/平移数学
 * 不变——自适应 viewBox 用 rotatedViewBox 外接矩形；拖拽落点经 toSvgPoint
 * 反旋转回 hex 坐标系）。默认取向 = 全图 hex 中心旋转后包围盒宽度最大的角度
 * （bestHorizontalRotation，最宽轴严格水平）。控件角度一律为**相对默认水平
 * 的偏移角**：默认显示 0.0°，+60° 显示 60.0°，「回到水平」= 偏移归零；
 * 内部渲染角 = defaultDeg + offset。右上角控件：⟳ 手柄拖拽自由旋转（屏幕
 * 坐标系取方位角——拖拽开始时用当次 CTM 把旋转中心投影到 client 坐标并缓存，
 * 之后 move 直接对屏幕中心取 atan2，不受 viewBox 随角度重适配影响）/ ±15°
 * 微调 / +60° 步进 / 回到水平；双击复位 = 默认水平 + 自适应。
 *
 * 交互契约（BoardSvg.test 守护）：
 * g.board-hex[data-hex]、g.hex-planet[data-planet]、
 * g.hex-building[data-building][data-player]、polygon.hex-highlight、
 * polygon.hex-hit、div[data-testid="hex-tooltip"]、g.hex-ship[data-ship]。
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import { FACTIONS, parseHexKey } from '@gaia/engine';
import type { BuildingType, HexKey, HexState, PlanetType, PlayerIndex, ShipId } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import {
  BUILDING_COLOR_FILTER,
  POWER_RING_IMAGE,
  buildingImage,
  buildingImageTrimmed,
  deepSpaceImage,
  interspaceImage,
  markerImage,
  planetTexture,
  sectorImage,
} from '../assets';
import { PLANET_COLORS, buildingName, factionName, planetName, playerColor, shipName } from '../game/display';
import { computePlacements } from './placements';
import type { MapPlacements } from './placements';
import {
  DEEP_IMAGE_ANCHOR,
  DEEP_IMAGE_HEIGHT,
  DEEP_IMAGE_HEX_SIZE,
  DEEP_IMAGE_WIDTH,
  INTERSPACE_IMAGE_HEIGHT,
  INTERSPACE_IMAGE_WIDTH,
} from './placements';
import {
  CALIBRATION_ROTATION,
  GLOBAL_SECTOR_CALIBRATION,
  SECTOR_IMAGE_HEIGHT,
  SECTOR_IMAGE_WIDTH,
} from './sector-calibration';
import { bestHorizontalRotation, clampZoom, formatViewBox, panViewBox, parseViewBox, rotatedPointsViewBox, zoomViewBox } from './viewport';
import type { ViewBox } from './viewport';

/** 单 hex 外接圆半径（SVG 单位）。 */
export const HEX_SIZE = 30;

const SQRT3 = Math.sqrt(3);

/** axial → pixel（flat-top，y 向下）。 */
export function hexToPixel(q: number, r: number): { x: number; y: number } {
  return { x: HEX_SIZE * 1.5 * q, y: HEX_SIZE * SQRT3 * (r + q / 2) };
}

/** flat-top 六边形角点（cx,cy 为中心，左右为顶点）。 */
export function hexPoints(cx: number, cy: number, size: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push(`${(cx + size * Math.cos(angle)).toFixed(2)},${(cy + size * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(' ');
}

/** 全图 viewBox（按 hex 范围 + 边距容纳扇区图描边）。 */
export function boardViewBox(map: Record<HexKey, HexState>): string {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const key of Object.keys(map) as HexKey[]) {
    const { q, r } = parseHexKey(key);
    const { x, y } = hexToPixel(q, r);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return '0 0 100 100';
  const pad = HEX_SIZE * 0.8;
  return `${(minX - pad).toFixed(1)} ${(minY - pad).toFixed(1)} ${(maxX - minX + pad * 2).toFixed(1)} ${(maxY - minY + pad * 2).toFixed(1)}`;
}

export interface BoardSvgProps {
  state: FilteredState;
  /** 当前选中行动类型的可选 hex（发光描边 + 可点）。 */
  highlights?: ReadonlySet<HexKey> | undefined;
  /** 次级候选 hex（弱高亮，同样可点：联邦卫星选择态里非最少方案的格）。 */
  dimHighlights?: ReadonlySet<HexKey> | undefined;
  /** 行动红框 hex（~5s 的提示性红框，不可点；建矿位/触发格等）。 */
  flashHexes?: readonly HexKey[] | undefined;
  onHexClick?: ((hex: HexKey) => void) | undefined;
  /** 点击飞船格（非选择态）→ 打开舰队面板。 */
  onShipClick?: ((ship: ShipId) => void) | undefined;
  /** 拖拽吸附预览：在 hex 上半透明显示将放置的建筑（跟随 snapHex 结果）。 */
  snapPreview?: { hex: HexKey; building: BuildingType; player: PlayerIndex } | null | undefined;
  /** 联邦卫星选择态：已选卫星格（蓝点标记）。 */
  selectedHexes?: ReadonlySet<HexKey> | undefined;
  /** 拖拽 token 期间关闭 hex tooltip（避免随光标乱弹）。 */
  suppressHover?: boolean | undefined;
}

/** 暴露给父组件（GameScreen 拖拽落点换算用）。 */
export interface BoardSvgHandle {
  /** client 坐标 → SVG 坐标（getScreenCTM 逆变换；svg 不可达时 null）。 */
  toSvgPoint: (clientX: number, clientY: number) => { x: number; y: number } | null;
}

interface HoverInfo {
  hex: HexKey;
  x: number;
  y: number;
}

/** 飞船徽标首字母。 */
const SHIP_BADGE: Record<ShipId, string> = {
  twilight: 'T',
  rebellion: 'R',
  tfmars: 'M',
  eclipse: 'E',
};

/** 各建筑类型的绘制边长（×HEX_SIZE，trim 图 = 可见大小）。 */
const BUILDING_DRAW_SIZE: Record<BuildingType, number> = {
  mine: 0.9,
  ts: 1.1,
  lab: 1.15,
  pi: 1.35,
  ac1: 1.35,
  ac2: 1.35,
  gf: 1.0,
  sp: 1.1,
};

/** 建筑棋子图（以 hex 中心为原点绘制，trim 图裁过透明边距）。 */
function BuildingImage({ state, type, player }: { state: FilteredState; type: BuildingType; player: PlayerIndex }): ReactElement {
  const faction = state.players[player]?.faction;
  const color = faction !== undefined ? FACTIONS[faction].color : 'white';
  const filter = BUILDING_COLOR_FILTER[color];
  const w = HEX_SIZE * (BUILDING_DRAW_SIZE[type] ?? 0.9);
  return (
    <image
      className="building-img"
      href={buildingImageTrimmed(type, color)}
      x={-w / 2}
      y={-w / 2}
      width={w}
      height={w}
      style={filter !== undefined ? { filter } : undefined}
    />
  );
}

/**
 * 星球叠加贴图的绘制半径（×HEX_SIZE）：让贴图可见圆盘与原画印刷星球等大。
 * 原画印刷星球半径经圆拟合实测 ≈ 52.5 图内 px（= 0.646·HEX_SIZE；transdim
 * 较小 ≈ 43 px = 0.53·HEX_SIZE）；各贴图 PNG 的透明边距不同（内容填充：
 * gaia 88.7%、transdim 66.1%、asteroid/proto ≈100%），故按填充率折算绘制半径。
 * 此前统一 0.58 导致盖亚转化后的贴图比原画星球小约 20%，盖不住底下印刷星球。
 */
const PLANET_TEXTURE_R: Partial<Record<PlanetType, number>> = {
  gaia: HEX_SIZE * 0.73,
  transdim: HEX_SIZE * 0.8,
  asteroid: HEX_SIZE * 0.65,
  proto: HEX_SIZE * 0.65,
};
/** 无贴图星球（lost 等）的纯色圆半径 = 印刷星球半径。 */
const PLANET_CIRCLE_R = HEX_SIZE * 0.65;

/** 星球覆盖层（仅当当前内容与原画不同，或该格无原画时才有可见内容）。 */
function PlanetOverlay({ hex, artPlanet, hasArt }: { hex: HexState; artPlanet: string | undefined; hasArt: boolean }): ReactElement | null {
  if (hex.planet === 'empty') return null;
  const differs = artPlanet === undefined || hex.planet !== artPlanet;
  if (!differs && hasArt) return null;
  const texture = planetTexture(hex.planet);
  if (differs && texture !== null) {
    const r = PLANET_TEXTURE_R[hex.planet] ?? PLANET_CIRCLE_R;
    return <image className="planet-texture" href={texture} x={-r} y={-r} width={r * 2} height={r * 2} />;
  }
  const r = PLANET_CIRCLE_R;
  return (
    <>
      <circle r={r} fill={PLANET_COLORS[hex.planet]} stroke="rgba(0,0,0,0.45)" strokeWidth={1.2} />
      {hex.planet === 'lost' ? (
        <image href={markerImage('LostPlanet')} x={-r * 0.7} y={-r * 0.7} width={r * 1.4} height={r * 1.4} />
      ) : null}
    </>
  );
}

/** 扇区整版底图。 */
function SectorLayer({ placements }: { placements: MapPlacements }): ReactElement {
  return (
    <g className="layer-sectors">
      {placements.sectors.map((p) => {
        const cal = GLOBAL_SECTOR_CALIBRATION;
        const src = sectorImage(p.id);
        if (src === null) return null;
        const { x, y } = hexToPixel(p.center.q, p.center.r);
        const deg = (p.rotation - CALIBRATION_ROTATION) * 60;
        const scale = HEX_SIZE / cal.size;
        return (
          <g key={p.id} transform={`translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${deg}) scale(${scale.toFixed(4)})`}>
            <image
              className="sector-img"
              data-sector={p.id}
              href={src}
              x={-cal.cx}
              y={-cal.cy}
              width={SECTOR_IMAGE_WIDTH}
              height={SECTOR_IMAGE_HEIGHT}
            />
          </g>
        );
      })}
    </g>
  );
}

/** 深空三角板底图。 */
function DeepSpaceLayer({ placements }: { placements: MapPlacements }): ReactElement {
  return (
    <g className="layer-deep-space">
      {placements.deepSpace.map((p) => {
        const { x, y } = hexToPixel(p.anchor.q, p.anchor.r);
        const scale = HEX_SIZE / DEEP_IMAGE_HEX_SIZE;
        // 镜像（y→-y）在旋转之前施加于图像局部坐标（与 placements 的 cube 镜像一致）
        return (
          <g
            key={`${p.tile}${p.side}-${p.anchor.q},${p.anchor.r}`}
            transform={`translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${p.rotation * 60}) scale(${scale.toFixed(4)},${(p.mirror ? -scale : scale).toFixed(4)})`}
          >
            <image
              className="deep-space-img"
              data-tile={p.tile}
              data-side={p.side}
              href={deepSpaceImage(p.tile, p.side)}
              x={-DEEP_IMAGE_ANCHOR.x}
              y={-DEEP_IMAGE_ANCHOR.y}
              width={DEEP_IMAGE_WIDTH}
              height={DEEP_IMAGE_HEIGHT}
            />
          </g>
        );
      })}
    </g>
  );
}

export const BoardSvg = forwardRef<BoardSvgHandle, BoardSvgProps>(function BoardSvg({ state, highlights, dimHighlights, flashHexes, onHexClick, onShipClick, snapPreview, selectedHexes, suppressHover }, ref): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);
  /** 当前视口（null = 自适应全图）。 */
  const [view, setView] = useState<ViewBox | null>(null);
  const zoomRef = useRef(1);
  const viewRef = useRef<ViewBox | null>(null);
  viewRef.current = view;
  /** 拖拽抑制 click（拖动 > 4px 后不触发 hex 点击）。 */
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; startView: ViewBox; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  const fitViewBox = useMemo(() => boardViewBox(state.map), [state.map]);
  const placements = useMemo(() => computePlacements(state.map), [state.map]);

  /** 全图未旋转的自适应矩形（旋转基准 = 其中心）。 */
  const baseFit = useMemo(() => parseViewBox(fitViewBox), [fitViewBox]);
  const rotCx = baseFit.x + baseFit.w / 2;
  const rotCy = baseFit.y + baseFit.h / 2;
  /** 全图 hex 中心（最优水平取向扫描输入）。 */
  const mapPoints = useMemo(
    () =>
      (Object.keys(state.map) as HexKey[]).map((key) => {
        const { q, r } = parseHexKey(key);
        return hexToPixel(q, r);
      }),
    [state.map],
  );
  /** 默认取向：任意角度扫描，旋转后包围盒宽度最大（最宽轴严格水平）。 */
  const defaultDeg = useMemo(() => bestHorizontalRotation(mapPoints, rotCx, rotCy), [mapPoints, rotCx, rotCy]);
  /** 相对默认水平的偏移角（控件显示/存储语义；0 = 默认水平）。 */
  const [rotOffset, setRotOffset] = useState(0);
  /** 内部渲染角 = 默认水平角 + 偏移。 */
  const deg = defaultDeg + rotOffset;
  const rotRef = useRef({ deg: 0, cx: 0, cy: 0 });
  rotRef.current = { deg, cx: rotCx, cy: rotCy };

  /** 自适应 viewBox：旋转后 hex 中心的紧致包围盒（不再用旋转矩形的外接——它会无谓放大包围盒）。 */
  const rotatedFit = useMemo(
    () => formatViewBox(rotatedPointsViewBox(mapPoints, rotCx, rotCy, deg, HEX_SIZE * 0.8)),
    [mapPoints, rotCx, rotCy, deg],
  );
  const fitRef = useRef(rotatedFit);
  fitRef.current = rotatedFit;
  const viewBox = view !== null ? formatViewBox(view) : rotatedFit;

  /** 当前实际视口矩形。 */
  const currentView = (): ViewBox => viewRef.current ?? parseViewBox(fitRef.current);

  /** 屏幕坐标 → SVG user 坐标（CTM 逆变换，viewBox 空间；不做反旋转）。 */
  const toSvgPointRaw = (clientX: number, clientY: number): { x: number; y: number } | null => {
    try {
      const svg = svgRef.current;
      const ctm = svg?.getScreenCTM();
      if (svg == null || ctm == null) return null;
      const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
      return { x: p.x, y: p.y };
    } catch {
      return null; // jsdom 等无完整 SVG 几何实现的环境
    }
  };

  /** 屏幕坐标 → 地图内容（hex）坐标：在 raw 基础上反旋转当前角度（拖拽落点 snapHex 输入）。 */
  const toSvgPoint = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const p = toSvgPointRaw(clientX, clientY);
    if (p === null) return null;
    const { deg: d, cx, cy } = rotRef.current;
    if (d === 0) return p;
    const rad = (-d * Math.PI) / 180;
    const dx = p.x - cx;
    const dy = p.y - cy;
    return {
      x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
      y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
    };
  };

  // 拖拽落点换算暴露给 GameScreen（token 拖拽的 snapHex 输入）。
  useImperativeHandle(ref, () => ({ toSvgPoint }));

  // 滚轮缩放（非 passive 监听，光标为中心，0.3×–4×）。
  useEffect(() => {
    const el = containerRef.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const center = toSvgPointRaw(e.clientX, e.clientY);
      if (center === null) return;
      const next = clampZoom(zoomRef.current * Math.exp(-e.deltaY * 0.0015));
      const scale = next / zoomRef.current;
      if (scale === 1) return;
      zoomRef.current = next;
      setView(zoomViewBox(currentView(), center, scale));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitViewBox]);

  const onPointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startView: currentView(),
      moved: false,
    };
    // 注意：不在此处 setPointerCapture——capture 会使后续 click 重定向到
    // svg 而非 hex polygon；等真正开始拖动（>4px）时再 capture。
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== e.pointerId) return;
    const dxPx = e.clientX - drag.startX;
    const dyPx = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dxPx, dyPx) < 4) return;
    if (!drag.moved) {
      drag.moved = true;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    }
    // 屏幕像素 → SVG 单位（meet 均匀缩放，ctm.a = ctm.d = 缩放比）。
    const ctm = svgRef.current?.getScreenCTM();
    const perPx = ctm != null && ctm.a !== 0 ? 1 / ctm.a : 1;
    setView(panViewBox(drag.startView, -dxPx * perPx, -dyPx * perPx));
  };

  const onPointerUp = (e: React.PointerEvent): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== e.pointerId) return;
    if (drag.moved) suppressClickRef.current = true;
    dragRef.current = null;
  };

  /** 双击复位到默认水平 + 自适应全图。 */
  const onDoubleClick = (): void => {
    zoomRef.current = 1;
    setView(null);
    setRotOffset(0);
  };

  /** 角度归一到 (−180, 180]。 */
  const normDeg = (d: number): number => {
    const n = ((((d + 180) % 360) + 360) % 360) - 180;
    return Math.abs(n) < 1e-9 ? 0 : Math.round(n * 10) / 10;
  };

  /** 旋转手柄拖拽：绕全图中心自由旋转（实时角度）。 */
  const rotDragRef = useRef<{
    pointerId: number;
    /** 旋转中心的屏幕坐标（拖拽开始时用当次 CTM 投影并缓存）。 */
    centerX: number;
    centerY: number;
    startAngle: number;
    startOffset: number;
  } | null>(null);
  /** client 坐标 → 旋转中心的屏幕坐标（viewBox 会随角度重适配，只在拖拽开始时投影一次）。 */
  const screenCenter = (): { x: number; y: number } | null => {
    try {
      const ctm = svgRef.current?.getScreenCTM();
      if (ctm == null) return null;
      const p = new DOMPoint(rotCx, rotCy).matrixTransform(ctm);
      return { x: p.x, y: p.y };
    } catch {
      return null; // jsdom 等无完整 SVG 几何实现的环境
    }
  };
  const onRotatePointerDown = (e: React.PointerEvent): void => {
    if (e.button !== 0) return;
    const c = screenCenter();
    if (c === null) return;
    e.stopPropagation(); // 不触发棋盘平移
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    rotDragRef.current = {
      pointerId: e.pointerId,
      centerX: c.x,
      centerY: c.y,
      startAngle: (Math.atan2(e.clientY - c.y, e.clientX - c.x) * 180) / Math.PI,
      startOffset: rotOffset,
    };
  };
  const onRotatePointerMove = (e: React.PointerEvent): void => {
    const drag = rotDragRef.current;
    if (drag === null || drag.pointerId !== e.pointerId) return;
    // 屏幕坐标系取角：不经过 viewBox，避免 rotatedFit 重适配导致的角度漂移
    const a = (Math.atan2(e.clientY - drag.centerY, e.clientX - drag.centerX) * 180) / Math.PI;
    setRotOffset(normDeg(drag.startOffset + (a - drag.startAngle)));
  };
  const onRotatePointerUp = (e: React.PointerEvent): void => {
    if (rotDragRef.current?.pointerId === e.pointerId) rotDragRef.current = null;
  };

  /** 拖拽后的 click 抑制（避免平移结束误触 hex 点击）。 */
  const onClickCapture = (e: React.SyntheticEvent): void => {
    if (suppressClickRef.current) {
      e.stopPropagation();
      suppressClickRef.current = false;
    }
  };

  /** 有原画覆盖的格（标准扇区成功摆放 / 深空 / Interspace）。 */
  const artCovered = useMemo(() => {
    const covered = new Set<HexKey>();
    for (const p of placements.sectors) {
      // 标准扇区 19 格：以中心半径 2 内且 sector 匹配的格
      for (const [key, hex] of Object.entries(state.map) as [HexKey, HexState][]) {
        if (hex.sector === p.id) covered.add(key);
      }
    }
    for (const [key, hex] of Object.entries(state.map) as [HexKey, HexState][]) {
      if (hex.deepSpace || hex.sector === 'interspace') covered.add(key);
    }
    return covered;
  }, [placements, state.map]);

  const entries = useMemo(
    () =>
      (Object.entries(state.map) as [HexKey, HexState][]).map(([key, hex]) => {
        const { q, r } = parseHexKey(key);
        return { key, hex, ...hexToPixel(q, r) };
      }),
    [state.map],
  );

  /** Interspace 单格底图。 */
  const interspaceCells = useMemo(
    () => entries.filter(({ hex }) => hex.sector === 'interspace'),
    [entries],
  );

  /** 盖亚计划进行中的 hex → 所属玩家。 */
  const gaiaProjects = useMemo(() => {
    const m = new Map<HexKey, PlayerIndex>();
    for (const p of state.gaiaProjectsInProgress) m.set(p.hex, p.player);
    return m;
  }, [state.gaiaProjectsInProgress]);

  const updateHover = (hex: HexKey, e: React.MouseEvent): void => {
    if (suppressHover === true) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setHover({ hex, x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12 });
  };

  const hoverHex = hover !== null ? state.map[hover.hex] : undefined;

  return (
    <div className="board-wrap" ref={containerRef} data-testid="board-wrap">
      <svg
        className="board-svg"
        ref={svgRef}
        viewBox={viewBox}
        role="img"
        aria-label="星图"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onClickCapture={onClickCapture}
      >
        <defs>
          {/* 建筑棋子白边加粗：alpha 外扩一圈填白垫在棋子下（原素材白边偏细，
              深空底上看不清整体轮廓）。radius 取 user units（≈棋子边 4%）。 */}
          <filter id="building-outline" x="-20%" y="-20%" width="140%" height="140%">
            <feMorphology in="SourceAlpha" operator="dilate" radius="1.2" result="grow" />
            <feFlood floodColor="#ffffff" result="white" />
            <feComposite in="white" in2="grow" operator="in" result="outline" />
            <feMerge>
              <feMergeNode in="outline" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <g className="board-rotate" transform={`rotate(${deg} ${rotCx.toFixed(2)} ${rotCy.toFixed(2)})`}>
          <SectorLayer placements={placements} />
          <DeepSpaceLayer placements={placements} />
          <g className="layer-interspace">
            {interspaceCells.map(({ key, hex, x, y }) => {
              const scale = (HEX_SIZE * 2.1) / INTERSPACE_IMAGE_WIDTH;
              const w = INTERSPACE_IMAGE_WIDTH * scale;
              const h = INTERSPACE_IMAGE_HEIGHT * scale;
              return (
                <image
                  key={key}
                  className="interspace-img"
                  href={interspaceImage(hex.planet, hex.ship)}
                  x={x - w / 2}
                  y={y - h / 2}
                  width={w}
                  height={h}
                />
              );
            })}
          </g>
  
          {entries.map(({ key, hex, x, y }) => {
            const highlighted = highlights?.has(key) === true;
            const dim = !highlighted && dimHighlights?.has(key) === true;
            const clickable = highlighted || dim;
            const hasArt = artCovered.has(key);
            const projectOwner = gaiaProjects.get(key);
            return (
              <g key={key} className="board-hex" data-hex={key} transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}>
                {!hasArt ? (
                  <polygon
                    className={`hex-cell${hex.deepSpace ? ' deep-space' : hex.planet === 'empty' ? ' interspace' : ''}`}
                    data-sector={hex.sector}
                    points={hexPoints(0, 0, HEX_SIZE - 1)}
                  />
                ) : (
                  // 原画覆盖格：扇区图自带的网格线在地图外缘没有闭合描边，
                  // 补一个只描边的六边形，让边缘格也有蓝色外框。
                  <polygon className="hex-edge" points={hexPoints(0, 0, HEX_SIZE - 1)} />
                )}
                {hex.planet !== 'empty' ? (
                  <g className="hex-planet" data-planet={hex.planet}>
                    <PlanetOverlay hex={hex} artPlanet={placements.artPlanet.get(key)} hasArt={hasArt} />
                  </g>
                ) : null}
                {hex.powerRing === true ? (
                  <image
                    className="hex-power-ring"
                    href={POWER_RING_IMAGE}
                    x={-HEX_SIZE * 0.5}
                    y={-HEX_SIZE * 0.5}
                    width={HEX_SIZE}
                    height={HEX_SIZE}
                  />
                ) : null}
                {hex.building !== undefined ? (
                  <g
                    className="hex-building"
                    data-building={hex.building.type}
                    data-player={hex.building.player}
                    filter="url(#building-outline)"
                  >
                    <BuildingImage state={state} type={hex.building.type} player={hex.building.player} />
                  </g>
                ) : null}
                {hex.additionalMine !== undefined ? (
                  <g className="hex-additional-mine" data-player={hex.additionalMine} filter="url(#building-outline)">
                    {/* 附加矿（Lantids 在对手星球上的矿）：移到角落与主建筑错开 */}
                    <image
                      href={buildingImageTrimmed('mine', FACTIONS[state.players[hex.additionalMine]?.faction ?? 'terrans'].color)}
                      x={HEX_SIZE * 0.42}
                      y={HEX_SIZE * 0.42}
                      width={HEX_SIZE * 0.42}
                      height={HEX_SIZE * 0.42}
                      style={(() => {
                        const c = FACTIONS[state.players[hex.additionalMine]?.faction ?? 'terrans'].color;
                        const f = BUILDING_COLOR_FILTER[c];
                        return f !== undefined ? { filter: f } : undefined;
                      })()}
                    />
                  </g>
                ) : null}
                {hex.satelliteOf !== undefined ? (
                  <circle
                    className="hex-satellite"
                    data-player={hex.satelliteOf}
                    cx={0}
                    cy={0}
                    r={HEX_SIZE * 0.18}
                    fill={playerColor(state, hex.satelliteOf)}
                    stroke="#101418"
                    strokeWidth={1}
                  />
                ) : null}
                {hex.gaiaformerOf !== undefined || projectOwner !== undefined ? (
                  <g
                    className={`hex-gaiaformer${hex.gaiaformerOf === undefined ? ' in-progress' : ''}`}
                    data-player={hex.gaiaformerOf ?? projectOwner}
                    filter="url(#building-outline)"
                  >
                    <image
                      href={buildingImageTrimmed('gf', FACTIONS[state.players[hex.gaiaformerOf ?? projectOwner ?? 0]?.faction ?? 'terrans'].color)}
                      x={-HEX_SIZE * 0.42}
                      y={-HEX_SIZE * 0.42}
                      width={HEX_SIZE * 0.84}
                      height={HEX_SIZE * 0.84}
                      style={(() => {
                        const c = FACTIONS[state.players[hex.gaiaformerOf ?? projectOwner ?? 0]?.faction ?? 'terrans'].color;
                        const f = BUILDING_COLOR_FILTER[c];
                        return f !== undefined ? { filter: f } : undefined;
                      })()}
                    />
                  </g>
                ) : null}
                {hex.ship !== undefined ? (
                  <g className="hex-ship" data-ship={hex.ship}>
                    <text
                      className="ship-badge"
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={HEX_SIZE * 0.34}
                      y={HEX_SIZE * 0.66}
                      fill="#eaf4ff"
                      stroke="#10202f"
                      strokeWidth={0.6}
                    >
                      {SHIP_BADGE[hex.ship]}
                    </text>
                  </g>
                ) : null}
                {hex.federations.length > 0 ? (
                  <g className="hex-federations">
                    {hex.federations.map((p, i) => (
                      <circle
                        key={p}
                        data-player={p}
                        cx={(i - (hex.federations.length - 1) / 2) * HEX_SIZE * 0.22}
                        cy={HEX_SIZE * 0.78}
                        r={HEX_SIZE * 0.08}
                        fill={playerColor(state, p)}
                        stroke="#101418"
                        strokeWidth={0.8}
                      />
                    ))}
                  </g>
                ) : null}
                {highlighted ? (
                  <polygon className={`hex-highlight${dim ? ' dim' : ''}`} points={hexPoints(0, 0, HEX_SIZE - 1)} />
                ) : null}
                {flashHexes?.includes(key) === true ? (
                  <polygon className="hex-flash" data-testid={`hex-flash-${key}`} points={hexPoints(0, 0, HEX_SIZE - 1)} />
                ) : null}
                {selectedHexes?.has(key) === true ? (
                  <circle
                    className="hex-sat-pick"
                    data-testid={`hex-sat-pick-${key}`}
                    cx={0}
                    cy={0}
                    r={HEX_SIZE * 0.18}
                    fill="#7ecfff"
                    stroke="#0f2f4a"
                    strokeWidth={1.2}
                  />
                ) : null}
                <polygon
                  className={`hex-hit${clickable ? ' clickable' : ''}`}
                  points={hexPoints(0, 0, HEX_SIZE - 1)}
                  onClick={
                    clickable && onHexClick !== undefined
                      ? () => onHexClick(key)
                      : hex.ship !== undefined && onShipClick !== undefined
                        ? () => onShipClick(hex.ship as ShipId)
                        : undefined
                  }
                  onMouseEnter={(e) => updateHover(key, e)}
                  onMouseMove={(e) => updateHover(key, e)}
                  onMouseLeave={() => setHover(null)}
                />
              </g>
            );
          })}
          {/* 拖拽吸附预览：落点合法时半透明预显将放置的建筑 */}
          {snapPreview != null ? (() => {
            const { q, r } = parseHexKey(snapPreview.hex);
            const { x, y } = hexToPixel(q, r);
            return (
              <g
                className="drag-snap-preview"
                data-testid="drag-snap-preview"
                transform={`translate(${x.toFixed(2)},${y.toFixed(2)})`}
                opacity={0.72}
                pointerEvents="none"
              >
                <polygon className="hex-highlight snap" points={hexPoints(0, 0, HEX_SIZE - 1)} />
                <g filter="url(#building-outline)">
                  <BuildingImage state={state} type={snapPreview.building} player={snapPreview.player} />
                </g>
              </g>
            );
          })() : null}
        </g>
      </svg>
      <div className="board-rotate-ctl">
        <span
          className="rotate-handle"
          data-testid="board-rotate-handle"
          title="按住拖拽：绕中心自由旋转"
          onPointerDown={onRotatePointerDown}
          onPointerMove={onRotatePointerMove}
          onPointerUp={onRotatePointerUp}
          onPointerCancel={onRotatePointerUp}
        >
          ⟳
        </span>
        <button
          type="button"
          data-testid="board-rotate-fine-dec"
          title="微调 −15°"
          onClick={() => setRotOffset(normDeg(rotOffset - 15))}
        >
          −15°
        </button>
        <button
          type="button"
          data-testid="board-rotate-fine-inc"
          title="微调 +15°"
          onClick={() => setRotOffset(normDeg(rotOffset + 15))}
        >
          +15°
        </button>
        <button
          type="button"
          data-testid="board-rotate-btn"
          title={`步进 60°（当前偏移 ${rotOffset.toFixed(1)}°，0° = 默认水平）`}
          onClick={() => setRotOffset(normDeg(rotOffset + 60))}
        >
          +60°
        </button>
        <span className="rotate-deg" data-testid="board-rotate-deg">
          {rotOffset.toFixed(1)}°
        </span>
        {Math.abs(rotOffset) > 0.05 ? (
          <button
            type="button"
            data-testid="board-rotate-reset"
            title="回到水平（偏移归零，最宽轴严格水平）"
            onClick={() => setRotOffset(0)}
          >
            回到水平
          </button>
        ) : null}
      </div>
      {hover !== null && hoverHex !== undefined ? (
        <div className="hex-tooltip" data-testid="hex-tooltip" style={{ left: hover.x, top: hover.y }}>
          <div className="tooltip-title">
            {hover.hex} · {planetName(hoverHex.planet)}
          </div>
          <div>
            扇区 {hoverHex.sector}
            {hoverHex.deepSpace ? '（深空）' : ''}
          </div>
          {hoverHex.building !== undefined ? (
            <div>
              {buildingName(hoverHex.building.type)} · {factionName(state.players[hoverHex.building.player]?.faction ?? 'terrans')}
            </div>
          ) : null}
          {hoverHex.satelliteOf !== undefined ? <div>卫星 · {factionName(state.players[hoverHex.satelliteOf]?.faction ?? 'terrans')}</div> : null}
          {hoverHex.ship !== undefined ? <div>飞船 · {shipName(hoverHex.ship)}（点击查看舰队面板）</div> : null}
        </div>
      ) : null}
    </div>
  );
});
