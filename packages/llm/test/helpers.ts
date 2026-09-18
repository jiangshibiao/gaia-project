/**
 * 测试共用：从 newGame 随机推进到满足条件的局面（setup/行动阶段均可）。
 * 随机选择由 createRng 驱动（确定性种子），settleSetupSkips 处理 setup 空枚举。
 */
import {
  applyAction,
  createRng,
  enumerateActions,
  newGame,
  settleSetupSkips,
  type Action,
  type GameState,
  type PlayerIndex,
} from '@gaia/engine';

export interface Snapshot {
  state: GameState;
  actor: PlayerIndex;
  legal: Action[];
}

/** 当前应行动的玩家（与 engine playGame 同口径）。 */
function actingPlayer(state: GameState): PlayerIndex {
  const pending = state.pending;
  if (pending !== null) {
    return pending.kind === 'charge' ? pending.queue[0]!.player : pending.player;
  }
  if (state.phase === 'setup') {
    return state.setupQueue[0]!;
  }
  return state.currentPlayerIdx;
}

/** 从指定 seed 随机推进，直到 pred 命中（返回当时的 state/actor/legal）。 */
export function playUntil(
  pred: (state: GameState, actor: PlayerIndex, legal: Action[]) => boolean,
  opts?: { seed?: number; maxSteps?: number },
): Snapshot {
  const seed = opts?.seed ?? 7;
  const maxSteps = opts?.maxSteps ?? 5000;
  let state = newGame({
    playerCount: 2,
    seed,
    factions: ['terrans', 'xenos'],
    lostFleet: true,
  });
  const rng = createRng(seed * 1000 + 1);
  for (let i = 0; i < maxSteps; i++) {
    if (state.phase === 'game-over') break;
    const actor = actingPlayer(state);
    const legal = enumerateActions(state, actor);
    if (legal.length === 0) {
      const settled = settleSetupSkips(state);
      if (settled !== state) {
        state = settled;
        continue;
      }
      break;
    }
    if (pred(state, actor, legal)) {
      return { state, actor, legal };
    }
    state = applyAction(state, legal[rng.nextInt(legal.length)]!);
  }
  throw new Error(`playUntil: ${maxSteps} 步内未命中条件（seed=${seed}）`);
}
