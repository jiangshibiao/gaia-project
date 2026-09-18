# AGENTS.md — 盖亚计划数字实现（agent 工作指南）

本文件是给后续 agent 的项目上下文与经验沉淀。修改本文件所述的任何约定时，请同步更新它。

## 项目概览

桌游 **Gaia Project（盖亚计划）+ The Lost Fleet（失落舰队扩展）** 的本地化数字实现。
参照 `../BrassBirmingham` 的 monorepo 结构：

- `packages/engine`（`@gaia/engine`）：零依赖纯 TS 规则引擎。
- `packages/protocol`（`@gaia/protocol`）：ws 消息类型（带版本号）+ `actorOf` + `filterStateFor`（仅剥 `rngState`，盖亚无隐藏信息）。
- `packages/server`（`@gaia/server`）：权威 WebSocket 服务器（房间码/token/重连/SQLite 重放恢复）。
- `packages/web`（`@gaia/web`）：React + Vite 客户端，SVG 棋盘，原版美术素材。
- `packages/llm`（`@gaia/llm`）：AI 层——AgentPlugin 插件契约 + registry + 启发式 + LLM 决策链 + bench。

常用命令：

```bash
npm install
npm run dev -w @gaia/server   # ws :8430, SQLite packages/server/gaia.db
npm run dev -w @gaia/web      # vite :5175（局域网加 -- --host 0.0.0.0）
npm run typecheck && npm test # 全仓（目前 541+ 全绿）
npm run bench -w @gaia/llm -- --agents heuristic,random --games 20 --mirror --concurrency 4
```

## 关键工程约定（不可破坏）

- **源码即产物**：各包 `exports: { ".": "./src/index.ts" }`，无构建步骤；vite-node/vitest/vite 直接吃 TS。NodeNext 下相对导入**必须写 `.js` 后缀**。消费方只许从包根导入（engine 有 public-api 测试守护）。
- **不要让裸 `tsc` 的 `.js` 产物进 `packages/*/src`**（已被 gitignore；陈旧 .js 会让 vitest 优先加载它们导致解析失败）。
- **引擎纯函数 + 种子确定性**：`newGame(config)` 同 config 逐字节一致；`applyAction` 克隆后原地改；随机一律 `createRng(seed)`（mulberry32），引擎内禁止 `Date.now`/`Math.random`；`stableStringify` 做重放与合法性校验（行动 = 枚举集成员比对）。
- **行动模型**：原子行动 + pending 队列。主行动消耗回合；免费行动不消耗；pending（charge 队首/其他 kind 的 .player）> setupQueue[0] > currentPlayerIdx（`actorOf` 统一裁决，server/web 共用）。
- **回合顺序**：下轮行动顺序 = 本轮 pass 顺序（不是固定桌序；被动充能/leech 仍按桌序）。
- **严格 TS**：strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes。改 types.ts 只追加不改语义。

## 规则数据来源与准确性

- 官方规则书文本：`reference/gaia-base-rules.txt`、`reference/lost-fleet-rules.txt`（本地，gitignored）。
- 精确数据交叉验证（MIT 许可）：`reference/gaia-engine`（gaia-project.io 官方引擎源码，基础游戏）与 `reference/gaia-project`（同系，含 Lost Fleet 实现）。
- LF 文字层缺失的组件数据（深空 16 面、Interspace 构成、新族面板、13 神器、6 Tinkering tiles、飞船行动格分配、金框联邦标记、eco 覆盖板双面）由调研 + BGG/uiqoo/Feuerland 图像实证补全，集中在 `packages/engine/src/data/lostfleet.ts`（改数据只动它）。

## 差分对拍（规则正确性的核心保障）

`reference/harness/`（gitignored 本地工具）：

- 原理：参考引擎（`reference/gaia-project/engine`，vite-node 驱动）与我们的引擎从**完全相同的局面**（`GameConfig.preset` 指定地图摆放 + 全部板块抽取）出发，逐步执行等价行动，归一化比对状态。
- `run-diff.ts <fixture>`：主程序（`--max-steps N --continue-on-diff`）。`gen-fixture.ts`：随机对局生成。`hunt-scenario.ts`/`hunt-advtech.ts`：定向狩猎缺口机制。`NOTES.md`：合理差异（玩家选择类：power 来源区/脑石归位/部分充能，用 assumeLegal 覆盖并记 NOTE）。
- 现状：**50 局零分歧**（基础/LF/随机/定向/高级板专项），12 类已知缺口全闭合。修 bug 必配 `packages/engine/test/` 回归测试。
- 注意 ts-node 驱动参考引擎不可用（v5 太旧静默不执行）；一律用仓库根 `npx vite-node`。

## 素材与校准（web 美术）

- 素材在 `packages/web/public/assets/`（个人非商用，随仓库分发；`assets/raw/` gitignored）。
- **坐标校准一律写数据文件并配测试**：`sector-calibration.ts`（13 扇区统一 325/352.5/81.25，k0=4）、`ship-calibration.ts`（4 船）、`faction-calibration.ts`（族板模板+override）、`research-calibration.ts`（研究板）、`placements.ts`（运行时反推扇区摆放——GameState 不存 placement，按"2 格范围全覆盖 19 格的唯一格"定中心、按布局匹配定旋转；深空三角按内容多重集定面、带镜像旋转匹配定朝向）。
- 图像处理脚本（裁透明边距/细白边/透视校正）在 `reference/harness/` 与 `.venv`（Pillow/PyMuPDF）。
- LF 青/粉两色建筑无图：用红/蓝图 + CSS hue-rotate 近似。

## 踩过的坑（勿再犯）

- **静默拒绝**：服务器错误消息（not-your-turn/illegal-action）曾只写 `lastError` 不上屏，用户以为"点了没反应"。任何拒绝路径必须有可见反馈（error-toast）。
- **下轮顺序**：曾按固定桌序推进回合，对拍发现应为 pass 顺序。
- **setup 跳过**：ivits（无起始矿）、LF 新族（extra 阶段才放）、xenos（第 3 矿）的队列推进靠 `settleSetupSkips` 容忍空枚举，不要假设每阶段人人有行动。
- **科技板位置**：拿板可升哪条轨由开局洗入的 9 个位置决定（`board.techTilePositions`），不是固定的。
- **参考引擎的 quirk 要对齐而非"修正"**：leech 空碗不邀约、fed1 无绿面、setup 放置不产生邀约、ship-credit 建矿逐项扣费（不收 gaia 费/不得 proto 分/排除 asteroid）。
- **AI 驱动永不卡死**：driveAI 全 try/catch + legal[0] 兜底；agent.decide 对任何合法行动集必须返回合法行动（safeScore）。
- **截图验证**：chrome headless（`--headless --screenshot --window-size --force-device-scale-factor=2`）+ preview.html（不进生产 bundle）是 UI 验收主路径。

## 待办/已知缺口

- 启发式 AI 强度有限（v1，bench 对 random ~80%）；LLM 决策链已实现但需 ANTHROPIC_API_KEY 才启用。
- Solo Automa 未实现（项目不做单人）。
- Moweyds 族板无高清图（用小图回退）；Twilight 船板图来自 BGG 开箱照（非官方渲染）。
- Tinkering tiles 只有合影图（未裁单块，面板用文字标签）。
