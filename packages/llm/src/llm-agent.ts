/**
 * LLMAgent——M3 决策链：预筛 → LLM 选择 → 校验 → 重试一次 → 启发式降级。
 *
 * decide(state, seat, legal) 流程（座位在参数上，不绑构造，与 DecidingAgent
 * 契约一致；返回的 action 恒来自调用方给的 legal 集）：
 * 1. prescreen(state, seat, legal, topK)：scoreAction 快评取 Top K 候选
 *    （topK 按难度：easy 8 / normal 20 / hard 40）；
 * 2. buildDecisionPrompt（system 静态缓存友好；user = 局势摘要 + 0-based 编号
 *    候选列表，编号与 client 返回的 choiceIndex 对齐）→ client.decide；
 *    hard 难度在 user 末尾附"剩余轮数与后续计分板"前瞻段
 *    （summarize.ts lookaheadSection）；
 * 3. choiceIndex 越界（非整数或不在 [0, candidates)）→ 带错误原因重试一次：
 *    user 末尾追加"上次回复无效：…，请重新选择"；
 * 4. 重试仍无效，或任一调用抛 API 异常（超时/网络/余额）→ 降级 HeuristicAgent
 *    Top-1：degraded=true，reason 记录降级原因，已消耗的 token 仍计入 usage
 *    （重试成功时 usage 为两次调用之和）。对局永不卡死。
 *
 * DIFFICULTY：easy 用 claude-haiku-4-5（便宜快），normal/hard 用
 * claude-sonnet-4-5；timeoutMs 均 8000、maxTokens 512。
 * GAIA_AI_MODEL 环境变量覆盖难度默认模型（网关不提供默认模型名时用）。
 */
import type { Action, GameState, PlayerIndex } from '@gaia/engine';
import type { ClaudeClient } from './client.js';
import type { DecidingAgent, Decision } from './decision.js';
import { HeuristicAgent, prescreen } from './heuristic.js';
import { buildDecisionPrompt, describeAction } from './summarize.js';

export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTY: Record<
  Difficulty,
  { topK: number; model: string; maxTokens: number; timeoutMs: number }
> = {
  easy: {
    topK: 8,
    model: 'claude-haiku-4-5',
    maxTokens: 512,
    timeoutMs: 8000,
  },
  normal: {
    topK: 20,
    model: 'claude-sonnet-4-5',
    maxTokens: 512,
    timeoutMs: 8000,
  },
  hard: {
    topK: 40,
    model: 'claude-sonnet-4-5',
    maxTokens: 512,
    timeoutMs: 8000,
  },
} as const;

/** choiceIndex 无效时的人类可读原因（写入重试 prompt 与降级 reason）。 */
function invalidReason(choiceIndex: number, candidates: number): string {
  // -1 为"无 tool_use / 非整数"哨兵（见 client.ts parseChooseInput）——
  // 区别于显式越界，措辞指明须调用 choose 工具。
  if (choiceIndex === -1) {
    return '未返回结构化选择（须调用 choose 工具提交 choice_index 与 reason）';
  }
  return (
    `choiceIndex=${choiceIndex} 超出候选范围 ` +
    `[0, ${candidates - 1}]（共 ${candidates} 个候选）`
  );
}

function isValid(choiceIndex: number, candidates: number): boolean {
  return (
    Number.isInteger(choiceIndex) && choiceIndex >= 0 && choiceIndex < candidates
  );
}

export class LLMAgent implements DecidingAgent {
  private readonly client: ClaudeClient;
  private readonly difficulty: Difficulty;
  private readonly fallback: DecidingAgent;

  constructor(
    client: ClaudeClient,
    difficulty: Difficulty = 'normal',
    fallback: DecidingAgent = new HeuristicAgent(),
  ) {
    this.client = client;
    this.difficulty = difficulty;
    this.fallback = fallback;
  }

  async decide(
    state: GameState,
    seat: PlayerIndex,
    legal: Action[],
  ): Promise<Decision> {
    if (legal.length === 0) {
      throw new Error('LLMAgent.decide: no legal actions');
    }
    const cfg = DIFFICULTY[this.difficulty];
    const candidates = prescreen(state, seat, legal, cfg.topK);
    const described = candidates.map((action) => ({
      action,
      description: describeAction(state, seat, action),
    }));
    const { system, user } = buildDecisionPrompt(state, seat, described, {
      lookahead: this.difficulty === 'hard',
    });
    const baseReq = {
      system,
      candidates: candidates.length,
      // GAIA_AI_MODEL 覆盖难度默认模型（网关不提供默认模型名时用）。
      model: process.env['GAIA_AI_MODEL'] ?? cfg.model,
      maxTokens: cfg.maxTokens,
      timeoutMs: cfg.timeoutMs,
    };
    const usage = { inputTokens: 0, outputTokens: 0 };

    try {
      const first = await this.client.decide({ ...baseReq, user });
      usage.inputTokens += first.usage.inputTokens;
      usage.outputTokens += first.usage.outputTokens;
      if (isValid(first.choiceIndex, candidates.length)) {
        return {
          action: candidates[first.choiceIndex]!,
          reason: first.reason,
          degraded: false,
          usage,
        };
      }
      const why = invalidReason(first.choiceIndex, candidates.length);
      const retryUser =
        `${user}\n\n上次回复无效：${why}。` +
        `请重新选择，choiceIndex 须在 0 到 ${candidates.length - 1} 之间（含两端）。`;
      const second = await this.client.decide({ ...baseReq, user: retryUser });
      usage.inputTokens += second.usage.inputTokens;
      usage.outputTokens += second.usage.outputTokens;
      if (isValid(second.choiceIndex, candidates.length)) {
        return {
          action: candidates[second.choiceIndex]!,
          reason: second.reason,
          degraded: false,
          usage,
        };
      }
      return this.degrade(
        state,
        seat,
        legal,
        `重试仍无效：${invalidReason(second.choiceIndex, candidates.length)}`,
        usage,
      );
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      return this.degrade(state, seat, legal, `API 异常：${cause}`, usage);
    }
  }

  /** 降级路径：HeuristicAgent Top-1，reason 记录降级原因，usage 为已消耗 token。 */
  private async degrade(
    state: GameState,
    seat: PlayerIndex,
    legal: Action[],
    cause: string,
    usage: { inputTokens: number; outputTokens: number },
  ): Promise<Decision> {
    const d = await this.fallback.decide(state, seat, legal);
    return {
      action: d.action,
      reason: `LLM 决策降级（${cause}）；${d.reason}`,
      degraded: true,
      usage,
    };
  }
}
