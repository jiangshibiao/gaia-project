/**
 * 复盘本地重放助手（导入/导出 + 复盘回放）：newGame(record.config) + 前 step 条
 * applyAction 确定性重放。导出记录已经服务器重放校验，本地重放一般不应失败；
 * 一旦失败抛出带步号的错误（ReviewScreen 展示并停止）。
 */
import { applyAction, newGame } from '@gaia/engine';
import type { GameState, PlayerIndex } from '@gaia/engine';
import { actorOf } from '@gaia/protocol';
import type { GameRecord } from '@gaia/protocol';

export interface ReplayFrame {
  /** 重放 step 条行动后的局面。 */
  state: GameState;
  /** 执行第 step 条行动的玩家（step=0 时为开局首个应行动者；终局为 null）。 */
  stepActor: PlayerIndex | null;
}

/** 从头重放到第 step 步（step ∈ [0, record.actions.length]）。 */
export function replayFrame(record: GameRecord, step: number): ReplayFrame {
  let state = newGame(record.config);
  let stepActor = actorOf(state);
  for (let i = 0; i < step; i++) {
    stepActor = actorOf(state);
    try {
      state = applyAction(state, record.actions[i]!);
    } catch (e) {
      throw new Error(`第 ${i + 1} 步行动无法重放：${(e as Error).message}`);
    }
  }
  return { state, stepActor };
}
