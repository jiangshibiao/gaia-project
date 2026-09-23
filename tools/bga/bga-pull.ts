/**
 * BGA 盖亚计划对局批量拉取（断点续拉、限流友好、凭据零泄漏）。
 *
 *   npx vite-node tools/bga/bga-pull.ts [--players 500] [--delay 6000]
 *        [--logs-max 90] [--phase all|ranking|games|infos|logs|export|status]
 *
 * 凭据：~/Projects/credentials/bga-cookies.txt（cookie 一行串；只按路径读，绝不打印）。
 * 缓存：reference/bga-cache/（gitignored，原始响应）：
 *   players.json      排行榜玩家 id 列表
 *   tables.jsonl      每桌一行摘要（getGames：id/玩家/分数/时间/人数）
 *   infos/<id>.json   tableinfos 原始响应（含 options——LF 判定）
 *   logs/<id>.json    archive/logs 原始响应（全量行动日志 packet）
 *   state.json        游标（ranking 进度、已爬玩家、日志日配额、limit 标记）
 * 导出：data/bga/tables.jsonl（git 跟踪的蒸馏摘要，export 阶段生成）
 *
 * 限流：默认请求间隔 6s（±20% 抖动），日志段 8s；429/5xx 指数退避（30s/60s/放弃）；
 * 日志接口有每日复盘配额，遇 "reached a limit" 立即停当日日志段（state.logLimitDate）。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..');
const CACHE = join(REPO_ROOT, 'reference', 'bga-cache');
const EXPORT_DIR = join(REPO_ROOT, 'data', 'bga');
const COOKIE_FILE = join(homedir(), 'Projects', 'credentials', 'bga-cookies.txt');
const GAME_ID = 1495; // 盖亚计划
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

interface State {
  rankingDone: boolean;
  rankingStart: number;
  donePlayers: string[];
  logLimitDate: string | null; // 触发日志日限额的日期（YYYY-MM-DD，次日重试）
  logCountDate: string;
  logCount: number;
}

interface Args {
  players: number;
  delay: number;
  logsMax: number;
  phase: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const get = (k: string, d: number): number => {
    const i = a.indexOf(`--${k}`);
    return i >= 0 ? Number(a[i + 1]) : d;
  };
  const p = a.indexOf('--phase');
  return { players: get('players', 500), delay: get('delay', 6000), logsMax: get('logs-max', 90), phase: p >= 0 ? (a[p + 1] ?? 'all') : 'all' };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const today = (): string => new Date().toISOString().slice(0, 10);

function loadCookies(): string {
  const raw = readFileSync(COOKIE_FILE, 'utf8').trim();
  if (raw.length < 20) throw new Error(`cookie 文件为空或格式不对: ${COOKIE_FILE}`);
  return raw;
}

function loadState(): State {
  const f = join(CACHE, 'state.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8')) as State;
  return { rankingDone: false, rankingStart: 0, donePlayers: [], logLimitDate: null, logCountDate: today(), logCount: 0 };
}

function saveState(st: State): void {
  writeFileSync(join(CACHE, 'state.json'), JSON.stringify(st, null, 2));
}

// ---------------------------------------------------------------------------
// HTTP（带限流/退避；cookie 与 token 只进请求头，绝不落日志）
// ---------------------------------------------------------------------------

let REQUEST_TOKEN: string | null = null;
let COOKIES = '';

async function ensureToken(): Promise<void> {
  if (REQUEST_TOKEN !== null) return;
  // 任一已登录页面都带 requestToken；抓不到时回退 TournoiEnLigneidt cookie 值（两者相同）
  const res = await fetch('https://boardgamearena.com/gamestats?game=gaiaproject', {
    headers: { 'User-Agent': UA, cookie: COOKIES },
    redirect: 'follow',
  });
  const html = await res.text();
  const m = /requestToken: '([A-Za-z0-9]+)'/.exec(html);
  if (m !== null) {
    REQUEST_TOKEN = m[1]!;
    return;
  }
  const cm = /TournoiEnLigneidt=([A-Za-z0-9]+)/.exec(COOKIES);
  if (cm === null) throw new Error('requestToken 抓取失败且 cookie 无 TournoiEnLigneidt 回退');
  REQUEST_TOKEN = cm[1]!;
}

/** 限流请求：每次间隔 args.delay（±20% 抖动），429/5xx 退避 30s→60s→放弃；
 *  单次尝试 20s 硬超时（BGA 会接连接不回包——undici headersTimeout 默认 300s，
 *  曾致 ranking/logs 阶段整段假死）。 */
