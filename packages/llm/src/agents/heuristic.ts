/**
 * heuristic 插件：启发式评分内核（scoreAction Top-1）注册进插件体系。
 * 评分逻辑在 ../heuristic.ts（HeuristicAgent），本文件只是 AgentPlugin 包装。
 */
import type { AgentPlugin } from './contract.js';
import { HeuristicAgent } from '../heuristic.js';

const plugin: AgentPlugin = {
  meta: {
    name: 'heuristic',
    version: '1.0.0',
    description: '启发式评分内核：scoreAction 快评取 Top-1（确定性 tie-break）',
    author: 'gaia',
  },
  create: () => {
    const agent = new HeuristicAgent();
    let lastReason = 'heuristic Top-1';
    return {
      async decide(input) {
        const d = await agent.decide(input.state, input.seat, input.legal);
        lastReason = d.reason;
        return d.action;
      },
      explain: () => lastReason,
    };
  },
};

export default plugin;
