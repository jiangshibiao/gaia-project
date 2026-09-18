/**
 * heuristic2：CFG 驱动的估价型 AI（v2）。
 * 社区量化估价表 + 分阶段权重 + 2-ply 前瞻 + 局面叶估值 + 种族插件 + 变体差异。
 */
import { createEvalPlugin } from '../heuristic2/index.js';

export default createEvalPlugin({
  meta: {
    name: 'heuristic2',
    version: '2.0.0',
    description: 'CFG 估价 v2：社区量化价值表 + 分阶段权重 + 2-ply 前瞻 + 种族插件（含 LF 变体差异）',
    author: 'gaia-project',
  },
  tuneEnvVar: 'GAIA_TUNE_V2',
});
