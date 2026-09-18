/**
 * heuristic2 插件工厂：CFG + overrides 版本壳模式（参照 BrassBirmingham
 * createHeuristicPlugin）——一个新版本 = 一个调用 + 一份 DeepPartial 差异。
 *
 * decide 流程：evalCtx → scoredActions（全量静态打分）→（可选）2-ply 前瞻
 * （剪枝候选仿真 + 叶估值）→ 取 max。兜底链：空 legal 抛错（引擎契约不会
 * 调用）；评分异常由 safeScore 记 −1e9；前瞻全灭退回静态 Top-1。
 *
 * tuneEnvVar：从环境变量读 JSON DeepPartial 注入 overrides（bench 消融调参用）。
 */
import type { Action } from '@gaia/engine';
import type {
  AgentInstance,
  AgentPlugin,
  AgentPluginMeta,
  DecideInput,
} from '../agents/contract.js';
import { mergeCfg, type Cfg, type DeepPartial } from './cfg.js';
import { evalCtx } from './context.js';
import { chooseWithLookahead, scoredActions } from './lookahead.js';
import { chooseWithSearch, describeSearch } from './search.js';
import { chooseWithSelfSearch } from './selfsearch.js';

export interface EvalPluginOptions {
  meta: AgentPluginMeta;
  /** 本版本相对 BASE_CFG（+LF_DELTA）的差异。 */
  overrides?: DeepPartial<Cfg>;
  /** 设了就从该环境变量读 JSON DeepPartial 追加注入（调参用）。 */
  tuneEnvVar?: string;
}

function envOverrides(name: string | undefined): DeepPartial<Cfg> | undefined {
  if (name === undefined) return undefined;
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  try {
    return JSON.parse(raw) as DeepPartial<Cfg>;
  } catch (e) {
    throw new Error(`${name} 不是合法 JSON: ${(e as Error).message}`);
  }
}

export function createEvalPlugin(opts: EvalPluginOptions): AgentPlugin {
  const overrides = mergeCfg(
    (opts.overrides ?? {}) as DeepPartial<Cfg>,
    envOverrides(opts.tuneEnvVar),
  );
  return {
    meta: opts.meta,
    create(): AgentInstance {
      let lastReason = `${opts.meta.name} ready`;
      return {
        decide(input: DecideInput): Action {
          const { state, seat, legal } = input;
          if (legal.length === 0) {
            throw new Error(`${opts.meta.name}.decide: no legal actions`);
          }
          if (legal.length === 1) {
            lastReason = `${opts.meta.name}: 唯一合法行动 ${legal[0]!.type}`;
            return legal[0]!;
          }
          const ctx = evalCtx(state, seat, overrides);
          const scored = scoredActions(ctx, legal);
          const top = scored[0]!;
          if (!ctx.cfg.lookahead.enabled && !ctx.cfg.search.enabled) {
            lastReason =
              `${opts.meta.name} 静态 Top-1: ${top.action.type} score=${top.score.toFixed(1)}` +
              (scored[1] !== undefined
                ? `（次优 ${scored[1].action.type} ${scored[1].score.toFixed(1)}）`
                : '');
            return top.action;
          }
          if (ctx.cfg.selfSearch.enabled) {
            const result = chooseWithSelfSearch(state, seat, scored, ctx.cfg, overrides);
            lastReason =
              `${opts.meta.name} 自我深搜: ${result.action.type} value=${result.value.toFixed(1)}` +
              `（静态 ${result.staticScore.toFixed(1)}，节点 ${result.nodes}，` +
              `静态 Top-1 ${top.action.type} ${top.score.toFixed(1)}）`;
            return result.action;
          }
          if (ctx.cfg.search.enabled) {
            const result = chooseWithSearch(state, seat, scored, ctx.cfg, overrides);
            lastReason = `${opts.meta.name} 深搜: ${result.action.type} ${describeSearch(result, top)}`;
            return result.action;
          }
          const result = chooseWithLookahead(ctx, scored, overrides);
          lastReason =
            `${opts.meta.name}: ${result.action.type} value=${result.value.toFixed(1)}` +
            `（静态 ${result.staticScore.toFixed(1)}${result.simulated ? '+前瞻' : ''}，` +
            `静态 Top-1 ${top.action.type} ${top.score.toFixed(1)}）`;
          return result.action;
        },
        explain(): string {
          return lastReason;
        },
      };
    },
  };
}
