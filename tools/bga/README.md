# BGA 盖亚计划对局拉取（工具与经验记录）

`bga-pull.ts`：从 Board Game Arena 批量拉取盖亚计划（game_id=**1495**）历史对局，
断点续拉、限流友好。蒸馏产物提交在 `data/bga/`；原始响应缓存（大）在 gitignored 的
`reference/bga-cache/`。

```bash
npx vite-node tools/bga/bga-pull.ts --players 500 --delay 6000 --phase all
npx vite-node tools/bga/bga-pull.ts --phase status   # 缓存统计
npx vite-node tools/bga/bga-pull.ts --phase export   # 只重新导出 data/bga/tables.jsonl
```

## 凭据纪律（不可破坏）

- 需要登录态 cookie：文件 `~/Projects/credentials/bga-cookies.txt`（一行 cookie 串，
  从浏览器 F12 复制 `Cookie:` 头里 `PHPSESSID` + `TournoiEnLigne*` 等即可）。
- **cookie 绝不进对话/记忆/git 仓库**——脚本只按路径读，日志永不打印；cookie 会过期，
  失效后换新一行即可（建议拉完大批次后改密码让旧 cookie 失效）。
- `requestToken`：XHR 必须的 `X-Request-Token`，与 cookie `TournoiEnLigneidt` 同值，
  也可从任一已登录页面 HTML 的 `requestToken: '...'` 抓到（每次页面加载轮换，脚本每次
  运行自动重抓）。

## 端点与结构体（2026-09 实测 + 社区项目佐证）

所有 XHR 都要带 cookie + `X-Request-Token` + `X-Requested-With: XMLHttpRequest`；
不带会话返回 `{"status":"0","error":"Invalid session information...","code":806}`。

### 1) 排行榜 → 种子玩家

```
GET /gamepanel/gamepanel/getRanking.html?game=1495&mode=elo&start=0,10,20,…
→ {"status":1,"data":{"ranks":[{"id","name","country","rank_no",…}, …10 人/页]}}
```
翻页到空为止。盖亚头部玩家绝大多数打 2 人局（实测 top4 玩家 1458×2p vs 20×4p），
4 人局要靠中后段排名玩家覆盖。

### 2) 玩家历史 → 桌号（桌号枚举的唯一已证实路径）

```
GET /gamestats/gamestats/getGames.html?player=<pid>&game_id=1495&finished=1&updateStats=0&page=N
→ {"status":1,"data":{"tables":[{"table_id","players"(逗号id),"player_names","scores",
   "start","end","normalend",…}]}}
```
- **`player` 是必填**（不带 player 按游戏枚举：实测 400 `Failed to get mandatory
  argument: player`）。全站枚举只能 排行榜→逐个玩家历史。
- 翻页：`page` 递增直到空或不足一页（10/页）。顶部玩家每人 300-600 桌。
- `normalend`："1"=正常结束（否则弃局/超时）。

### 3) 桌元数据（人数/选项/ELO/结束原因）

```
GET /table/table/tableinfos.html?id=<table_id>
→ {"status":1,"data":{"result":{"player":[{"player_id","name","score","gamerank",
   "rank_after_game","point_win",…}], "endgame_reason","time_duration",…},
   "options":{<opt_id>:{"name","value","values"},…}, "game_name",…}}
```
- **LF（Lost Fleet）判定在 `options`**：`name` 含扩展名、`value` 为开关/选面。
- `rank_after_game` = 赛后 ELO（蒸馏记录的第 3 列）。

### 4) 全量行动日志（复盘数据）

两步（预热必须，否则 logs 可能不返回）：

```
GET /gamereview/gamereview/requestTableArchive.html?table=<id>   # 触发 archive 生成
GET /archive/archive/logs.html?table=<id>&translated=true
→ {"status":1,"data":{"logs":[packet…],"players":{…}}}
```

packet 结构：

```json
{ "channel", "table_id", "packet_id", "packet_type", "move_id", "time",
  "data": [ { "uid", "type": "<游戏事件名>",
              "log": "人读模板串（含 ${var} 占位，部分字段内嵌 HTML 图标）",
              "args": { "player_id", 坐标/花费等结构化字段 }, "h"? } ] }
```

已知错误串（`{"status":"0","error":…}`）：
- `"reached a limit"` — **每日复盘配额**（官方论坛 Tisaac 确认；2021 年有用户 ~80 局/日
  触发）。脚本检测到即停当日日志段（state.logLimitDate），次日自动恢复。
- `"empty archive file"` / `"doesn't exist"` / `"Cannot find gamenots"` — 复盘已删，
  写死标记不重试。
- `"Sorry, you need to be registered"` — 新账号限制。

如需**初始局面**（gamedatas），走完整复盘 HTML 路径：
`gamereview?table=<id>` → 从 HTML 提取版本号 `/archive/replay/(\d{6}-\d{4})/` →
`GET /archive/replay/<version>/?table=<id>&player=<pid>`，内嵌 `g_gamelogs` +
`gameui.completesetup`（日志接口没有初始状态）。

## 限流纪律（用户明确要求"别拉得太快"）

- 单线程顺序请求；默认间隔 6s（±20% 抖动），日志段 ≥8s；429/5xx 退避 30s→60s→放弃该条。
- 社区参考值：getGames 1s（"safe endpoint"）、其他 5s——我们全面取更慢档。
- 日志每日自设上限 `--logs-max 90`（对齐 BGA 每日复盘配额量级），硬限额错误即停。
- 已知社区项目（限流/结构佐证）：liamdj/bga-replay-parser、HStrand/bga-tm-scraper、
  kamaradclimber/bga_to_bgg、oliverosz/bga-export-stats。

## 与本项目的数据衔接

- 蒸馏 `data/bga/tables.jsonl`：`{"id","d","pc","p":[[名字,分数,ELO]…],"lf"?,"ne"?}`。
- BGA 日志是 UI 级事件流（盖亚插件自定义 type + args），与本项目引擎的 Action 空间
  **不同构**——做统计级分析（终分/联邦数/开局偏好/ELO 分布），不做逐行动对拍。
  转化到引擎可重放的行动序列需要写 args→Action 的映射层（工作量中等，暂不做）。
