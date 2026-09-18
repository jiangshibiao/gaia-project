/**
 * TopActionBar（顶栏）契约：
 * - 左：仅标识 + 轮次（第 x/6 轮）；
 * - 右：进度信息（本轮计分/先手/当前行动者/连接态）+ 主九个行动按钮常驻
 *   （可用高亮可点、不可用置灰禁用），情境类别仅可用时出现；
 *   免费兑换/烧脑收进「兑换」下拉；离开房间按钮居最右；
 * - 非自己回合：全部禁用。
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Action } from '@gaia/engine';
import { filterStateFor } from '@gaia/protocol';
import { TopActionBar } from './TopActionBar';
import { gameFixture } from '../test/fakes';

const MAIN_IDS = ['mine', 'gaia-project', 'upgrade', 'research', 'federation', 'explore', 'power', 'special', 'pass'];

function renderBar(legalActions: Action[], connection = 'connected', withExport = true) {
  const state = filterStateFor(gameFixture());
  const calls: string[] = [];
  const submitted: Action[] = [];
  const utils = render(
    <TopActionBar
      state={state}
      legalActions={legalActions}
      seat={0}
      nicknames={['甲', '乙', '丙', '丁']}
      connection={connection}
      onStartSelection={(c) => calls.push(c)}
      onSubmit={(a) => submitted.push(a)}
      onLeave={() => calls.push('leave')}
      {...(withExport ? { onExport: () => calls.push('export') } : {})}
    />,
  );
  return { ...utils, state, calls, submitted };
}

describe('<TopActionBar> 顶栏', () => {
  it('布局：左区（与左栏同宽）= 标识+轮次+导出；中区（与星图对齐）= 本轮+行动组；右区 = 先手/轮到/连接+离开房间', () => {
    const { getByTestId, queryByTestId } = renderBar([]);
    const bar = getByTestId('top-action-bar');
    const left = bar.querySelector('.topbar-left');
    const center = bar.querySelector('.topbar-center');
    const leave = bar.querySelector('.topbar-leave');
    expect(left).not.toBeNull();
    expect(center).not.toBeNull();
    expect(leave).not.toBeNull();
    // 左区：标识、轮次、导出对局
    expect(left!.textContent).toContain('盖亚计划');
    expect(left!.textContent).toContain('设置阶段');
    expect(left!.textContent).toContain('导出对局');
    // 中区：本轮 + 行动组
    expect(getByTestId('topbar-actions').parentElement).toBe(center);
    // 右区：先手/轮到/连接 + 离开房间
    expect(leave!.textContent).toContain('先手：');
    expect(leave!.contains(getByTestId('conn-status'))).toBe(true);
    expect(leave!.contains(getByTestId('actor-info'))).toBe(true);
    expect(getByTestId('leave-game').parentElement).toBe(leave);
    expect(queryByTestId('rail-r-status')).toBeNull();
  });

  it('进度信息：轮次（终局板在右栏计分区展示，顶栏不列）', () => {
    const { getByTestId } = renderBar([]);
    expect(getByTestId('round-info')).toHaveTextContent('设置阶段');
    expect(getByTestId('top-action-bar').textContent).not.toContain('终局：');
  });

  it('主九个按钮常驻：可用高亮可点，其余禁用；点击走 onStartSelection', () => {
    const legal: Action[] = [
      { type: 'build-mine', hex: '0,0' },
      { type: 'pass', booster: null },
    ];
    const { getByTestId, calls } = renderBar(legal);
    for (const id of MAIN_IDS) {
      const btn = getByTestId(`action-${id}`);
      if (id === 'mine' || id === 'pass') {
        expect(btn).toBeEnabled();
        expect(btn.className).toContain('primary');
      } else {
        expect(btn).toBeDisabled();
      }
    }
    fireEvent.click(getByTestId('action-mine'));
    expect(calls).toEqual(['mine']);
  });

  it('情境类别仅可用时出现（ship-action / qic / artifact）', () => {
    const { queryByTestId, getByTestId } = renderBar([{ type: 'qic-action', action: 'qic1' }]);
    expect(getByTestId('action-qic')).toBeEnabled();
    expect(queryByTestId('action-ship-action')).toBeNull();
    expect(queryByTestId('action-artifact')).toBeNull();
  });

  it('免费兑换/烧脑收进「兑换」下拉：逐条直发', () => {
    const legal: Action[] = [
      { type: 'free-conversion', conversion: 'o-c' },
      { type: 'burn' },
    ];
    const { getByTestId, queryByTestId, submitted } = renderBar(legal);
    expect(queryByTestId('convert-menu')).toBeNull();
    fireEvent.click(getByTestId('convert-toggle'));
    expect(getByTestId('convert-menu')).toBeInTheDocument();
    fireEvent.click(getByTestId('convert-o-c'));
    expect(submitted).toEqual([{ type: 'free-conversion', conversion: 'o-c' }]);
    fireEvent.click(getByTestId('convert-toggle'));
    fireEvent.click(getByTestId('action-burn'));
    expect(submitted[1]).toEqual({ type: 'burn' });
  });

  it('无可兑换项时下拉按钮禁用', () => {
    const { getByTestId } = renderBar([]);
    expect(getByTestId('convert-toggle')).toBeDisabled();
  });

  it('导出对局：提供 onExport 时渲染入口并回调；未提供不渲染', () => {
    const state = filterStateFor(gameFixture());
    const exported: string[] = [];
    const { getByTestId, unmount } = render(
      <TopActionBar
        state={state}
        legalActions={[]}
        seat={0}
        nicknames={[]}
        connection="connected"
        onStartSelection={() => undefined}
        onSubmit={() => undefined}
        onLeave={() => undefined}
        onExport={() => exported.push('export')}
      />,
    );
    fireEvent.click(getByTestId('export-game'));
    expect(exported).toEqual(['export']);
    unmount();
    const { queryByTestId } = renderBar([], 'connected', false);
    expect(queryByTestId('export-game')).toBeNull();
  });
});