async function call(url: string, delayMs: number, opts?: { xhr?: boolean }): Promise<{ status: number; body: string }> {
  await sleep(delayMs * (0.8 + Math.random() * 0.4));
  const headers: Record<string, string> = { 'User-Agent': UA, cookie: COOKIES };
  if (opts?.xhr === true) {
    await ensureToken();
    headers['X-Request-Token'] = REQUEST_TOKEN!;
    headers['X-Requested-With'] = 'XMLHttpRequest';
  }
  for (const backoff of [0, 30_000, 60_000]) {
    if (backoff > 0) {
      console.log(`[retry] ${backoff / 1000}s 后重试 ${url.slice(0, 90)}`);
      await sleep(backoff);
    }
    try {
      const res = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (res.status === 429 || res.status >= 500) continue;
      return { status: res.status, body: await res.text() };
    } catch {
      // 网络错误同样退避
    }
  }
  console.log(`[fail] 三次尝试均失败 ${url.slice(0, 90)}`);
  return { status: 0, body: '' };
}

async function callJson<T>(url: string, delayMs: number): Promise<T | null> {
  const { status, body } = await call(url, delayMs, { xhr: true });
  if (status !== 200) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 各阶段
// ---------------------------------------------------------------------------

interface RankingResp { status: number | string; data?: { ranks?: { id: string; name: string }[] } }

async function phaseRanking(args: Args, st: State): Promise<void> {
  const players: string[] = existsSync(join(CACHE, 'players.json'))
    ? (JSON.parse(readFileSync(join(CACHE, 'players.json'), 'utf8')) as string[])
    : [];
  // rankingDone 只对"不少于当前 --players 目标"生效——目标变大时继续枚举。
  if (st.rankingDone && players.length >= args.players) return;
  st.rankingDone = false;
  const seen = new Set(players);
  // 断点：从已有人数向上取整续拉（rankingStart 旧值可能更小）。
  let start = Math.max(st.rankingStart, Math.ceil(players.length / 10) * 10);
  for (; start < args.players * 2; start += 10) {
    const r = await callJson<RankingResp>(
      `https://boardgamearena.com/gamepanel/gamepanel/getRanking.html?game=${GAME_ID}&mode=elo&start=${start}`,
      args.delay,
    );
    const ranks = r?.data?.ranks;
    if (ranks === undefined || ranks.length === 0) {
      // 诊断：空响应大概率是会话/参数问题——打印原始摘要便于定位（不含凭据）。
      console.log(`[ranking] start=${start} 空响应，原始: ${JSON.stringify(r)?.slice(0, 200) ?? '(null)'}`);
      break;
    }
    for (const p of ranks) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        players.push(p.id);
      }
    }
    console.log(`[ranking] start=${start} 累计玩家 ${players.length}`);
    if (players.length >= args.players) break;
  }
  st.rankingStart = start;
  if (players.length >= args.players || start >= args.players * 2) st.rankingDone = true;
  writeFileSync(join(CACHE, 'players.json'), JSON.stringify(players));
  saveState(st);
  console.log(`[ranking] 完成：${players.length} 玩家`);
}

interface GamesResp {
  status: number | string;
  data?: {
    tables?: {
      table_id: string;
      players: string;
      player_names: string;
      scores: string;
      start: string;
      end: string;
      normalend: string;
      arena_win: string | null;
      arena_after: string | null;
    }[];
  };
}

interface TableRecLine {
  tableId: string;
  playerIds: string[];
  playerNames: string[];
  scores: number[];
  playerCount: number;
  start: number;
  end: number;
  normalend: boolean;
  arena?: boolean;
}

function loadTableRecords(): Map<string, TableRecLine> {
  const f = join(CACHE, 'tables.jsonl');
  const map = new Map<string, TableRecLine>();
  if (existsSync(f)) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (line.trim() === '') continue;
      try {
        const r = JSON.parse(line) as TableRecLine;
        map.set(r.tableId, r);
      } catch {
        // 跳过坏行
      }
    }
  }
  return map;
}

