/**
 * 回合弧（v6 右栏计分区顶部）：仿实体计分板 ScoreTrack.png——6 张回合计分
 * 图按**圆周** 180°→0° 等角距分布在环上并按径向旋转（左逆右顺、顶部近正立，
 * 彼此几乎贴住），数字圆在内环同角度，中央绿色装饰星球在环心；外圈再绕一圈
 * 7 种母星（terraform 环序，判断母星间距离用）；当前轮金框高亮、过往轮置灰。
 * 纯展示组件。
 *
 * 排布（computeArcLayout 纯函数）：ResizeObserver 量出容器实际宽高后计算——
 * 环心 = 容器底部中央，端点图下缘恰好贴容器底边；母星环不动，扇形集体收紧
 * 贴近中央绿色星球（环半径 = 星球半径 + 图高/2 + 小间隙）；图宽 = 0.6R
 * （相邻弦长 0.62R，几乎贴住不重叠）。无 ResizeObserver 环境（jsdom）回退 210×100。
 */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import type { HomePlanetType } from '@gaia/engine';
import type { FilteredState } from '@gaia/protocol';
import { roundScoringImage } from '../assets';
import { PLANET_COLORS, planetName, roundScoringName } from './display';

/** 母星环（terraform 环序）：terra→oxide→volcanic→desert→swamp→titanium→ice。 */
const HOME_RING: readonly HomePlanetType[] = ['terra', 'oxide', 'volcanic', 'desert', 'swamp', 'titanium', 'ice'];

/** 回合计分图 宽/高。 */
export const ARC_TILE_ASPECT = 0.72;

export interface ArcLayout {
  width: number;
  height: number;
  /** 回合计分图宽/高（px）。 */
  tileWidth: number;
  tileHeight: number;
  /** 数字圆 / 中央装饰星球直径（px）。 */
  numD: number;
  planetD: number;
  /** 环心（= 装饰星球中心）：容器底部中央。 */
  cx: number;
  cy: number;
  /** 圆环半径（px）。 */
  radius: number;
  /** 数字圆内环半径（px）。 */
  numRadius: number;
}

/**
 * 按容器实测宽高计算**圆环**排布：
 * - 6 张图按圆周 180°→0° 等角距（36°）分布，径向旋转（左逆右顺、顶部近正立）；
 * - 母星环不动，**扇形集体收紧贴近中央绿色星球**（环半径 = 星球半径 + 图高/2 + 小间隙；
 *   容器过矮时回缩环半径并同比例缩小星球，保证最高图顶边不越容器顶）；
 * - 环心 = 容器底部中央，端点图下缘恰好贴容器底边；
 * - 数字圆在内环 0.65R，装饰星球在环心。
 */
export function computeArcLayout(width: number, height: number, count = 6): ArcLayout {
  const tileHFrac = 0.6 / ARC_TILE_ASPECT; // ≈0.833
  let maxSin = 0;
  for (let i = 0; i < count; i++) {
    maxSin = Math.max(maxSin, Math.sin(Math.PI * (1 - i / (count - 1))));
  }
  // 收紧：R = 星球半径 + 图高/2 + 0.02R（图环抱星球、几乎贴上；星球直径取容器宽 22%）
  const planetTargetD = width * 0.22;
  let radius = planetTargetD / 2 / (1 - tileHFrac / 2 - 0.02);
  // 容器过矮：最高图顶边不越容器顶（cy = h − max(tileH, planetD)/2 − 0.06h，
  //   top = cy − R·maxSin − tileH/2 ≥ 0 → R ≤ 0.94h/(1 + maxSin)）
  const rHeight = maxSin > 0 ? (height * 0.94) / (1 + maxSin) : Number.POSITIVE_INFINITY;
  radius = Math.max(0, Math.min(radius, rHeight));
  const tileWidth = radius * 0.6;
  const tileHeight = tileWidth / ARC_TILE_ASPECT;
  // 回缩情形下星球同比例缩小（保持在环内侧）
  const planetD = Math.min(planetTargetD, 2 * (radius - tileHeight / 2));
  const cx = width / 2;
  // 环心：最低点（端点图下缘 / 星球底边，取较大者）贴容器底边，整体上移 ~6% 容器高
  const cy = height - Math.max(tileHeight, planetD) / 2 - height * 0.06;
  return {
    width,
    height,
    tileWidth,
    tileHeight,
    numD: radius * 0.16,
    planetD,
    cx,
    cy,
    radius,
    numRadius: radius * 0.65,
  };
}

