/**
 * @gaia/llm — AI 层。消费方只许从包根导入。
 * M3：启发式评分内核（scoreAction/prescreen/HeuristicAgent）、局势摘要
 * （summarizeState/describeAction/buildDecisionPrompt）、LLM 决策链
 * （ClaudeClient/AnthropicClient/LLMAgent，tool use 强制 choose + 启发式兜底）。
 */
export type { AgentContext, AgentInstance, AgentPlugin, AgentPluginMeta, DecideInput, Difficulty } from './agents/contract.js';
export {
  DEFAULT_SPEC,
  agentFactoryFromSpec,
  createAgent,
  listAgentPlugins,
  resolveAgentPlugin,
} from './agents/registry.js';
export type { AgentPluginInfo } from './agents/registry.js';
export type { DecidingAgent, Decision } from './decision.js';
export { AnthropicClient } from './client.js';
export type { ClaudeClient, DecideRequest, DecideResponse } from './client.js';
export { HeuristicAgent, prescreen, scoreAction, scoredActions } from './heuristic.js';
export { createEvalPlugin } from './heuristic2/index.js';
export { BASE_CFG, LF_DELTA, cfgForVariant, mergeCfg } from './heuristic2/cfg.js';
export type { Cfg, DeepPartial, Phase, Variant } from './heuristic2/cfg.js';
export { evalCtx } from './heuristic2/context.js';
export type { EvalCtx } from './heuristic2/context.js';
export { FACTION_HOOKS, FACTION_STRENGTH, factionHooks, pickFactionByStrength } from './heuristic2/factions.js';
export type { FactionHooks } from './heuristic2/factions.js';
export { evaluatePosition, evaluateState } from './heuristic2/position.js';
export { LLMAgent, DIFFICULTY } from './llm-agent.js';
export {
  SYSTEM_PROMPT,
  buildDecisionPrompt,
  describeAction,
  lookaheadSection,
  summarizeState,
} from './summarize.js';