async function phaseGames(args: Args, st: State): Promise<void> {
  const players = JSON.parse(readFileSync(join(CACHE, 'players.json'), 'utf8')) as string[];
  const done = new Set(st.donePlayers);
  const known = loadTableRecords();
  let added = 0;
  let arenaTagged = 0;
  for (const pid of players) {
    if (done.has(pid)) continue;
    for (let page = 1; page <= 50; page++) {
      const r = await callJson<GamesResp>(
        `https://boardgamearena.com/gamestats/gamestats/getGames.html?player=${pid}&game_id=${GAME_ID}&finished=1&updateStats=0&page=${page}`,
        args.delay,
      );
      const tables = r?.data?.tables;
      if (tables === undefined || tables.length === 0) break;
      for (const t of tables) {
        // arena_win/arena_after 非空 = Arena（竞技赛季）桌——免费标签，无需 tableinfos。
        const arena = t.arena_win != null || t.arena_after != null;
        const old = known.get(t.table_id);
        if (old !== undefined) {
          // 已收录：仅补 arena 标签（整文件重写发生在每个玩家收尾）。
          if (arena && old.arena !== true) {
            old.arena = true;
            arenaTagged++;
          }
          continue;
        }
        const rec: TableRecLine = {
          tableId: t.table_id,
          playerIds: t.players.split(','),
          playerNames: t.player_names.split(','),
          scores: t.scores.split(',').map(Number),
          playerCount: t.players.split(',').length,
          start: Number(t.start),
          end: Number(t.end),
          normalend: t.normalend === '1',
          ...(arena ? { arena: true } : {}),
        };
        known.set(t.table_id, rec);
        added++;
      }
      if (tables.length < 10) break; // 不足一页 = 末页
    }
    done.add(pid);
    st.donePlayers.push(pid);
    saveState(st);
    // 每个玩家收尾整文件重写（合并 arena 标签补记）
    writeFileSync(
      join(CACHE, 'tables.jsonl'),
      [...known.values()].map((r2) => JSON.stringify(r2)).join('\n') + '\n',
    );
    console.log(`[games] 玩家 ${done.size}/${players.length}，新增桌 ${added}，累计 ${known.size}（arena 补记 ${arenaTagged}）`);
  }
}

interface TableInfoResp {
  status: number | string;
  data?: {
    result?: {
      player?: {
        player_id: string;
        name: string;
        score: string;
        gamerank: string;
        rank_after_game: string;
        arena_points_win?: string | null;
        arena_after_game?: string | null;
        th_name?: string | null;
      }[];
      endgame_reason?: string;
      time_duration?: string;
    };
    options?: Record<string, { name: string; value: string }>;
    game_name?: string;
  };
}

