/**
 * 自对弈驱动：PlayerAgent 接口、RandomAgent（均匀随机）、playGame。
 * playGame 循环 enumerate → choose → applyAction（assumeLegal，行动来自枚举
 * 必然合法）→ log.push，直到 game-over；行动日志可用 newGame 同 config +
 * 逐条 applyAction 重放（replay 测试保证逐字节一致）。
 */
import type { Action, GameConfig, GameState, PlayerIndex } from '../types.js';
import { createRng, type Rng } from '../rng.js';
import { newGame } from '../setup.js';
import { enumerateActions } from '../enumerate.js';
import { applyAction, settleSetupSkips } from '../apply.js';

export interface PlayerAgent {
  chooseAction(state: GameState, legal: Action[]): Action;
}

/** 均匀随机 agent（种子驱动，确定性）。 */
export class RandomAgent implements PlayerAgent {
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

  chooseAction(_state: GameState, legal: Action[]): Action {
    return legal[this.rng.nextInt(legal.length)]!;
  }
}

/** 步数保险上限（正常对局远低于此；超出视为 bug 抛错而非死循环）。 */
export const MAX_STEPS = 100000;

/** 当前应行动的玩家（pending 响应者 > turnHold 持闸者 > setup 队首 > 当前回合玩家）。 */
function actingPlayer(state: GameState): PlayerIndex {
  const pending = state.pending;
  if (pending !== null) {
    return pending.kind === 'charge' ? pending.queue[0]!.player : pending.player;
  }
  if (state.turnHold !== null) {
    return state.turnHold;
  }
  if (state.phase === 'setup') {
    return state.setupQueue[0]!;
  }
  return state.currentPlayerIdx;
}

/**
 * 完整对局：默认 agent 种子 = seed*10 + seatIndex。
 * 返回 { state, log }；log 为重放用完整行动序列。
 */
export function playGame(config: GameConfig, agents?: PlayerAgent[]): { state: GameState; log: Action[] } {
  let state = newGame(config);
  const agentList =
    agents ?? state.turnOrder.map((seat) => new RandomAgent(config.seed * 10 + seat));
  if (agentList.length !== state.config.playerCount) {
    throw new Error(`playGame: agents 数量 ${agentList.length} 与 playerCount 不一致`);
  }
  const log: Action[] = [];

  for (let step = 0; step < MAX_STEPS; step++) {
    if (state.phase === 'game-over') {
      return { state, log };
    }
    const actor = actingPlayer(state);
    const legal = enumerateActions(state, actor);
    if (legal.length === 0) {
      // setup 队首无合法行动（ivits/LF 新族在 mines 阶段）：跳过该玩家。
      const settled = settleSetupSkips(state);
      if (settled !== state) {
        state = settled;
        continue;
      }
      throw new Error(`playGame: 玩家 ${actor} 无合法行动且无法推进（phase=${state.phase}）`);
    }
    const action = agentList[actor]!.chooseAction(state, legal);
    log.push(action);
    state = applyAction(state, action, { assumeLegal: true });
  }
  throw new Error(`playGame: 超过 ${MAX_STEPS} 步仍未结束`);
}
