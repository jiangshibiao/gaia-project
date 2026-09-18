# 架构设计（参照 ../BrassBirmingham）

## 总体

npm workspaces monorepo，5 包：`@gaia/engine`（零依赖规则引擎）、
`@gaia/protocol`、`@gaia/server`、`@gaia/web`、`@gaia/llm`。

- 全程 ESM + 严格 TS（`tsconfig.base.json`：strict / NodeNext /
  noUncheckedIndexedAccess / exactOptionalPropertyTypes）。
- 库包 `exports: { ".": "./src/index.ts" }` —— 源码即产物，无构建步骤；
  vitest / vite-node / vite 全链路直接吃 TS。NodeNext 下相对导入一律写 `.js` 后缀。
- 消费方只许从包根导入，不许 deep import（engine 有 public-api 测试守护）。
- 引擎内禁止 `Date.now` / `Math.random`；随机一律走 `createRng(seed)`（mulberry32）。

## 引擎核心约定（与 Brass 同构）

- `newGame(config: GameConfig): GameState` — 纯函数，同 config+seed 逐字节一致。
  `GameConfig = { playerCount, seed, factions: FactionId[], options?: { lostFleet?: boolean, mapSeed?... } }`。
- `enumerateActions(state, player): Action[]` — 当前局面下该玩家的全部合法行动
  （完全指定、可直接 apply）。
- `applyAction(state, action, opts?): GameState` — 纯函数返回新状态（结构共享）。
  合法性校验 = 规范化后与枚举输出做 `stableStringify` 比对，不在集内抛
  `IllegalActionError`；`opts.assumeLegal` 供高频路径（自对弈/MCTS）跳过。
- `stableStringify` — 递归排序 key 的 JSON，用于重放校验。
- `RandomAgent` / `playGame(config, agents?)` — 自对弈驱动，行动日志可重放。
- 状态全部为 plain JSON 接口（无 class、无方法），`rngState` 也在状态里。

## 行动模型（与 Brass 的差异点）

Gaia 的行动粒度比 Brass 细，采用**原子行动 + 待决决策队列**：

- `Action` 为可辨识联合（`type` 字段）。分三类：
  1. **主行动**（消耗本回合）：build-mine / start-gaia-project / upgrade /
     form-federation / research / power-action / qic-action / special-action /
     explore-ship / inspect-artifact / pass。子选择折进 payload（升级带科技板选择、
     pass 带新助推器选择、组联邦带联邦标记选择 + 卫星坐标列表）。
  2. **免费行动**（不消耗回合，任意时刻可插入）：free-conversion（含各种族
     特殊兑换）、burn、以及各族的免费能力（Bal T'aks Gaiaformer↔q、Nevlas
     pw→k、Hadsch Hallas 信用兑换等）。
  3. **响应/设置行动**：setup 阶段放起始矿（place-initial-mine，含 Xenos 第 3 矿、
     Ivits 放 PI、新种族第二阶段放置）；**被动充能响应**（charge / decline-charge）。
- **pendingCharge**：主行动产生被动充能时压入队列（顺时针、逐玩家），
  该玩家必须用 charge/decline-charge 响应后才轮到下一家行动。已 Pass 者也响应。
- 回合推进：主行动 apply 后若 pendingCharge 空则 currentPlayer 顺移（跳过已
  Pass）；全员 Pass 后进整理阶段（还助推器已由 pass 行动处理、盖亚转化、
  新回合收入、回合计分板轮换、飞船行动格复位）。

## 状态主干（GameState）

```
config, seed, rngState, round(1..6), phase('setup'|'action'|'game-over'),
subPhase（当前在 收入/盖亚/行动/整理 哪一段；行动阶段外多为自动结算）,
turnOrder, currentPlayerIdx, passedPlayers, firstPlayerNextRound,
map: { hexes: Record<hexKey, HexState>, sectors per hex, ships },
players: PlayerState[],  // 见下
board: { roundScoring[6], finalScoring[2], techTiles (std 供应 + adv 6(+1) 槽),
         federationTokens 供应 + terraforming L5 预设枚, boosters 供应,
         powerActions/qicActions/shipActions 本轮已用标记 },
pendingCharge: ChargeOffer[] | null,
pendingGaiaFormers（转化中的盖亚计划）,
log/lastEvents, winner
```