/** infos：先抽样探测 LF 选项键；之后只给日志目标桌补。--players 无关。 */
async function phaseInfos(args: Args, st: State, opts?: { onlyIds?: Set<string>; limit?: number }): Promise<void> {
  mkdirSync(join(CACHE, 'infos'), { recursive: true });
  const tables = readFileSync(join(CACHE, 'tables.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { tableId: string });
  let n = 0;
  for (const t of tables) {
    if (opts?.onlyIds !== undefined && !opts.onlyIds.has(t.tableId)) continue;
    const f = join(CACHE, 'infos', `${t.tableId}.json`);
    if (existsSync(f)) continue;
    if (opts?.limit !== undefined && n >= opts.limit) break;
    const r = await callJson<TableInfoResp>(
      `https://boardgamearena.com/table/table/tableinfos.html?id=${t.tableId}`,
      args.delay,
    );
    if (r === null) continue;
    writeFileSync(f, JSON.stringify(r));
    const optNames = Object.values(r.data?.options ?? {}).map((o) => `${o.name}=${o.value}`);
    console.log(`[infos] ${t.tableId} options: ${optNames.join(' | ') || '(无)'}`);
    n++;
  }
  saveState(st);
}

interface LogsResp {
  status: number | string;
  error?: string;
  data?: { logs?: unknown[]; players?: unknown };
}

async function phaseLogs(args: Args, st: State): Promise<void> {
  mkdirSync(join(CACHE, 'logs'), { recursive: true });
  if (st.logLimitDate === today()) {
    console.log('[logs] 今日已触发过日志限额，跳过（明日自动恢复）');
    return;
  }
  if (st.logCountDate !== today()) {
    st.logCountDate = today();
    st.logCount = 0;
  }
  // 优先级：人数 4 > 2 > 3 > 其他，同级按结束时间倒序。LF 判定需要 infos——
  // 全量 infos 不现实（十万级桌），做法：分批处理（每批 200 桌）——批内懒拉
  // infos（每桌一次）、按 LF 最优先重排后逐桌拉日志，批完再取下一批，
  // 直到 logsMax / BGA 硬限额 / 候选耗尽。
  type Rec = { tableId: string; playerCount: number; end: number; arena?: boolean };
  const tables = readFileSync(join(CACHE, 'tables.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Rec);
  const infoOf = (id: string): TableInfoResp | null => {
    try {
      return JSON.parse(readFileSync(join(CACHE, 'infos', `${id}.json`), 'utf8')) as TableInfoResp;
    } catch {
      return null;
    }
  };
  const isLf = (id: string): boolean =>
    Object.values(infoOf(id)?.data?.options ?? {}).some(
      (o) => /lost fleet|舰队/i.test(o.name) && o.value !== '0' && !/^off$/i.test(o.value),
    );
  // 锦标赛（th_name）/ Arena（arena_after_game 非空）桌——用户：锦标赛数据最好。
  const tourneyKind = (id: string): 'th' | 'arena' | null => {
    const ps = infoOf(id)?.data?.result?.player ?? [];
    if (ps.some((p) => (p as { th_name?: string | null }).th_name != null)) return 'th';
    if (ps.some((p) => p.arena_after_game != null || p.arena_points_win != null)) return 'arena';
    return null;
  };
  const basePrio = (t: Rec): number => (t.playerCount === 4 ? -10 : t.playerCount === 2 ? -5 : t.playerCount === 3 ? -2 : 0) - t.end / 1e10;
  const prio = (t: Rec): number => {
    const tk = tourneyKind(t.tableId);
    return (tk === 'th' ? -400 : tk === 'arena' ? -300 : 0) + (isLf(t.tableId) ? -100 : 0) + basePrio(t);
  };
  const BATCH = 200;
  // 复盘保留期实测 ~13 个月（2025-08 起有效、2025-07 全灭）——更早的桌直接跳过，
  // 别浪费预热/拉取请求（曾 87% 请求打在死桌上）。
  const REPLAY_CUTOFF = Math.floor(Date.now() / 1000) - 400 * 86400;
  let stop = false;
  while (st.logCount < args.logsMax && !stop) {
    // 批选择：tables.jsonl 里已带 arena 标签的桌直接浮上来（无需 infos）；
    // 锦标赛（th_name）只有 infos 可判，靠批内重排上浮。
    const pool = tables
      .filter((t) => t.end >= REPLAY_CUTOFF && !existsSync(join(CACHE, 'logs', `${t.tableId}.json`)))
      .sort((a, b) => (a.arena === true ? -300 : 0) + basePrio(a) - ((b.arena === true ? -300 : 0) + basePrio(b)))
      .slice(0, BATCH);
    if (pool.length === 0) {
      console.log('[logs] 候选耗尽');
      break;
    }
    // 批内懒拉 infos（LF 判定 + 供 export 的 ELO）
    for (const t of pool) {
      const f = join(CACHE, 'infos', `${t.tableId}.json`);
      if (existsSync(f)) continue;
      const r = await callJson<TableInfoResp>(
        `https://boardgamearena.com/table/table/tableinfos.html?id=${t.tableId}`,
        args.delay,
      );
      if (r !== null) writeFileSync(f, JSON.stringify(r));
    }
    const pending = pool.sort((a, b) => prio(a) - prio(b));
    console.log(`[logs] 本批 ${pending.length} 桌（今日已拉 ${st.logCount}/${args.logsMax}）`);
    for (const t of pending) {
      if (st.logCount >= args.logsMax) {
        console.log(`[logs] 达今日自设上限 ${args.logsMax}，停`);
        stop = true;
        break;
      }
      // 预热 archive（必须，否则 logs 不返回）；archive 生成是异步的（官方页面
      // 每 5s 轮询）——拉不到就 12s/25s 再试两轮，仍不行才标死（曾把生成中的
      // 新桌大批误判为 dead：2026-09 单月 221 假死）。
      await call(
        `https://boardgamearena.com/gamereview/gamereview/requestTableArchive.html?table=${t.tableId}`,
        args.delay,
        { xhr: true },
      );
      let r: LogsResp | null = null;
      for (const waitMs of [0, 12_000, 25_000]) {
        if (waitMs > 0) {
          console.log(`[logs] ${t.tableId} archive 生成中，${waitMs / 1000}s 后重试…`);
          await sleep(waitMs);
        }
        r = await callJson<LogsResp>(
          `https://boardgamearena.com/archive/archive/logs.html?table=${t.tableId}&translated=true`,
          args.delay,
        );
        if (r !== null && (r.data?.logs !== undefined || (typeof r.error === 'string' && /reached a limit/i.test(r.error)))) break;
      }
      if (r === null) continue;
      if (typeof r.error === 'string' && /reached a limit/i.test(r.error)) {
        st.logLimitDate = today();
        saveState(st);
        console.log('[logs] 触发 BGA 每日复盘限额，今日日志段停止');
        stop = true;
        break;
      }
      if (r.data?.logs === undefined) {
        // 轮询两轮仍无：真死（replay deleted/empty archive）——写死标记避免重试
        writeFileSync(join(CACHE, 'logs', `${t.tableId}.json`), JSON.stringify({ dead: true, error: r.error ?? 'unknown' }));
        continue;
      }
      writeFileSync(join(CACHE, 'logs', `${t.tableId}.json`), JSON.stringify(r));
      st.logCount++;
      saveState(st);
      console.log(`[logs] ${t.tableId}（${t.playerCount}p）packets=${r.data.logs.length} 今日 ${st.logCount}/${args.logsMax}`);
    }
  }
}

function phaseStatus(): void {
  const cnt = (f: string): number => (existsSync(f) ? readdirSync(f).length : 0);
  const tables = existsSync(join(CACHE, 'tables.jsonl'))
    ? readFileSync(join(CACHE, 'tables.jsonl'), 'utf8').split('\n').filter((l) => l.trim() !== '').length
    : 0;
  const players = existsSync(join(CACHE, 'players.json'))
    ? (JSON.parse(readFileSync(join(CACHE, 'players.json'), 'utf8')) as string[]).length
    : 0;
  console.log(`玩家 ${players} | 桌摘要 ${tables} | infos ${cnt(join(CACHE, 'infos'))} | logs ${cnt(join(CACHE, 'logs'))}`);
}

/**
 * 蒸馏导出 → data/bga/tables.jsonl（git 跟踪）。字段刻意紧凑：
 * id=桌号 d=结束日 pc=人数 lf=是否舰队扩（infos 判定时） p=[名字,分数,ELO后]×N
 * ne=false 表示非正常结束（弃局/超时）。ar=Arena 竞技桌，th=锦标赛桌。
 * ELO 来自 tableinfos 的 rank_after_game。
 */
function phaseExport(): void {
  mkdirSync(EXPORT_DIR, { recursive: true });
  const infosDir = join(CACHE, 'infos');
  const infoOf = (id: string): TableInfoResp | null => {
    const f = join(infosDir, `${id}.json`);
    if (!existsSync(f)) return null;
    try {
      return JSON.parse(readFileSync(f, 'utf8')) as TableInfoResp;
    } catch {
      return null;
    }
  };
  interface Rec {
    tableId: string;
    playerNames: string[];
    scores: number[];
    playerCount: number;
    end: number;
    normalend: boolean;
    arena?: boolean;
  }
  const lines = readFileSync(join(CACHE, 'tables.jsonl'), 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Rec)
    .sort((a, b) => a.end - b.end)
    .map((t) => {
      const info = infoOf(t.tableId);
      const opts = Object.values(info?.data?.options ?? {});
      const lf = opts.some((o) => /lost fleet|舰队/i.test(o.name) && o.value !== '0' && !/^off$/i.test(o.value));
      const ps = info?.data?.result?.player ?? [];
      const elos = ps.map((p) => Number(p.rank_after_game));
      const arena = t.arena === true || ps.some((p) => p.arena_after_game != null || p.arena_points_win != null);
      const th = ps.some((p) => p.th_name != null);
      const rec: Record<string, unknown> = {
        id: t.tableId,
        d: new Date(t.end * 1000).toISOString().slice(0, 10),
        pc: t.playerCount,
        p: t.playerNames.map((n, i) => [n, t.scores[i] ?? 0, elos[i] ?? 0]),
      };
      if (lf) rec.lf = 1;
      if (arena) rec.ar = 1;
      if (th) rec.th = 1;
      if (!t.normalend) rec.ne = 0;
      return JSON.stringify(rec);
    });
  writeFileSync(join(EXPORT_DIR, 'tables.jsonl'), lines.join('\n') + '\n');
  console.log(`[export] ${lines.length} 桌 → ${join(EXPORT_DIR, 'tables.jsonl')}`);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();
  mkdirSync(CACHE, { recursive: true });
  COOKIES = loadCookies();
  const st = loadState();
  if (args.phase === 'status') {
    phaseStatus();
    return;
  }
  if (args.phase === 'export') {
    phaseExport();
    return;
  }
  if (args.phase === 'all' || args.phase === 'ranking') await phaseRanking(args, st);
  if (args.phase === 'all' || args.phase === 'games') await phaseGames(args, st);
  if (args.phase === 'all' || args.phase === 'infos') await phaseInfos(args, st, { limit: 30 });
  if (args.phase === 'all' || args.phase === 'logs') await phaseLogs(args, st);
  if (args.phase === 'all') phaseExport();
  phaseStatus();
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
