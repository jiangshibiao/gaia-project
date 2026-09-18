/**
 * AnthropicClient 单测：vi.mock 掉 @anthropic-ai/sdk，不发真实请求。
 * 锁定两件防回归的事：
 * 1. 请求参数——tool_choice: 'any' + thinking: disabled（默认开 thinking 的
 *    网关/模型会 400 拒绝一切强制 tool_choice，见 client.ts 头注释）；
 * 2. 响应解析——tool_use block → choiceIndex/reason/usage；无 tool_use → -1。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { AnthropicClient } from '../src/client.js';

const REQ = {
  system: 'sys',
  user: 'usr',
  candidates: 3,
  model: 'claude-sonnet-4-5',
  maxTokens: 512,
  timeoutMs: 8000,
};

beforeEach(() => {
  createMock.mockReset();
});

describe('AnthropicClient 请求参数', () => {
  it("tool_choice 'any' + thinking disabled + maxRetries 0，timeout 走 per-request 选项", async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'choose', input: { choice_index: 1, reason: 'r' } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const client = new AnthropicClient({ apiKey: 'test-key' });
    await client.decide(REQ);

    expect(createMock).toHaveBeenCalledOnce();
    const [params, options] = createMock.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(params['tool_choice']).toEqual({ type: 'any' });
    expect(params['thinking']).toEqual({ type: 'disabled' });
    expect(params['model']).toBe('claude-sonnet-4-5');
    expect((params['tools'] as unknown[]).length).toBe(1);
    expect(options['timeout']).toBe(8000);
  });

  it('model 为空串时回落 GAIA_AI_MODEL 再回落默认', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'choose', input: { choice_index: 0, reason: 'r' } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = new AnthropicClient({ apiKey: 'k' });
    process.env['GAIA_AI_MODEL'] = 'test-model-x';
    await client.decide({ ...REQ, model: '' });
    expect((createMock.mock.calls[0] as [Record<string, unknown>])[0]['model']).toBe('test-model-x');
    delete process.env['GAIA_AI_MODEL'];
    await client.decide({ ...REQ, model: '' });
    expect((createMock.mock.calls[1] as [Record<string, unknown>])[0]['model']).toBe('claude-sonnet-4-5');
  });
});

describe('AnthropicClient 响应解析', () => {
  it('tool_use block → choiceIndex/reason/usage', async () => {
    createMock.mockResolvedValue({
      content: [
        { type: 'text', text: '忽略我' },
        { type: 'tool_use', name: 'choose', input: { choice_index: 2, reason: '建矿扩张' } },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    const r = await new AnthropicClient({ apiKey: 'k' }).decide(REQ);
    expect(r).toEqual({
      choiceIndex: 2,
      reason: '建矿扩张',
      usage: { inputTokens: 100, outputTokens: 20 },
    });
  });

  it('非整数 choice_index / 无 tool_use → choiceIndex=-1（交 LLMAgent 重试）', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'tool_use', name: 'choose', input: { choice_index: -0.5, reason: 'x' } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const client = new AnthropicClient({ apiKey: 'k' });
    expect((await client.decide(REQ)).choiceIndex).toBe(-1);

    createMock.mockResolvedValue({
      content: [{ type: 'text', text: '没有 tool call' }],
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    expect((await client.decide(REQ)).choiceIndex).toBe(-1);
  });
});