PlayerState：`faction, color, resources{ore,credits,knowledge,qic},
power{bowl1,bowl2,bowl3,gaia, brainstone?}, research[6], techTiles(含 covered),
federationTokens(绿/灰), buildings 面板剩余（=收入轨已揭开程度）, gaiaformers
{available, onMap, lost}, booster, specialUsed[], vp, satellites 数, 殖民计数
(星球类型/扇区/Gaia/asteroid/deepSpace), 族属状态(tinkering/powerRings/
shuttles/artifacts/brainstonePos/lostPlanet...)`。

## 地图

- hex 用 axial 坐标（q,r），key = `${q},${r}`。
- 扇区定义转录自 `reference/gaia-engine/src/map.ts`（10 扇区 hex 布局 + 旋转）；
  深空扇区 11–16 与 Interspace 布局转录自 Lost Fleet 规则书。
- `newGame` 按人数+选项生成标准布局（种子驱动扇区洗牌/旋转）。
- 邻接/距离/范围用 axial 距离；射程路径可穿任何星球（BFS 距离即可）。

## 测试金字塔

- `test/*-data.test.ts`：常量表锚点（板块池数量、种族起始、地图 hex 计数等）。
- `test/replay.test.ts`：playGame 日志逐条重放，终态 stableStringify 相等。
- `test/fuzz.test.ts`：随机整局全局不变量（资源非负、power 守恒、winner 合法）。
- `test/public-api.test.ts`：公共 API 面守护。
- 规则审计锚点：每族关键能力至少 1 个行为测试。

## AI 接入（M3 已实现）

- `packages/llm/src/agents/contract.ts`：`AgentPlugin { meta, create(ctx) }`，
  `decide({ state, seat, legal, clockMs? }) => Action | Promise<Action>`。
- `registry.ts`：`BUILTIN_PLUGINS` 一行注册（内置 heuristic / random /
  first-legal）；spec 格式 `builtin:<name>`；DEFAULT_SPEC = `builtin:heuristic`。
- server 只依赖 `DecidingAgent.decide(state, seat, legal) => Decision`
  （`{ action, reason, degraded, usage }`），注入缝
  `GameServerOptions.aiAgentFactory`。有 `ANTHROPIC_API_KEY` 时按座位难度构造
  `LLMAgent`（`GAIA_AI_MODEL` 覆盖默认模型），否则 `GAIA_AI_SPEC` 插件。
- 启发式内核 `heuristic.ts`（+ `heuristic/values.ts` 价值尺度）：
  `scoreAction` 纯函数快评（VP 等值）、`prescreen` TopK、`HeuristicAgent`
  Top-1（确定性 tie-break）。
- 局势摘要 `summarize.ts`：`summarizeState` / `describeAction` /
  `buildDecisionPrompt` / `SYSTEM_PROMPT`；卫生不变式——昵称/日志原文永不进
  prompt（测试锚定）。
- LLM 链 `client.ts` + `llm-agent.ts`：启发式预筛 TopK → Claude tool use 强制
  `choice_index`（`tool_choice:'any'`、thinking 显式 disabled、SDK maxRetries:0、
  8s 超时/512 tokens）→ 越界重试一次 → HeuristicAgent Top-1 兜底
  （degraded=true，usage 如实累计，对局永不卡死）。难度表 easy=haiku/top8、
  normal=sonnet/top20、hard=sonnet/top40+前瞻段。
- bench 评估场 `bench/`：`run.ts` CLI（种子集 × 镜像换边 × 局间并行）+
  `drive-game.ts`（playGame 的 async 变体，每步记 chosenRank 锚点）+
  `trace.ts`（decisions/games.jsonl 落盘 bench/out/，已 gitignore）。
  真跑 LLM 是手动行为（不进测试）。

## Lost Fleet 数据的实现口径

规则书文字层缺失的 LF 数据（深空三角板 16 面、Interspace 构成、飞船行动格按船
分配、科技槽 0/1、探索轨充能 0/2/2/3、13 Artifacts、8 金框联邦标记、3 种船上
标准板、6 种新高级板、6 块 Tinkering tiles、Economy 轨 L3/L4 覆盖板、4 新族
起始面板）已按实证数据核定（多源印证 + `reference/gaia-project/engine/src/`
官方 MIT 引擎的 LF 实现交叉验证），**全部集中在
`packages/engine/src/data/lostfleet.ts`**（地图几何 + 内容数据）；决策清单与
仍存疑条目记录在 `docs/rules-summary.md` §2 "M1.6 实现口径"。仍存疑：
solo Automa 的 Interspace 构成（不做 solo）、新助推器收入配对、终局新板中立值。
