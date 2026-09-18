/**
 * Lobby「导入复盘」面板契约：
 * - 粘贴 JSON → 提交发 import_game（服务器重放校验）；
 * - 非法 JSON / 形状不符 → 本地错误提示，不发消息；
 * - 服务器校验失败（import-invalid 等）→ 大厅 error-banner 展示。
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@gaia/protocol';
import type { GameRecord } from '@gaia/protocol';
import { App } from '../App';
import type { GameStore } from '../game/store';
import { lastWs, setupStore } from '../test/fakes';
import type { FakeWebSocket } from '../test/fakes';

/** 渲染大厅并连上服务器（无房间 → Lobby 路由）。 */
function renderLobby(store: GameStore): FakeWebSocket {
  render(<App store={store} />);
  const ws = lastWs();
  act(() => {
    ws.open();
  });
  return ws;
}

function recordFixture(): GameRecord {
  return {
    version: 1,
    config: { playerCount: 2, seed: 7, factions: ['terrans', 'xenos'], lostFleet: true },
    actions: [],
  };
}

describe('<Lobby> 导入复盘面板', () => {
  it('粘贴合法记录 JSON → 提交发 import_game', () => {
    const { store } = setupStore();
    const ws = renderLobby(store);
    const record = recordFixture();
    fireEvent.change(screen.getByTestId('import-text'), { target: { value: JSON.stringify(record) } });
    fireEvent.click(screen.getByTestId('import-submit'));
    expect(ws.lastSent()).toEqual({ type: 'import_game', protocolVersion: PROTOCOL_VERSION, record });
  });

  it('非法 JSON → 本地错误提示，不发消息', () => {
    const { store } = setupStore();
    const ws = renderLobby(store);
    fireEvent.change(screen.getByTestId('import-text'), { target: { value: '{not json' } });
    fireEvent.click(screen.getByTestId('import-submit'));
    expect(screen.getByTestId('import-error').textContent).toContain('JSON 解析失败');
    expect(ws.sent).toHaveLength(0);
  });

  it('形状不符（缺 config/actions）→ 本地错误提示，不发消息', () => {
    const { store } = setupStore();
    const ws = renderLobby(store);
    fireEvent.change(screen.getByTestId('import-text'), { target: { value: '{"version":1}' } });
    fireEvent.click(screen.getByTestId('import-submit'));
    expect(screen.getByTestId('import-error').textContent).toContain('记录格式非法');
    expect(ws.sent).toHaveLength(0);
  });

  it('服务器校验失败 → 大厅 error-banner 展示，停留大厅', () => {
    const { store } = setupStore();
    const ws = renderLobby(store);
    fireEvent.change(screen.getByTestId('import-text'), { target: { value: JSON.stringify(recordFixture()) } });
    fireEvent.click(screen.getByTestId('import-submit'));
    act(() => {
      ws.emit({ type: 'error', protocolVersion: PROTOCOL_VERSION, code: 'import-invalid', message: '行动日志无法重放: boom' });
    });
    expect(screen.getByTestId('last-error').textContent).toContain('import-invalid');
    expect(store.getState().review).toBeNull();
    expect(screen.getByTestId('import-form')).toBeInTheDocument();
  });
});
