/**
 * 统一决策接口：server 只依赖 DecidingAgent。
 * 任何 agent（插件/LLM/启发式）都被包装成 Decision 产出。
 */
import type { Action, GameState, PlayerIndex } from '@gaia/engine';

export interface Decision {
  action: Action;
  reason: string;
  /** true 表示本次决策来自兜底（非首选路径），客户端可标注。 */
  degraded: boolean;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface DecidingAgent {
  decide(state: GameState, seat: PlayerIndex, legal: Action[]): Promise<Decision>;
}
