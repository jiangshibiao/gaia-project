/**
 * BoardSvg 渲染契约测试（美术重构）：
 * - g.board-hex[data-hex] 数量 = 地图 hex 数；
 * - 星球/建筑/飞船的 data 属性；
 * - 高亮类名（hex-highlight + hex-hit.clickable）与点击回调；
 * - hover tooltip 展示 hex 信息；
 * - 原版素材底图：10 块标准扇区整版图 + 8 块深空三角板 + Interspace 单格图。
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { filterStateFor } from '@gaia/protocol';
import { applyAction, newGame, parseHexKey } from '@gaia/engine';
import type { HexKey } from '@gaia/engine';
import { BoardSvg, boardViewBox, hexToPixel } from './BoardSvg';
import { bestHorizontalRotation, parseViewBox, rotatedViewBox } from './viewport';

function fixture() {
  const game = newGame({
    playerCount: 4,
    seed: 42,
    factions: ['terrans', 'xenos', 'geodens', 'itars'],
    lostFleet: true,
  });
  return filterStateFor(game);
}

describe('<BoardSvg> 渲染契约', () => {
  it('每个地图 hex 渲染一个 g.board-hex[data-hex]', () => {
    const state = fixture();
    const { container } = render(<BoardSvg state={state} />);
    const hexes = container.querySelectorAll('g.board-hex');
    const expected = Object.keys(state.map).length;
    expect(hexes).toHaveLength(expected);
    // data-hex 属性与地图 key 一一对应
    const keys = new Set([...hexes].map((el) => el.getAttribute('data-hex')));
    for (const k of Object.keys(state.map)) {
      expect(keys.has(k)).toBe(true);
    }
  });

  it('非空 hex 渲染 hex-planet[data-planet]；深空/Interspace 空格不渲染', () => {
    const state = fixture();
    const { container } = render(<BoardSvg state={state} />);
    const planets = container.querySelectorAll('g.hex-planet');
    const nonEmpty = Object.values(state.map).filter((hx) => hx.planet !== 'empty').length;
    expect(planets).toHaveLength(nonEmpty);
    const types = new Set([...planets].map((el) => el.getAttribute('data-planet')));
    // 7 母星类型至少出现其一（LF 地图含全部基础星球类型）
    expect(types.has('transdim') || types.has('gaia')).toBe(true);
  });

  it('viewBox 自动适配全图（有限且非退化）', () => {
    const state = fixture();
    const vb = boardViewBox(state.map).split(' ').map(Number);
    expect(vb).toHaveLength(4);
    expect(vb.every((n) => Number.isFinite(n))).toBe(true);
    expect(vb[2]).toBeGreaterThan(0);
    expect(vb[3]).toBeGreaterThan(0);
  });

  it('highlights 中的 hex 渲染 hex-highlight 且热区可点，点击触发 onHexClick', () => {
    const state = fixture();
    const target = Object.keys(state.map)[0] as HexKey;
    const other = Object.keys(state.map)[1] as HexKey;
    const clicks: HexKey[] = [];
    const { container } = render(
      <BoardSvg state={state} highlights={new Set([target])} onHexClick={(k) => clicks.push(k)} />,
    );
    const highlights = container.querySelectorAll('polygon.hex-highlight');
    expect(highlights).toHaveLength(1);
    const clickable = container.querySelectorAll('polygon.hex-hit.clickable');
    expect(clickable).toHaveLength(1);
    fireEvent.click(clickable[0]!);
    expect(clicks).toEqual([target]);
    // 未高亮的热区不触发回调
    const otherGroup = container.querySelector(`g.board-hex[data-hex="${other}"]`);
    const otherHit = otherGroup?.querySelector('polygon.hex-hit');
    expect(otherHit?.classList.contains('clickable')).toBe(false);
    fireEvent.click(otherHit!);
    expect(clicks).toEqual([target]);
  });

  it('hover hex 显示 tooltip（星球类型/扇区）', () => {
    const state = fixture();
    const [key, hex] = Object.entries(state.map).find(([, hx]) => hx.planet !== 'empty') as [HexKey, (typeof state.map)[HexKey]];
    const { container, getByTestId, queryByTestId } = render(<BoardSvg state={state} />);
    expect(queryByTestId('hex-tooltip')).toBeNull();
    const group = container.querySelector(`g.board-hex[data-hex="${key}"]`);
    fireEvent.mouseEnter(group!.querySelector('polygon.hex-hit')!, { clientX: 10, clientY: 10 });
    const tooltip = getByTestId('hex-tooltip');
    expect(tooltip).toHaveTextContent(key);
    expect(tooltip).toHaveTextContent(`扇区 ${hex.sector}`);
  });
});

describe('<BoardSvg> 建筑渲染', () => {
  it('放置起始矿后渲染 hex-building[data-building=mine][data-player]', () => {
    const game = newGame({
      playerCount: 4,
      seed: 42,
      factions: ['terrans', 'xenos', 'geodens', 'itars'],
      lostFleet: true,
    });
    // setup 第一格合法起始矿
    const actor = game.setupQueue[0]!;
    const mineHex = Object.entries(game.map).find(
      ([, hx]) => hx.planet === 'terra' && hx.building === undefined,
    )![0] as HexKey;
    const next = applyAction(game, { type: 'place-initial-mine', hex: mineHex });
    const { container } = render(<BoardSvg state={filterStateFor(next)} />);
    const buildings = container.querySelectorAll('g.hex-building');
    expect(buildings).toHaveLength(1);
    expect(buildings[0]!.getAttribute('data-building')).toBe('mine');
    expect(buildings[0]!.getAttribute('data-player')).toBe(String(actor));
    // 建筑渲染在所属 hex 组内
    const group = container.querySelector(`g.board-hex[data-hex="${mineHex}"]`);
    expect(group?.querySelector('g.hex-building')).not.toBeNull();
  });

  it('LF 地图飞船格渲染 hex-ship[data-ship] 徽标', () => {
    const state = fixture();
    const shipHexes = Object.values(state.map).filter((hx) => hx.ship !== undefined).length;
    const { container } = render(<BoardSvg state={state} />);
    const ships = container.querySelectorAll('g.hex-ship');
    expect(ships).toHaveLength(shipHexes);
    expect(ships.length).toBeGreaterThan(0);
    for (const el of ships) {
      expect(el.getAttribute('data-ship')).toBeTruthy();
      expect(el.querySelector('text.ship-badge')?.textContent).toMatch(/^[TRME]$/);
    }
  });
});

describe('<BoardSvg> 原版素材底图', () => {
  it('10 块标准扇区整版图 + 8 块深空三角板 + Interspace 单格图（4 人 LF）', () => {
    const state = fixture();
    const { container } = render(<BoardSvg state={state} />);
    const sectors = container.querySelectorAll('image.sector-img');
    expect(sectors).toHaveLength(10);
    // 每块图带 data-sector 且指向 /assets/sectors/
    for (const el of sectors) {
      expect(el.getAttribute('data-sector')).toBeTruthy();
      expect(el.getAttribute('href')).toMatch(/^\/assets\/sectors\//);
    }
    const deep = container.querySelectorAll('image.deep-space-img');
    expect(deep).toHaveLength(8);
    for (const el of deep) {
      expect(el.getAttribute('href')).toMatch(/^\/assets\/lf\/deep-space\/map_deep_1[1-8][ab]\.png$/);
    }
    const interspaceHexes = Object.values(state.map).filter((hx) => hx.sector === 'interspace').length;
    const interspace = container.querySelectorAll('image.interspace-img');
    expect(interspace).toHaveLength(interspaceHexes);
    expect(interspace.length).toBeGreaterThan(0);
  });

  it('扇区图 transform 含平移/旋转/缩放（与校准一致的几何）', () => {
    const state = fixture();
    const { container } = render(<BoardSvg state={state} />);
    const g = container.querySelector('image.sector-img')?.closest('g');
    expect(g?.getAttribute('transform')).toMatch(/^translate\(-?\d+(\.\d+)?,-?\d+(\.\d+)?\) rotate\(-?\d+\) scale\(/);
  });
});

describe('<BoardSvg> 整体旋转', () => {
  /** 当前 g.board-rotate 的旋转角（从 transform 解析）。 */
  const rotateDeg = (container: HTMLElement): number => {
    const t = container.querySelector('g.board-rotate')?.getAttribute('transform') ?? '';
    const m = /^rotate\((-?\d+(?:\.\d+)?) /.exec(t);
    return m === null ? NaN : Number(m[1]);
  };
  /** 与 BoardSvg 内部一致：全图 hex 中心 + 包围盒中心。 */
  const mapGeometry = (state: ReturnType<typeof fixture>) => {
    const points = (Object.keys(state.map) as HexKey[]).map((key) => {
      const { q, r } = parseHexKey(key);
      return hexToPixel(q, r);
    });
    const base = parseViewBox(boardViewBox(state.map));
    return { points, cx: base.x + base.w / 2, cy: base.y + base.h / 2, base };
  };

  it('默认取向 = 任意角度扫描的最优水平（bestHorizontalRotation），viewBox 为旋转外接矩形', () => {
    const state = fixture();
    const { container } = render(<BoardSvg state={state} />);
    const { points, cx, cy, base } = mapGeometry(state);
    const deg = bestHorizontalRotation(points, cx, cy);
    expect(rotateDeg(container)).toBeCloseTo(deg, 5);
    // 自适应 viewBox = 旋转后的外接矩形（宽 ≥ 高）
    const vb = parseViewBox(container.querySelector('svg.board-svg')?.getAttribute('viewBox') ?? '');
    const expectFit = rotatedViewBox(base, deg);
    expect(vb.w).toBeCloseTo(expectFit.w, 1);
    expect(vb.h).toBeCloseTo(expectFit.h, 1);
    expect(vb.w).toBeGreaterThanOrEqual(vb.h);
    // 热区在旋转组内（跟着转）
    expect(container.querySelector('g.board-rotate g.board-hex polygon.hex-hit')).not.toBeNull();
  });

  it('±15° 微调与 +60° 步进：显示为相对默认水平的偏移角，回到水平偏移归零', () => {
    const state = fixture();
    const { container, getByTestId, queryByTestId } = render(<BoardSvg state={state} />);
    const { points, cx, cy } = mapGeometry(state);
    const def = bestHorizontalRotation(points, cx, cy);
    expect(queryByTestId('board-rotate-reset')).toBeNull();
    // 默认水平显示 0.0°（而非绝对角）
    expect(getByTestId('board-rotate-deg')).toHaveTextContent('0.0°');
    expect(rotateDeg(container)).toBeCloseTo(def, 5);
    // +60° 步进：显示 60.0°，内部渲染角 = def + 60
    fireEvent.click(getByTestId('board-rotate-btn'));
    expect(getByTestId('board-rotate-deg')).toHaveTextContent('60.0°');
    expect(rotateDeg(container)).toBeCloseTo(def + 60, 5);
    // −15° 微调（净 +45°）
    fireEvent.click(getByTestId('board-rotate-fine-dec'));
    expect(getByTestId('board-rotate-deg')).toHaveTextContent('45.0°');
    expect(rotateDeg(container)).toBeCloseTo(def + 45, 5);
    // +15° 微调（净 +60°）
    fireEvent.click(getByTestId('board-rotate-fine-inc'));
    expect(getByTestId('board-rotate-deg')).toHaveTextContent('60.0°');
    expect(rotateDeg(container)).toBeCloseTo(def + 60, 5);
    // 回到水平 → 偏移归零，重置按钮消失
    fireEvent.click(getByTestId('board-rotate-reset'));
    expect(getByTestId('board-rotate-deg')).toHaveTextContent('0.0°');
    expect(rotateDeg(container)).toBeCloseTo(def, 5);
    expect(queryByTestId('board-rotate-reset')).toBeNull();
  });
});
