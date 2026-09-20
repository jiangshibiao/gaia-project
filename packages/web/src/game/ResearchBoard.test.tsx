/**
 * ResearchBoard（整图 + 叠加）渲染契约：
 * - 以 ResearchBoard.jpg 整图为背景（rb-board-img）；
 * - 玩家爬轨 token 放在对应等级格（track-<t>-level-<lv> 内 player-dot[data-player]，
 *   多人同格错开）；L5 已被占的轨显示 l5-ring；
 * - 9 个标准科技板位 + 图上 6 高级板槽（LF 第 7 槽在计分区 AdvExtension）；
 * - power/qic 行动格本轮已用的置灰 + action token；
 * - LF economy 覆盖板（pw/vp 面）按 board.economyOverlay 显示。
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newGame } from '@gaia/engine';
import { filterStateFor } from '@gaia/protocol';
import { RESEARCH_BOARD_BG } from '../assets';
import { ResearchBoard } from './ResearchBoard';
import { RB_NATURAL_HEIGHT, RB_NATURAL_WIDTH, researchBoardScale } from './research-calibration';

function fixture(lostFleet: boolean) {
  const game = newGame({
    playerCount: 4,
    seed: 42,
    factions: ['terrans', 'xenos', 'geodens', 'itars'],
    lostFleet,
  });
  return filterStateFor(game);
}

describe('<ResearchBoard> 整图渲染契约', () => {
  it('以 ResearchBoard.jpg 整图为背景', () => {
    const state = fixture(true);
    const { container } = render(<ResearchBoard state={state} />);
    const img = container.querySelector<HTMLImageElement>('img.rb-board-img');
    expect(img?.src).toContain(RESEARCH_BOARD_BG);
  });

  it('玩家等级 token 放到对应等级格（同格多人错开）', () => {
    const state = fixture(false);
    state.players[0]!.research.terra = 3;
    state.players[1]!.research.terra = 3;
    state.players[2]!.research.nav = 5;
    const { getByTestId } = render(<ResearchBoard state={state} />);
    const terraL3 = getByTestId('track-terra-level-3');
    const dots = terraL3.querySelectorAll('.player-dot');
    expect(dots).toHaveLength(2);
    expect(dots[0]?.getAttribute('data-player')).toBe('0');
    expect(dots[1]?.getAttribute('data-player')).toBe('1');
    // 同格错开：两个 dot 的 left 不同
    expect((dots[0] as HTMLElement).style.left).not.toBe((dots[1] as HTMLElement).style.left);
    expect(getByTestId('track-nav-level-5').querySelectorAll('.player-dot')).toHaveLength(1);
    // 未到的格无 token
    expect(getByTestId('track-terra-level-4').querySelectorAll('.player-dot')).toHaveLength(0);
  });

  it('L5 已被占的轨显示占用标记', () => {
    const state = fixture(false);
    state.players[2]!.research.nav = 5;
    state.board.researchLevel5.nav = 2;
    const { getByTestId } = render(<ResearchBoard state={state} />);
    expect(getByTestId('track-nav-level-5').className).toContain('occupied');
    expect(getByTestId('track-nav-level-5').querySelector('.l5-ring')).not.toBeNull();
    expect(getByTestId('track-terra-level-5').querySelector('.l5-ring')).toBeNull();
  });

  it('9 个标准科技板位 + 图上 6 高级板槽（LF 第 7 槽不在研究板，见 AdvExtension）', () => {
    const state = fixture(true);
    expect(state.board.advTechTiles).toHaveLength(7);
    const { getByTestId, queryByTestId, unmount } = render(<ResearchBoard state={state} />);
    for (const pos of ['terra', 'nav', 'int', 'gaia', 'eco', 'sci', 'free1', 'free2', 'free3']) {
      getByTestId(`tech-tile-pos-${pos}`);
    }
    // 基础研究板仅图上 6 槽；第 7 槽已迁到计分区扩展条
    for (let i = 0; i < 6; i++) getByTestId(`adv-slot-${i}`);
    expect(queryByTestId('adv-slot-6')).toBeNull();
    expect(queryByTestId('adv-extension')).toBeNull();
    unmount();

    const base = fixture(false);
    const { queryByTestId: q2 } = render(<ResearchBoard state={base} />);
    expect(base.board.advTechTiles).toHaveLength(6);
    expect(q2('adv-extension')).toBeNull();
    expect(q2('adv-slot-6')).toBeNull();
  });

  it('标准科技板按剩余张数错落堆叠：层数=余量，向右上偏移，拿完露空槽', () => {
    const state = fixture(false);
    const tile = state.board.techTilePositions.terra;
    const full = state.board.techTiles[tile]!;
    expect(full).toBeGreaterThan(1);
    const { getByTestId, unmount } = render(<ResearchBoard state={state} />);
    const btn = getByTestId('tech-tile-pos-terra');
    const imgs = btn.querySelectorAll<HTMLImageElement>('img.stack-tile');
    expect(imgs).toHaveLength(full);
    // 向右上偏移：left 递增、top 递减（整叠居中）
    const lefts = [...imgs].map((im) => parseFloat(im.style.left));
    const tops = [...imgs].map((im) => parseFloat(im.style.top));
    for (let i = 1; i < full; i++) {
      expect(lefts[i]!).toBeGreaterThan(lefts[i - 1]!);
      expect(tops[i]!).toBeLessThan(tops[i - 1]!);
    }
    unmount();

    // 拿走几张 → 层数随余量减少；拿完 → 无图 + empty 类（露出印刷空槽）
    state.board.techTiles[tile] = 2;
    const { getByTestId: g2, unmount: u2 } = render(<ResearchBoard state={state} />);
    expect(g2('tech-tile-pos-terra').querySelectorAll('img.stack-tile')).toHaveLength(2);
    u2();
    state.board.techTiles[tile] = 0;
    const { getByTestId: g3 } = render(<ResearchBoard state={state} />);
    const empty = g3('tech-tile-pos-terra');
    expect(empty.querySelectorAll('img.stack-tile')).toHaveLength(0);
    expect(empty.className).toContain('empty');
  });

  it('已用 power 行动格置灰 + action token', () => {
    const state = fixture(false);
    state.board.boardActionsUsed.push('power1');
    const { getByTestId } = render(<ResearchBoard state={state} />);
    const cell = getByTestId('board-action-power1');
    expect(cell.className).toContain('used');
    expect(cell.querySelector('img.action-token')).not.toBeNull();
    expect(getByTestId('board-action-power2').querySelector('img.action-token')).toBeNull();
  });

  it('LF 显示 economy 覆盖板；非 LF 不显示', () => {
    const lf = fixture(true);
    const { container } = render(<ResearchBoard state={lf} />);
    const overlay = container.querySelector<HTMLImageElement>('img.rb-econ-overlay');
    expect(overlay?.src).toContain(`econ_${lf.board.economyOverlay}.png`);

    const base = fixture(false);
    const { container: c2 } = render(<ResearchBoard state={base} />);
    expect(c2.querySelector('img.rb-econ-overlay')).toBeNull();
  });

  it('Terraforming L5 预设联邦标记显示在 terra 轨 L5 附近', () => {
    const state = fixture(false);
    expect(state.board.terraformingL5Token).not.toBeNull();
    const { container } = render(<ResearchBoard state={state} />);
    const imgs = [...container.querySelectorAll<HTMLImageElement>('img.tile-img.fed.overlay')];
    expect(imgs.length).toBeGreaterThan(0);
  });

  it('联邦标记供应单行放下（格伦专属片除外）：fed-item maxWidth = (可用宽 − 固定间隙) ÷ 种数', () => {
    const state = fixture(true);
    // 格伦星人专属联邦片不在公共供应展示（叠放在格伦星人族板 PI 上）
    const supplied = (Object.entries(state.board.federationTokens) as [string, number][]).filter(
      ([id, n]) => n > 0 && id !== 'gleens',
    );
    expect(supplied.length).toBeGreaterThan(0);
    const { getByTestId } = render(<ResearchBoard state={state} />);
    const items = getByTestId('fed-supply').querySelectorAll<HTMLElement>('.fed-item');
    expect(items).toHaveLength(supplied.length);
    const expected = `calc((100% - ${(supplied.length - 1) * 6}px) / ${supplied.length})`;
    for (const item of items) {
      expect(item.style.maxWidth).toBe(expected);
    }
  });

  it('pickable 的 track/科技板/行动格可点击回调', () => {
    const state = fixture(false);
    const picks: [string, string][] = [];
    const { getByTestId } = render(
      <ResearchBoard
        state={state}
        activeField="track"
        activeCategory={null}
        activeOptions={new Set(['terra'])}
        onPick={(f, v) => picks.push([f, v])}
      />,
    );
    const zone = getByTestId('track-terra');
    expect(zone).toBeEnabled();
    zone.click();
    expect(picks).toEqual([['track', 'terra']]);
    expect(getByTestId('track-nav')).toBeDisabled();
  });

  it('整板缩放（.rb-scale 外壳 transform）下 pick 交互不受影响', () => {
    const state = fixture(false);
    const picks: [string, string][] = [];
    const { container, getByTestId } = render(
      <ResearchBoard
        state={state}
        activeField="action"
        activeCategory="power"
        activeOptions={new Set(['power1'])}
        onPick={(f, v) => picks.push([f, v])}
      />,
    );
    // 缩放外壳包裹整板（CSS transform scale，坐标系不变）
    const scale = getByTestId('rb-scale');
    expect(scale.querySelector(':scope > .rb-board')).not.toBeNull();
    expect(container.querySelector('.rb-board-img')).not.toBeNull();
    // 热区仍可点：命中可选行动格触发 onPick
    const cell = getByTestId('board-action-power1');
    expect(cell).toBeEnabled();
    cell.click();
    expect(picks).toEqual([['action', 'power1']]);
    expect(getByTestId('board-action-power2')).toBeDisabled();
  });

  it('未在选择态：合法 power/qic 行动格可直接点击发起（onBoardAction）', () => {
    const state = fixture(false);
    const fired: string[] = [];
    const { getByTestId } = render(
      <ResearchBoard
        state={state}
        availableActions={new Set(['power3', 'qic1'])}
        onBoardAction={(id) => fired.push(id)}
      />,
    );
    const cell = getByTestId('board-action-power3');
    expect(cell.className).toContain('direct');
    expect(cell).toBeEnabled();
    cell.click();
    expect(fired).toEqual(['power3']);
    // 不在 availableActions 的格保持禁用
    expect(getByTestId('board-action-power2')).toBeDisabled();
  });

  it('直点与选择态互斥：已用行动格不可直点；选择态内命中走 onPick', () => {
    const state = fixture(false);
    state.board.boardActionsUsed.push('power3');
    const fired: string[] = [];
    const picks: [string, string][] = [];
    const { getByTestId } = render(
      <ResearchBoard
        state={state}
        activeField="action"
        activeCategory="power"
        activeOptions={new Set(['power1'])}
        onPick={(f, v) => picks.push([f, v])}
        availableActions={new Set(['power3'])}
        onBoardAction={(id) => fired.push(id)}
      />,
    );
    // 已用格不可直点
    expect(getByTestId('board-action-power3')).toBeDisabled();
    expect(getByTestId('board-action-power3').className).not.toContain('direct');
    // 选择态命中走 onPick（优先于 onBoardAction）
    const cell = getByTestId('board-action-power1');
    expect(cell.className).toContain('pickable');
    cell.click();
    expect(picks).toEqual([['action', 'power1']]);
    expect(fired).toEqual([]);
  });
});

describe('researchBoardScale 动态缩放计算', () => {
  it('按外壳实际渲染宽度相对自然宽（1838px）计算 scale，不写死', () => {
    expect(RB_NATURAL_WIDTH).toBe(1838);
    expect(RB_NATURAL_HEIGHT).toBe(1972);
    expect(researchBoardScale(1838)).toBe(1);
    expect(researchBoardScale(919)).toBe(0.5);
    // 合并面板左列典型宽度（33vw @ 1600px 屏 ≈ 528px）
    expect(researchBoardScale(528)).toBeCloseTo(528 / 1838, 5);
  });
});
