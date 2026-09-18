# Gaia Project（盖亚计划）

桌游 **Gaia Project**（含官方扩展 **The Lost Fleet / 失落舰队**）的本地化、可自托管
数字实现：浏览器内与朋友（局域网/互联网）及对 AI 对战。项目结构与实现方式参照
`../BrassBirmingham`。

**Status: M3（AI 接入）完成。** M1 引擎、M1.5 Lost Fleet 扩展、M2 在线对局、
M3 启发式 + LLM 决策链与 bench 评估场均已完成，全仓测试绿。

## Quick start (dev)

```bash
npm install

# 首次或素材缺失时：从公开来源重建游戏素材（版权属出版方，个人非商用，
# 见 packages/web/public/assets/README.md；素材不进 git）
npm run fetch-assets -w @gaia/web

# terminal 1: game server (ws on :8430, SQLite at ./gaia.db)
npm run dev -w @gaia/server

# terminal 2: web client (vite on :5175, /ws proxied to :8430)
npm run dev -w @gaia/web
# → open http://localhost:5175 in two browser windows to play
```

Checks:

```bash
npm run typecheck   # all workspaces
npm test            # all workspaces (vitest + coverage)
```

Server env vars: `PORT` (default 8430), `DB_PATH` (default `./gaia.db`),
`WEB_DIST` (static root; unset in dev — vite serves the client),
`ANTHROPIC_API_KEY` (enables LLM-driven AI seats; without it AI seats fall back
to the built-in plugin `GAIA_AI_SPEC`, default `builtin:heuristic`, and no API
calls are made), `GAIA_AI_MODEL` (override the per-difficulty default model),
`GAIA_AI_PACE_MS` (delay between AI moves, default 300). See `.env.example`.

## M3: AI（`packages/llm`）

AI 座位由一条决策链驱动：局势摘要 → 启发式预筛 TopK → LLM 选择（Claude
tool use 强制 `choice_index`，候选全部来自引擎枚举的合法行动）→ 越界重试一次
→ 启发式 Top-1 兜底（`degraded=true`，对局永不卡死）。三档难度：**easy**
（claude-haiku-4-5，top-8）、**normal**（claude-sonnet-4-5，top-20）、**hard**
（claude-sonnet-4-5，top-40 + 剩余轮数/后续计分板前瞻段）。

- **启发式内核**（`heuristic.ts`）：`scoreAction` 纯函数快评，统一折算 VP 等值
  （vp=1、矿/信用=1、知识=2、QIC=3、power token=1.5、充能 1pw=0.5），叠加盖亚
  棋理：收入 NPV（随剩余轮数衰减）、回合计分板匹配、对手充能邀约惩罚、联邦
  潜力、terraform 折扣/射程/研究轨里程碑、助推器「新−旧」差值与 pass 节奏
  惩罚等。`prescreen` 供 LLM 预筛，`HeuristicAgent`（Top-1、确定性 tie-break）
  是降级兜底与 bench 基线，同时注册为内置插件 `builtin:heuristic`（DEFAULT_SPEC）。
- **成本说明**：设置 `ANTHROPIC_API_KEY` 后每次 AI 决策约 **$0.005–0.01**
  （按用量计费），一局含 AI 座位的对局约 **$0.3–0.8**（视人数与局长）；
  未设置时 AI 纯本地启发式运行，零成本。
- **插件体系**：一个 AI = `packages/llm/src/agents/` 下一个单文件插件
  （`AgentPlugin` 契约），在 `registry.ts` 的 `BUILTIN_PLUGINS` 登记一行即注册；
  内置 `heuristic` / `random` / `first-legal`，`GAIA_AI_SPEC=builtin:<name>` 选择。

### bench 评估场

手动跑批（烧 token，不进 CI；输出到已 gitignore 的 `bench/out/`）：

```bash
npm run bench -w @gaia/llm -- --agents heuristic,random --games 10 --mirror --concurrency 4
# LLM 座位（需 ANTHROPIC_API_KEY）：
npm run bench -w @gaia/llm -- --agents llm:normal,heuristic --games 10 --mirror
```

`--agents` 逗号分隔座位（插件名或 `llm:easy|normal|hard`，人数 = 项数）；
`--mirror` 每个种子换边再跑一局消除座位/种族偏差；汇总各标签胜率（平局各记
0.5）、平均 VP、平均 VP 差、degraded 率与 token 用量，明细落盘
`decisions.jsonl` / `games.jsonl`（每步含 chosenRank——所选在启发式降序中的
名次，失败分析锚点）。

