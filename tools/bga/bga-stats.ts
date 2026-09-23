/**
 * BGA 全量摘要统计：对 data/bga/tables.jsonl（蒸馏摘要）+ reference/bga-cache/infos
 * 做聚合——玩家维度、局型（人数×是否 LF）分数分布、种族胜率（种族只在日志子集里，
 * 标注覆盖率）。
 *
 *   npx vite-node tools/bga/bga-stats.ts
 *
 * 口径：
 * - 平均分 = 该局所有玩家分数的均值；最高分均分 = 每局最高分的均值。
 * - 胜率 = 第一名（并列按并列第一各记一次）次数/局数。
 * - LF 判定来自 tableinfos 的 options（失落舰队扩展）；无 infos 的桌归入"未知"档。
 * - 种族仅从日志子集（reference/bga-cache/logs）的 notifyChooseRace/raceId 得到——
 *   覆盖率随日志拉取量增长；raceId→族名映射未实证时按 raceId 报告。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = join(__dirname, '..', '..');
const CACHE = join(REPO, 'reference', 'bga-cache');
const DATA = join(REPO, 'data', 'bga');

interface TableRec {
  id: string;
  d: string;
  pc: number;
  p: [string, number, number][]; // [名字, 分数, ELO后]
  lf?: number;
  ne?: number;
  ar?: number; // Arena 竞技桌
  th?: number; // 锦标赛桌
}

interface LogPacket {
  data?: { type?: string; args?: Record<string, unknown> }[];
}

function loadTables(): TableRec[] {
  return readFileSync(join(DATA, 'tables.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as TableRec);
}

/** 对没有 infos 的桌，从缓存 infos 补 lf 标记（export 时可能还没有）。 */
function lfOf(id: string, rec: TableRec): 'lf' | 'base' | 'unknown' {
  if (rec.lf === 1) return 'lf';
  const f = join(CACHE, 'infos', `${id}.json`);
  if (!existsSync(f)) return 'unknown';
  try {
    const info = JSON.parse(readFileSync(f, 'utf8')) as {
      data?: { options?: Record<string, { name: string; value: string }> };
    };
    const on = Object.values(info.data?.options ?? {}).some(
      (o) => /lost fleet|舰队/i.test(o.name) && o.value !== '0' && !/^off$/i.test(o.value),
    );
    return on ? 'lf' : 'base';
  } catch {
    return 'unknown';
  }
}

function main(): void {
  const tables = loadTables().filter((t) => t.ne !== 0); // 只统计正常结束
  console.log(`正常结束桌数 ${tables.length}`);

  // --- 玩家维度 ---
  interface PStat {
    games: number;
    wins: number;
    scoreSum: number;
    scoreN: number;
    elo: number;
  }
  const players = new Map<string, PStat>();
  for (const t of tables) {
    const maxScore = Math.max(...t.p.map((x) => x[1]));
    for (const [name, score, elo] of t.p) {
      const s = players.get(name) ?? { games: 0, wins: 0, scoreSum: 0, scoreN: 0, elo: 0 };
      s.games++;
      if (score === maxScore) s.wins++;
      s.scoreSum += score;
      s.scoreN++;
      if (elo > 0) s.elo = elo;
      players.set(name, s);
    }
  }
  const top = [...players.entries()].sort((a, b) => b[1].games - a[1].games).slice(0, 15);
  console.log('\n== 对局数 Top 玩家 ==');
  for (const [name, s] of top) {
    console.log(
      `  ${name.padEnd(20)} 局 ${String(s.games).padStart(4)} 胜率 ${((s.wins / s.games) * 100).toFixed(0)}% 均分 ${(s.scoreSum / s.scoreN).toFixed(0)} ELO ${s.elo || '-'}`,
    );
  }
  const elos = [...players.values()].map((s) => s.elo).filter((e) => e > 0).sort((a, b) => a - b);
  if (elos.length > 0) {
    console.log(`ELO 分布: min ${elos[0]} | 中位 ${elos[Math.floor(elos.length / 2)]} | p90 ${elos[Math.floor(elos.length * 0.9)]} | max ${elos[elos.length - 1]}（${elos.length} 人有 ELO）`);
  }

  // --- 局型（人数 × LF）分数分布 ---
  interface GStat {
    games: number;
    scoreSum: number;
    scoreN: number;
    maxSum: number;
  }
  const groups = new Map<string, GStat>();
  for (const t of tables) {
    const lf = lfOf(t.id, t);
    const tag = t.th === 1 ? '/T锦标赛' : t.ar === 1 ? '/A竞技场' : '';
    const key = `${t.pc}p/${lf}${tag}`;
    const g = groups.get(key) ?? { games: 0, scoreSum: 0, scoreN: 0, maxSum: 0 };
    g.games++;
    for (const [, score] of t.p) {
      g.scoreSum += score;
      g.scoreN++;
    }
    g.maxSum += Math.max(...t.p.map((x) => x[1]));
    groups.set(key, g);
  }
  console.log('\n== 局型分数分布（人数×扩展） ==');
  for (const [key, g] of [...groups.entries()].sort()) {
    console.log(
      `  ${key.padEnd(12)} 局 ${String(g.games).padStart(5)} | 平均分 ${(g.scoreSum / g.scoreN).toFixed(1)} | 最高分均分 ${(g.maxSum / g.games).toFixed(1)}`,
    );
  }

  // --- 种族胜率（日志子集） ---
  const logsDir = join(CACHE, 'logs');
  const factionGames = new Map<string, number>();
  const factionWins = new Map<string, number>();
  let logGames = 0;
  if (existsSync(logsDir)) {
    for (const f of readdirSync(logsDir)) {
      if (!f.endsWith('.json')) continue;
      const raw = JSON.parse(readFileSync(join(logsDir, f), 'utf8')) as { dead?: boolean; data?: { logs?: LogPacket[] } };
      if (raw.dead === true || raw.data?.logs === undefined) continue;
      const tableId = f.replace('.json', '');
      const rec = tables.find((t) => t.id === tableId);
      if (rec === undefined) continue;
      // 选族事件：notifyChooseRace（args.raceId + playerId/ player_name）
      const raceByPlayer = new Map<string, string>();
      for (const packet of raw.data.logs) {
        for (const d of packet.data ?? []) {
          if (d.type === 'notifyChooseRace' && d.args !== undefined) {
            const pid = String(d.args.player_name ?? d.args.playerId ?? '');
            const race = String(d.args.raceId ?? '');
            if (pid !== '' && race !== '') raceByPlayer.set(pid, race);
          }
        }
      }
      if (raceByPlayer.size === 0) continue;
      logGames++;
      const maxScore = Math.max(...rec.p.map((x) => x[1]));
      for (const [name, score] of rec.p) {
        const race = raceByPlayer.get(name);
        if (race === undefined) continue;
        const key = `race${race}`;
        factionGames.set(key, (factionGames.get(key) ?? 0) + 1);
        if (score === maxScore) factionWins.set(key, (factionWins.get(key) ?? 0) + 1);
      }
    }
  }
  console.log(`\n== 种族胜率（日志子集，覆盖 ${logGames} 局） ==`);
  for (const [race, games] of [...factionGames.entries()].sort((a, b) => b[1] - a[1])) {
    const wins = factionWins.get(race) ?? 0;
    console.log(`  ${race.padEnd(8)} 局 ${String(games).padStart(4)} 胜率 ${((wins / games) * 100).toFixed(1)}%`);
  }
}

main();
