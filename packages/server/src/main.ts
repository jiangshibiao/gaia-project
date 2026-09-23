/**
 * 生产入口：PORT（默认 8430）、DB_PATH（默认 ./gaia.db）、WEB_DIST（存在则同端口托管）。
 * dev 不设 WEB_DIST——vite dev server 起静态，proxy 转发 /ws 到本进程。
 *
 * AI 座位：ANTHROPIC_API_KEY 存在时经 AnthropicClient 构造 LLMAgent（按座位难度，
 * GAIA_AI_MODEL 可覆盖默认模型）；缺失 → GAIA_AI_SPEC 选择插件（缺省
 * DEFAULT_SPEC，可选见 listAgentPlugins），不产生 LLM 调用。
 * GAIA_AI_PACE_MS 控制每步 AI 行动间隔（默认 300ms，0 = 不减速）。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  AnthropicClient,
  DEFAULT_SPEC,
  LLMAgent,
  agentFactoryFromSpec,
  listAgentPlugins,
} from '@gaia/llm';
import { createGameServer, type GameServerOptions } from './ws.js';

async function main(): Promise<void> {
  const port = Number(process.env['PORT'] ?? '8430');
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT 非法: ${process.env['PORT']}`);
  }
  const options: GameServerOptions = {
    port,
    dbPath: process.env['DB_PATH'] ?? './gaia.db',
    // AI 行动节奏：每步 AI 行动之间停 300ms（GAIA_AI_PACE_MS 可调，0 = 不减速）
    aiPaceMs: Number(process.env['GAIA_AI_PACE_MS'] ?? 300),
  };
  let aiDesc: string;
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  if (anthropicKey !== undefined && anthropicKey !== '') {
    const client = new AnthropicClient({ apiKey: anthropicKey });
    options.aiAgentFactory = (_seat, difficulty) => new LLMAgent(client, difficulty);
    aiDesc = `llm（模型按难度，GAIA_AI_MODEL=${process.env['GAIA_AI_MODEL'] ?? '默认'}）`;
  } else {
    // 插件式 AI（agents/ 单文件注册制）：GAIA_AI_SPEC 选择，缺省 DEFAULT_SPEC
    const spec = process.env['GAIA_AI_SPEC'] || DEFAULT_SPEC;
    console.warn(
      `[gaia] ANTHROPIC_API_KEY 未设置：AI 座位用内置插件 ${spec}，不产生 LLM 调用`,
    );
    options.aiAgentFactory = agentFactoryFromSpec(spec);
    aiDesc = spec;
  }
  const webDist = process.env['WEB_DIST'];
  if (webDist !== undefined && webDist !== '' && existsSync(webDist)) {
    options.staticDir = resolve(webDist);
  }
  const server = await createGameServer(options);
  console.log(
    `[gaia] listening on :${server.port} (db=${options.dbPath}, ai=${aiDesc}` +
      `（插件可选：${listAgentPlugins().map((m) => m.spec).join(', ')}）` +
      `${options.staticDir !== undefined ? `, static=${options.staticDir}` : ''})`,
  );
  const shutdown = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

// 纯入口文件：不设 import 守卫（vite-node/tsx 会把脚本路径从 argv 抹掉，守卫判不出来；
// 包内无任何模块 import 本文件）。
main().catch((e: unknown) => {
  console.error('[gaia] 启动失败', e);
  process.exit(1);
});