## Packages

- `packages/engine` — 零依赖纯 TS 规则引擎。公共 API（只许从包根 `@gaia/engine`
  导入）：`newGame(config)`、`enumerateActions(state, player)`、
  `applyAction(state, action, opts?)`、`stableStringify`、`IllegalActionError`、
  `RandomAgent` / `playGame` 自对弈驱动。纯函数 + 种子确定性：任何行动日志重放到
  逐字节一致的终态。
- `packages/protocol` — 客户端/服务器消息类型（带版本号）+ 隐藏信息过滤。
- `packages/server` — 权威 WebSocket 服务器：房间码大厅、token 座位、断线重连、
  SQLite 持久化（行动日志可重放）。
- `packages/web` — React + Vite 客户端，SVG 棋盘。
- `packages/llm` — AI 层：单文件插件契约（`AgentPlugin`）+ 注册表 + 启发式/LLM
  决策链 + bench 自对弈评估场。

## Milestones

- **M1: 基础游戏规则引擎** — 地图拼接（1–4 人布局）、18 行动类型（建矿/盖亚计划/
  升级/联邦/研究/power·qic·特殊行动/pass/免费转换/烧脑/被动充能）、6 条研究轨、
  科技板（9 标准 + 15 高级）、联邦标记、回合计分/终局计分/回合助推器、14 个基础
  种族能力、终局计分。fuzz + replay + 数据锚点测试。
- **M1.5: The Lost Fleet 扩展** — 4 艘舰队飞船与探索行动、asteroid/protoplanet、
  深空扇区与 Interspace 板块、4 个新种族、新科技板/联邦标记/计分板/助推器、
  Artifacts、Tinkering tiles、Power Rings。
- **M2: 在线对局** — protocol + server（房间/重连/SQLite）+ web（大厅/对局画面/
  SVG 棋盘）。
- **M3: AI 接入** — `AgentPlugin` 插件契约与注册表、启发式评分内核
  （scoreAction/prescreen/HeuristicAgent）、LLM 决策链（候选预筛 → Claude
  tool use 强制选择 → 越界重试 → 启发式兜底，对局永不卡死）、bench 评估场
  （种子集 × 镜像换边 × 局间并行，胜率/均分/degraded 率/token 汇总）。
  详见上方「M3: AI」章节。

## 规则数据来源

- 官方规则书（基础 + Lost Fleet）PDF 文本：`reference/*.txt`（本地，不入库）。
- 数据交叉验证：MIT 许可的开源引擎 `reference/gaia-engine/`（gaia-project.io
  官方线上引擎，仅基础游戏；本地，不入库）。本项目引擎为独立重写，仅转录其规则
  常量数据（地图布局/板块池/种族板/价格表）。
- 规则要点摘要：`docs/rules-summary.md`；架构与行动模型设计：`docs/design.md`。

## 致谢（Acknowledgments）

本项目在结构、规则数据与 UI 参考上受益于以下开源项目，特此致谢：

- **[BrassBirmingham](../BrassBirmingham)**（本机姐妹项目）——整体 monorepo
  结构、引擎三件套 API（`newGame`/`enumerateActions`/`applyAction`）、权威
  WebSocket 服务器分层（房间/会话/传输）、AI 单文件插件契约与 LLM 决策链、
  bench 评估场，均按它的设计同构实现。
- **[boardgamers/gaia-project](https://github.com/boardgamers/gaia-project)**
  （MIT）——gaia-project.io 官方线上引擎与 viewer。规则常量数据（扇区 hex
  布局、板块池、种族板、价格表、Lost Fleet 实现）转录自它；并以其引擎作为
  差分对拍的裁判实现（50 局对局回放逐步比对，零分歧）。
- **[Etchelon/gaiaproject](https://github.com/Etchelon/gaiaproject)** ——实体
  组件美术素材的主要来源（扇区整版、研究板、各类板块、族面板、标记图标），
  以及其前端布局思路的参照。

## Legal note

非官方、个人非商用 fan 项目。游戏机制不受版权保护；"Gaia Project" 是其出版方
商标，本项目与其无任何隶属或背书关系。规则书 PDF 与第三方源码仅存于本地
`reference/`（已 gitignore），不随仓库分发。

## License

MIT (code only, see the legal note above)
