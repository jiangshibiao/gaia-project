/**
 * 测试共享辅助：setup 完成驱动（与 apply 层同逻辑的空枚举跳过）。
 * 全部从包根公共 API 导入。
 */
import {
  advanceSetup,
  applyAction,
  enumerateActions,
  newGame,
  type Action,
  type GameConfig,
  type GameState,
} from '../src/index.js';

/** setup 队首无合法行动时跳过（镜像 apply 层 settleSetupSkips，用公开 API）。 */
export function skipStuckSetup(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 32 && s.phase === 'setup' && s.setupQueue.length > 0; i++) {
    // 放置产生的充能邀约待决时不得跳过。
    if (s.pending !== null) {
      break;
    }
    if (enumerateActions(s, s.setupQueue[0]!).length > 0) {
      break;
    }
    s = advanceSetup(s);
  }
  return s;
}

/** 当前应行动的玩家（pending 响应者 > setup 队首）。 */
function actingPlayer(state: GameState): number {
  const pending = state.pending;
  if (pending !== null) {
    return pending.kind === 'charge' ? pending.queue[0]!.player : pending.player;
  }
  return state.setupQueue[0]!;
}

/** 用 pick（默认首个合法行动）完成 setup；返回进入行动阶段的状态（含第 1 轮收入）。 */
export function completeSetup(
  state: GameState,
  pick?: (legal: Action[], s: GameState) => Action,
): GameState {
  let s = state;
  for (let i = 0; i < 100 && s.phase === 'setup'; i++) {
    s = skipStuckSetup(s);
    if (s.phase !== 'setup') {
      break;
    }
    const legal = enumerateActions(s, actingPlayer(s));
    const action = pick !== undefined ? pick(legal, s) : legal[0]!;
    s = applyAction(s, action);
  }
  if (s.phase !== 'action') {
    throw new Error('completeSetup: 未能进入行动阶段');
  }
  // 第 1 轮收入可能产生收入顺序待决（tests 大多不关心顺序）——自动结清，
  // 返回干净行动态（盖亚阶段的 terrans/itars/tinkering pending 不受影响）。
  return flushIncome(s);
}

/** newGame + 完成 setup，进入第 1 轮行动阶段。 */
export function actionPhase(config: GameConfig, pick?: (legal: Action[], s: GameState) => Action): GameState {
  return completeSetup(newGame(config), pick);
}

/** 收入充能顺序待决自动冲刷（tokens-first）：测试不关心收入顺序的场景用。 */
export function flushIncome(state: GameState): GameState {
  let s = state;
  for (let i = 0; i < 8 && s.pending?.kind === 'income-order'; i++) {
    s = applyAction(s, { type: 'income-order', order: 'tokens-first' });
  }
  return s;
}

/** 完成回合（turnHold 放闸）：主行动后需要推进到下一玩家时使用。 */
export function endTurn(state: GameState): GameState {
  return applyAction(state, { type: 'confirm-turn' });
}

/** 当前玩家的合法行动。 */
export function legalOf(state: GameState): Action[] {
  return enumerateActions(state, state.currentPlayerIdx);
}
