/**
 * 入口与路由（M2c）：条件渲染，不引路由库。
 * - takenOver → "连接被另一标签页接管"画面（重新接管 / 返回大厅）
 * - review → ReviewScreen 复盘回放（导入记录校验通过后进入，代替对局画面）
 * - snapshot → GameScreen 对局画面（终局后保留——结算横幅叠加，可自由查看版图）
 * - room → RoomView 房间等待视图
 * - 否则 → Lobby 大厅（创建/加入/导入复盘）
 *
 * 启动时 restoreSession() 读 localStorage 里的 token（`gaia:token:<code>`），
 * connect 后由 store 自动 resume 抢回座位（刷新恢复）。
 */
import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { GameScreen } from './game/GameScreen';
import { ReviewScreen } from './game/ReviewScreen';
import { GameClient, GameStore, useGameStore } from './game/store';
import { Lobby, RoomView } from './lobby/Lobby';

/** 同源 ws 端点（vite dev 代理 /ws → 8430；server 生产静态托管同路径）。 */
function wsUrl(): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/ws`;
}

function TakenOverScreen({ store }: { store: GameStore }): ReactElement {
  return (
    <main className="app taken-over-screen">
      <h1>盖亚计划</h1>
      <p className="error" data-testid="taken-over">
        连接被另一标签页接管
      </p>
      <p className="status">该座位已在其他标签页中恢复。可重新接管（对方将被断开），或返回大厅。</p>
      <button data-testid="reclaim" onClick={() => store.reclaim()}>
        重新接管
      </button>
      <button data-testid="back-lobby" onClick={() => store.leaveRoom()}>
        返回大厅
      </button>
    </main>
  );
}

export function App({ store: injected }: { store?: GameStore } = {}): ReactElement {
  const [store] = useState(() => {
    const s = injected ?? new GameStore(new GameClient(wsUrl()));
    s.restoreSession();
    return s;
  });
  useEffect(() => {
    store.connect();
    return () => store.disconnect();
  }, [store]);
  const s = useGameStore(store);

  if (s.takenOver) {
    return <TakenOverScreen store={store} />;
  }
  // 复盘模式优先于对局/房间路由（导入复盘不进房间，review 独立于 snapshot）
  if (s.review !== null) {
    return <ReviewScreen store={store} />;
  }
  if (s.snapshot !== null && s.seat !== null) {
    return <GameScreen store={store} />;
  }
  if (s.room !== null) {
    return <RoomView store={store} />;
  }
  return <Lobby store={store} />;
}
