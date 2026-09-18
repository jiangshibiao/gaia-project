/**
 * 插件注册表：新增 AI 只需 (1) agents/ 下加一个单文件插件 (2) 这里登记一行。
 * spec 格式：builtin:<name>（exec:<path> 外部进程传输预留）。
 */
import type { Action, GameState, PlayerIndex } from '@gaia/engine';
import type { AgentContext, AgentPlugin } from './contract.js';
import type { DecidingAgent, Decision } from '../decision.js';
import firstLegal from './first-legal.js';
import heuristic from './heuristic.js';
import random from './random.js';

const BUILTIN_PLUGINS: Record<string, AgentPlugin> = {
  'first-legal': firstLegal,
  heuristic,
  random,
};

export const DEFAULT_SPEC = 'builtin:heuristic';

export interface AgentPluginInfo {
  spec: string;
  name: string;
  version: string;
  description: string;
}

export function listAgentPlugins(): AgentPluginInfo[] {
  return Object.entries(BUILTIN_PLUGINS).map(([name, p]) => ({
    spec: `builtin:${name}`,
    name: p.meta.name,
    version: p.meta.version,
    description: p.meta.description,
  }));
}

export function resolveAgentPlugin(spec: string): AgentPlugin {
  const [kind, name] = spec.split(':', 2);
  if (kind === 'builtin' && name && BUILTIN_PLUGINS[name]) {
    return BUILTIN_PLUGINS[name];
  }
  throw new Error(`unknown agent spec: ${spec}`);
}

/** 把插件包装成统一 Decision（reason 取 explain()，标记 degraded=true 表示非 LLM 路径）。 */
export function createAgent(spec: string, ctx: AgentContext): DecidingAgent {
  const plugin = resolveAgentPlugin(spec);
  const instance = plugin.create(ctx);
  return {
    async decide(state: GameState, seat: PlayerIndex, legal: Action[]): Promise<Decision> {
      const action = await instance.decide({ state, seat, legal });
      return {
        action,
        reason: instance.explain?.() ?? `${plugin.meta.name} choice`,
        degraded: true,
      };
    },
  };
}

/** server 的 AI 座位注入缝。 */
export function agentFactoryFromSpec(spec: string) {
  return (seat: PlayerIndex, difficulty?: AgentContext['difficulty']): DecidingAgent =>
    createAgent(spec, { seat, difficulty });
}
