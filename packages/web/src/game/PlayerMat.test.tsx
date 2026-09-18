/**
 * PlayerMat（族板整图重构）渲染契约：
 * - 以 factions/hi/<族>.jpg 整图为背景（mat-board + mat-board-img）；
 * - 收入轨剩余建筑叠加数 = buildings supply（放走即从面板消失）；
 * - power 三区+gaia 区显示 token 点阵与计数（data-count）；
 * - taklons 脑石按所在区叠加；gaiaformer 可用数占槽；
 * - moweyds 也有高清图（wellplayed 渲染，2026-09 补），同走整图布局；
 * - 卫星/空间站 misc 行已删除（卫星数见终局计分区）；
 * - 联邦标记单行自适应（不 wrap，max-width = (100% − 间隙) ÷ 枚数）。
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { newGame } from '@gaia/engine';
import type { FactionId } from '@gaia/engine';
import { filterStateFor } from '@gaia/protocol';
import type { FilteredState } from '@gaia/protocol';
import { factionBoardImage } from '../assets';
import { PlayerMat, TechBoosterStrip } from './PlayerMat';

function fixture(factions: FactionId[], lostFleet = false): FilteredState {
  return filterStateFor(
    newGame({ playerCount: factions.length, seed: 42, factions, lostFleet }),
  );
}

describe('<PlayerMat> 族板整图渲染契约', () => {
  it('以族板整图为背景（hi 路径）', () => {
    const state = fixture(['terrans', 'xenos']);
    const { getByTestId } = render(<PlayerMat state={state} playerIdx={0} />);
    const board = getByTestId('mat-board-0');
    const img = board.querySelector<HTMLImageElement>('img.mat-board-img');
    expect(img?.src).toContain(factionBoardImage('terrans'));
    expect(img?.src).toContain('/assets/factions/hi/Terrans.jpg');
  });

  it('收入轨剩余建筑叠加数 = supply（随放走减少）', () => {
    const state = fixture(['terrans', 'xenos']);
    const p = state.players[0]!;
    const { container, unmount } = render(<PlayerMat state={state} playerIdx={0} />);
    expect(container.querySelectorAll('.mat-bld[data-b="mine"]')).toHaveLength(p.buildings.mine);
    expect(container.querySelectorAll('.mat-bld[data-b="ts"]')).toHaveLength(4);
    expect(container.querySelectorAll('.mat-bld[data-b="lab"]')).toHaveLength(3);
    expect(container.querySelectorAll('.mat-bld[data-b="pi"]')).toHaveLength(1);
    expect(container.querySelectorAll('.mat-bld[data-b="ac1"]')).toHaveLength(1);
    expect(container.querySelectorAll('.mat-bld[data-b="ac2"]')).toHaveLength(1);
    unmount();

    p.buildings.mine = 3;
    p.buildings.pi = 0; // PI 已放上地图
    const { container: c2 } = render(<PlayerMat state={state} playerIdx={0} />);
    expect(c2.querySelectorAll('.mat-bld[data-b="mine"]')).toHaveLength(3);
    expect(c2.querySelectorAll('.mat-bld[data-b="pi"]')).toHaveLength(0);
  });

  it('power 三区+gaia 区显示点阵与计数', () => {
    const state = fixture(['terrans', 'xenos']);
    const p = state.players[0]!;
    expect(p.power.bowl1).toBe(4);
    expect(p.power.bowl2).toBe(4);
    const { getByTestId } = render(<PlayerMat state={state} playerIdx={0} />);
    for (const bowl of ['bowl1', 'bowl2', 'bowl3', 'gaia'] as const) {
      const cluster = getByTestId(`mat-power-${bowl}-0`);
      expect(cluster.getAttribute('data-count')).toBe(String(p.power[bowl]));
      expect(cluster.querySelectorAll('.mat-power-dot')).toHaveLength(p.power[bowl]);
      expect(cluster.querySelector('.mat-power-count')?.textContent).toBe(String(p.power[bowl]));
    }
  });

  it('taklons 脑石按所在区叠加', () => {
    const state = fixture(['taklons', 'xenos']);
    expect(state.players[0]!.power.brainstone).toBe('bowl1');
    const { getByTestId } = render(<PlayerMat state={state} playerIdx={0} />);
    const stone = getByTestId('mat-brainstone-0');
    expect(stone).toBeInTheDocument();
    // 脑石在 bowl1 的 cluster 内
    expect(getByTestId('mat-power-bowl1-0').contains(stone)).toBe(true);
  });

  it('gaiaformer 可用数占槽', () => {
    const state = fixture(['terrans', 'xenos']);
    state.players[0]!.gaiaformers = { total: 2, available: 2, lost: 0, inGaia: 0 };
    const { getAllByTestId, unmount } = render(<PlayerMat state={state} playerIdx={0} />);
    expect(getAllByTestId('mat-gf-0')).toHaveLength(2);
    unmount();
    state.players[0]!.gaiaformers.available = 1;
    const { getAllByTestId: g2 } = render(<PlayerMat state={state} playerIdx={0} />);
    expect(g2('mat-gf-0')).toHaveLength(1);
  });

  it('moweyds 也走整图布局（wellplayed 渲染）', () => {
    const state = fixture(['moweyds', 'terrans'], true);
    const { getByTestId } = render(<PlayerMat state={state} playerIdx={0} />);
    const board = getByTestId('mat-board-0');
    const img = board.querySelector<HTMLImageElement>('img.mat-board-img');
    expect(img?.src).toContain('/assets/factions/hi/moweyds_board_wellplayed.jpg');
  });

  it('bescods 学院叠加在左、PI 在右（override 生效）', () => {
    const state = fixture(['bescods', 'terrans']);
    const { container } = render(<PlayerMat state={state} playerIdx={0} />);
    const pi = container.querySelector<HTMLElement>('.mat-bld[data-b="pi"]');
    const ac1 = container.querySelector<HTMLElement>('.mat-bld[data-b="ac1"]');
    expect(pi).not.toBeNull();
    expect(ac1).not.toBeNull();
    const xOf = (el: HTMLElement) => parseFloat(el.style.left);
    expect(xOf(ac1!)).toBeLessThan(xOf(pi!));
  });

  it('建筑棋子按 BUILDING_SPRITE 裁剪透明边距（PI 不裁）', () => {
    const state = fixture(['terrans', 'xenos']);
    const { container } = render(<PlayerMat state={state} playerIdx={0} />);
    const mine = container.querySelector<HTMLElement>('.mat-bld[data-b="mine"]');
    expect(mine?.style.clipPath).toContain('inset(');
    const pi = container.querySelector<HTMLElement>('.mat-bld[data-b="pi"]');
    expect(pi?.style.clipPath ?? '').toBe('');
  });

  it('拖拽源：传入 onBuildingDragStart 时棋子可拖（pointerdown 回调 + draggable 类）', () => {
    const state = fixture(['terrans', 'xenos']);
    const starts: string[] = [];
    const { container } = render(
      <PlayerMat
        state={state}
        playerIdx={0}
        onBuildingDragStart={(b, e) => {
          e.preventDefault();
          starts.push(b);
        }}
      />,
    );
    const mine = container.querySelector<HTMLElement>('.mat-bld[data-b="mine"]');
    expect(mine?.className).toContain('draggable');
    expect(mine?.draggable).toBe(false); // 禁原生 img 拖拽（走 pointer 事件）
    fireEvent.pointerDown(mine!);
    expect(starts).toEqual(['mine']);

    // 未传 handler：无 draggable 类、无回调
    const { container: c2 } = render(<PlayerMat state={state} playerIdx={0} />);
    const m2 = c2.querySelector<HTMLElement>('.mat-bld[data-b="mine"]');
    expect(m2?.className).not.toContain('draggable');
  });

  it('详情弹窗（detailed）：渲染探索板 + TechBoosterStrip（科技/高级/联邦/推进）', () => {
    const state = fixture(['terrans', 'xenos'], true);
    const p = state.players[0]!;
    p.techTiles = ['tech2', 'tech5'];
    p.advTechTiles = [{ id: 'advtech3', covers: 'tech5' }];
    p.booster = 'booster4';
    const { getByTestId, unmount } = render(<PlayerMat state={state} playerIdx={0} detailed />);
    // 探索板（LF）
    expect(getByTestId('exploration-board-0')).toBeInTheDocument();
    // TechBoosterStrip：未被覆盖的标准板直出；被覆盖的 tech5 置灰垫高级板下；推进片实图
    const strip = getByTestId('tech-booster-strip-0');
    expect(strip.querySelector('img[src*="TECtyp"]')).not.toBeNull();
    const stack = strip.querySelector('.tech-stack');
    expect(stack?.querySelector('img.covered')?.getAttribute('src')).toContain('TECore');
    expect(stack?.querySelector('img.adv-top')?.getAttribute('src')).toContain('ADVqic');
    expect(stack?.getAttribute('title')).toContain('覆盖');
    expect(strip.querySelector('img.booster')?.getAttribute('src')).toContain('BOOter');
    unmount();

    // 空：TechBoosterStrip 不渲染（探索板仍在）
    p.techTiles = [];
    p.advTechTiles = [];
    p.booster = null;
    const { queryByTestId, getByTestId: g2 } = render(<PlayerMat state={state} playerIdx={0} detailed />);
    expect(queryByTestId('tech-booster-strip-0')).toBeNull();
    expect(g2('exploration-board-0')).toBeInTheDocument();
  });

  it('非详情模式不渲染探索板详区横条', () => {
    const state = fixture(['terrans', 'xenos']);
    state.players[0]!.booster = 'booster1';
    const { queryByTestId } = render(<PlayerMat state={state} playerIdx={0} />);
    expect(queryByTestId('tech-booster-strip-0')).toBeNull();
  });

  it('卫星/空间站 misc 行已删除（无 mat-misc、无"卫×"占位）', () => {
    const state = fixture(['terrans', 'xenos']);
    state.players[0]!.satellites = 3;
    state.players[0]!.spaceStations = 1;
    const { container } = render(<PlayerMat state={state} playerIdx={0} />);
    expect(container.querySelector('.mat-misc')).toBeNull();
    expect(container.textContent).not.toContain('卫×');
  });

  it('联邦片与科技片按获得顺序混排在 TechBoosterStrip（翻灰面保留样式）', () => {
    const state = fixture(['terrans', 'xenos']);
    state.players[0]!.federationTokens = [
      { id: 'fed1', flipped: false },
      { id: 'fed2', flipped: false },
      { id: 'fed3', flipped: true },
    ];
    state.players[0]!.acquisitions = [
      { kind: 'tech', id: 'tech1' },
      { kind: 'fed', id: 'fed1' },
      { kind: 'adv', id: 'advtech4' },
      { kind: 'fed', id: 'fed2' },
      { kind: 'fed', id: 'fed3' },
    ];
    state.players[0]!.techTiles = ['tech1'];
    state.players[0]!.advTechTiles = [{ id: 'advtech4', covers: 'tech1' }];
    const { container, getByTestId } = render(<TechBoosterStrip state={state} playerIdx={0} />);
    const strip = getByTestId('tech-booster-strip-0');
    const feds = strip.querySelectorAll<HTMLImageElement>('img.tile-img.fed');
    expect(feds).toHaveLength(3);
    // 混排顺序 = acquisitions 顺序：tech1 → fed1 → advtech4 → fed2 → fed3
    const kinds = Array.from(strip.querySelector('.strip-tech')!.children).map(
      (el) => el.getAttribute('data-testid') ?? el.className,
    );
    expect(kinds[0]).toContain('tile-img');
    expect(strip.querySelectorAll('img[data-testid^="strip-fed-0-"]')).toHaveLength(3);
    // 翻转标记保留灰面样式
    expect(container.querySelector('.tile-img.fed.flipped')).not.toBeNull();
  });
});
