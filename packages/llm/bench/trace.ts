/**
 * bench 落盘：decisions.jsonl（每步决策一条）+ games.jsonl（每局一条）。
 *
 * 输出目录 bench/out/<runId>/（runId 由 CLI 给，默认时间戳；bench/out/ 已
 * gitignore）。纯 append JSONL——中断也不丢已完成的局。
 */
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DrivenGame, DecisionTrace } from './drive-game.js';

/** 一局的结果记录（games.jsonl 一行）。 */
export interface GameRecord {
  /** 本局种子（镜像局同种子、seatLabels 互换）。 */
  seed: number;
  /** 是否镜像换边局。 */
  mirrored: boolean;
  /** 座位 → agent 标签（如 ["llm:normal", "heuristic"]）。 */
  seatLabels: string[];
  /** 座位 → 终局 VP。 */
  vps: number[];
  /** 胜者座位；平局为 null。 */
  winner: number | null;
  /** 总步数（= 决策数）。 */
  steps: number;
  /** 座位 → 决策数（charge 响应等使各座位决策数不等）。 */
  decisions: number[];
  /** 座位 → degraded 决策数。 */
  degraded: number[];
  /** 座位 → token 用量合计。 */
  usage: { inputTokens: number; outputTokens: number }[];
  durationMs: number;
}

/** 由 DrivenGame 汇总 GameRecord（state.winner 单人 → 该座位，并列/空 → null）。 */
export function gameRecord(
  game: DrivenGame,
  seatLabels: string[],
  mirrored: boolean,
  durationMs: number,
): GameRecord {
  const vps = game.state.players.map((p) => p.vp);
  const winner = game.state.winner !== null && game.state.winner.length === 1 ? game.state.winner[0]! : null;
  const degraded = seatLabels.map(() => 0);
  const decisions = seatLabels.map(() => 0);
  const usage = seatLabels.map(() => ({ inputTokens: 0, outputTokens: 0 }));
  for (const d of game.decisions) {
    decisions[d.seat]!++;
    if (d.degraded) degraded[d.seat]!++;
    usage[d.seat]!.inputTokens += d.usage.inputTokens;
    usage[d.seat]!.outputTokens += d.usage.outputTokens;
  }
  return {
    seed: game.seed,
    mirrored,
    seatLabels,
    vps,
    winner,
    steps: game.decisions.length,
    decisions,
    degraded,
    usage,
    durationMs,
  };
}

/** 追加写 JSONL 的落盘器；构造即建目录。 */
export class TraceWriter {
  private readonly decisionsPath: string;
  private readonly gamesPath: string;

  constructor(outDir: string) {
    mkdirSync(outDir, { recursive: true });
    this.decisionsPath = join(outDir, 'decisions.jsonl');
    this.gamesPath = join(outDir, 'games.jsonl');
    // 防污染：目录已存在且 games.jsonl 非空（上次跑批残留）→ 拒绝追加。
    if (existsSync(this.gamesPath) && statSync(this.gamesPath).size > 0) {
      throw new Error(
        `拒绝写 ${outDir}：games.jsonl 已非空（上次跑批残留）。` +
        `换新 --out 目录，或用空目录重试。`,
      );
    }
  }

  decision(trace: DecisionTrace & { seed: number; mirrored: boolean }): void {
    appendFileSync(this.decisionsPath, JSON.stringify(trace) + '\n');
  }

  game(record: GameRecord): void {
    appendFileSync(this.gamesPath, JSON.stringify(record) + '\n');
  }
}
