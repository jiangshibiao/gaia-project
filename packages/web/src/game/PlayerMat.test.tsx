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
import { PlayerMat } from './PlayerMat';

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

  it('详情弹窗（detailed）：科技板块与推进片两区；被覆盖标准板置灰垫高级板下；空显示"无"', () => {
    const state = fixture(['terrans', 'xenos']);
    const p = state.players[0]!;
    p.techTiles = ['tech2', 'tech5'];
    p.advTechTiles = [{ id: 'advtech3', covers: 'tech5' }];
    p.booster = 'booster4';
    const { getByTestId, unmount } = render(<PlayerMat state={state} playerIdx={0} detailed />);
    const tech = getByTestId('detail-tech-0');
    // 未被覆盖的标准板直出；被覆盖的 tech5 在 tech-stack 内置灰（covered），高级板叠上（adv-top）
    expect(tech.querySelector('img[src*="TECtyp"]')).not.toBeNull();
    const stack = tech.querySelector('.tech-stack');
    expect(stack?.querySelector('img.covered')?.getAttribute('src')).toContain('TECore');
    expect(stack?.querySelector('img.adv-top')?.getAttribute('src')).toContain('ADVqic');
    expect(stack?.getAttribute('title')).toContain('覆盖');
    // 推进片实图
    const booster = getByTestId('detail-booster-0');
    expect(booster.querySelector('img')?.getAttribute('src')).toContain('BOOter');
    unmount();

    // 空：两区都显示"无"
    p.techTiles = [];
    p.advTechTiles = [];
    p.booster = null;
    const { getByTestId: g2 } = render(<PlayerMat state={state} playerIdx={0} detailed />);
    expect(g2('detail-tech-0').textContent).toContain('无');
    expect(g2('detail-tech-0').querySelectorAll('img')).toHaveLength(0);
    expect(g2('detail-booster-0').textContent).toContain('无');
    expect(g2('detail-booster-0').querySelectorAll('img')).toHaveLength(0);
  });

  it('非详情模式不渲染科技板/推进片详区', () => {
    const state = fixture(['terrans', 'xenos']);
    state.players[0]!.booster = 'booster1';
    const { queryByTestId } = render(<PlayerMat state={state} playerIdx={0} />);
    expect(queryByTestId('detail-tech-0')).toBeNull();
    expect(queryByTestId('detail-booster-0')).toBeNull();
  });

  it('卫星/空间站 misc 行已删除（无 mat-misc、无"卫×"占位）', () => {
    const state = fixture(['terrans', 'xenos']);
    state.players[0]!.satellites = 3;
    state.players[0]!.spaceStations = 1;
    const { container } = render(<PlayerMat state={state} playerIdx={0} />);
    expect(container.querySelector('.mat-misc')).toBeNull();
    expect(container.textContent).not.toContain('卫×');
  });

  it('联邦标记单行放下：不 wrap，标记宽 = (可用宽 − 固定间隙) ÷ 标记数', () => {
    const state = fixture(['terrans', 'xenos']);
    state.players[0]!.federationTokens = [
      { id: 'fed1', flipped: false },
      { id: 'fed2', flipped: false },
      { id: 'fed3', flipped: true },
    ];
    const { container, getByTestId, unmount } = render(<PlayerMat state={state} playerIdx={0} />);
    const row = getByTestId('mat-feds-0');
    const imgs = row.querySelectorAll<HTMLImageElement>('img.tile-img.fed');
    expect(imgs).toHaveLength(3);
    for (const img of imgs) {
      expect(img.style.maxWidth).toBe('calc((100% - 10px) / 3)');
    }
    // 翻转标记保留灰面样式
    expect(container.querySelector('.tile-img.fed.flipped')).not.toBeNull();
    unmount();

    // 5 枚时间隙/份数随数量变化（自适应缩小）
    state.players[0]!.federationTokens = [
      { id: 'fed1', flipped: false },
      { id: 'fed2', flipped: false },
      { id: 'fed3', flipped: false },
      { id: 'fed4', flipped: false },
      { id: 'fed5', flipped: false },
    ];
    const { getByTestId: g2 } = render(<PlayerMat state={state} playerIdx={0} />);
    const img5 = g2('mat-feds-0').querySelector<HTMLImageElement>('img.tile-img.fed');
    expect(img5?.style.maxWidth).toBe('calc((100% - 20px) / 5)');
  });
});
