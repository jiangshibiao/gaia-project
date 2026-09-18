/**
 * AI 插件契约。
 * 一个 AI = 一个单文件插件（默认导出 AgentPlugin），在 registry.ts 登记一行即注册。
 * 本文件同时是 exec: 传输（规划中）的协议文档。
 */
import type { Action, GameState, PlayerIndex } from '@gaia/engine';

export interface AgentPluginMeta {
  name: string;
  version: string;
  description: string;
  author?: string;
}

export interface DecideInput {
  state: GameState;
  seat: PlayerIndex;
  legal: Action[];
  clockMs?: number;
}

export interface AgentInstance {
  decide(input: DecideInput): Action | Promise<Action>;
  /** 可选：解释上一步决策（用于客户端展示与日志）。 */
  explain?(): string;
}

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface AgentContext {
  seat: PlayerIndex;
  difficulty?: Difficulty | undefined;
}

export interface AgentPlugin {
  meta: AgentPluginMeta;
  create(ctx: AgentContext): AgentInstance;
}