/** 未测量时的回退尺寸（2.1 宽高比，同 .round-arc 的 aspect-ratio）。 */
const FALLBACK_W = 210;
const FALLBACK_H = 100;

export function RoundArc({ state }: { state: FilteredState }): ReactElement {
  const tiles = state.board.roundScoring;
  const n = tiles.length;
  const gameOver = state.phase === 'game-over';

  // 按容器实测尺寸排布（无 ResizeObserver 环境回退 2.1 宽高比）
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect !== undefined && rect.width > 0 && rect.height > 0) {
        setSize({ w: rect.width, h: rect.height });
      }
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const L = computeArcLayout(size?.w ?? FALLBACK_W, size?.h ?? FALLBACK_H, n);

  return (
    <div className="round-arc" data-testid="round-arc" ref={ref}>
      <div
        className="round-arc-planet"
        aria-hidden="true"
        style={{ width: `${L.planetD.toFixed(2)}px`, top: `${L.cy.toFixed(2)}px` }}
      />
      {/* 母星环（terraform 环序，外圈上缘）：判断母星间距离用 */}
      {HOME_RING.map((p, i) => {
        const ang = Math.PI * (1 - i / (HOME_RING.length - 1));
        const style: CSSProperties = {
          left: `${(L.cx + L.radius * 1.3 * Math.cos(ang)).toFixed(2)}px`,
          top: `${(L.cy - L.radius * 1.3 * Math.sin(ang)).toFixed(2)}px`,
          width: `${(L.numD * 1.7).toFixed(2)}px`,
          background: PLANET_COLORS[p],
        };
        return <span key={p} className="round-arc-home" data-testid={`round-arc-home-${p}`} style={style} title={planetName(p)} />;
      })}
      {tiles.map((t, i) => {
        const ang = Math.PI * (1 - i / (n - 1)); // 180°→0° 半圆
        const cur = !gameOver && state.round === i + 1;
        const past = gameOver || state.round > i + 1;
        // 外环：图中心在圆周上，按径向旋转（左逆右顺、顶部近正立，彼此几乎贴住）
        const radialDeg = 90 - (ang * 180) / Math.PI;
        const tileStyle: CSSProperties = {
          left: `${(L.cx + L.radius * Math.cos(ang)).toFixed(2)}px`,
          top: `${(L.cy - L.radius * Math.sin(ang)).toFixed(2)}px`,
          width: `${L.tileWidth.toFixed(2)}px`,
          transform: `translate(-50%, -50%) rotate(${radialDeg.toFixed(1)}deg)`,
        };
        // 内环：数字圆同角度
        const numStyle: CSSProperties = {
          left: `${(L.cx + L.numRadius * Math.cos(ang)).toFixed(2)}px`,
          top: `${(L.cy - L.numRadius * Math.sin(ang)).toFixed(2)}px`,
          width: `${L.numD.toFixed(2)}px`,
        };
        return (
          <div key={`${t}-${i}`}>
            <img
              className={`round-arc-tile${cur ? ' cur' : ''}${past ? ' past' : ''}`}
              style={tileStyle}
              src={roundScoringImage(t)}
              alt={roundScoringName(t)}
              title={`第 ${i + 1} 轮：${roundScoringName(t)}`}
              data-testid={`round-arc-tile-${i + 1}`}
            />
            <span className={`round-arc-num${cur ? ' cur' : ''}`} style={numStyle} data-testid={`round-arc-num-${i + 1}`}>
              {i + 1}
            </span>
          </div>
        );
      })}
    </div>
  );
}
