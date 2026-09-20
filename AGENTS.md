# AGENTS.md — 盖亚计划数字实现（agent 工作指南）

本文件是给后续 agent 的项目上下文与经验沉淀。修改本文件所述的任何约定时，请同步更新它。

## 项目概览

桌游 **Gaia Project（盖亚计划）+ The Lost Fleet（失落舰队扩展）** 的本地化数字实现。
参照 `../BrassBirmingham` 的 monorepo 结构：

- `packages/engine`（`@gaia/engine`）：零依赖纯 TS 规则引擎。
- `packages/protocol`（`@gaia/protocol`）：ws 消息类型（带版本号）+ `actorOf` + `filterStateFor`（仅剥 `rngState`，盖亚无隐藏信息）。
- `packages/server`（`@gaia/server`）：权威 WebSocket 服务器（房间码/token/重连/SQLite 重放恢复/AI 座位/draft 选族）。
- `packages/web`（`@gaia/web`）：React + Vite 客户端，SVG 棋盘，原版美术素材。
- `packages/llm`（`@gaia/llm`）：AI 层——AgentPlugin 插件契约 + registry + 启发式 v1/v2 + LLM 决策链 + bench。

常用命令：

```bash
npm install
npm run fetch-assets -w @gaia/web  # 素材缺失时先跑（见下「素材与版权」）
npm run dev -w @gaia/server   # ws :8430, SQLite packages/server/gaia.db
npm run dev -w @gaia/web      # vite :5175（局域网加 -- --host 0.0.0.0）
npm run typecheck && npm test # 全仓（目前 541+ 全绿）
npm run bench -w @gaia/llm -- --agents heuristic2,random --games 20 --mirror --concurrency 4
# 内战均分/随机种族池/无扩展变体见下方「AI（heuristic2）」节
# 注入一局中期对局供人工检查（打印房码/token/localStorage 一行）：
npx vite-node reference/harness/seed-midgame.ts <轮数>
```

**Git**：仓库已对接 GitHub `jiangshibiao/gaia-project`（main）。**游戏素材不进 git**
（版权属出版方，`.gitignore` 排除 `packages/web/public/assets/`，GitHub 上只有
`assets/README.md` 法律声明）；缺失时用 `npm run fetch-assets -w @gaia/web` 从
Etchelon/boardgamers viewer/uiqoo/Feuerland/BGG 等公开来源重建（约 300 文件，
自动裁边/去白边/写扇区校准）。

## 关键工程约定（不可破坏）

- **源码即产物**：各包 `exports: { ".": "./src/index.ts" }`，无构建步骤；vite-node/vitest/vite 直接吃 TS。NodeNext 下相对导入**必须写 `.js` 后缀**。消费方只许从包根导入（engine 有 public-api 测试守护）。
- **不要让裸 `tsc` 的 `.js` 产物进 `packages/*/src`**（已被 gitignore；陈旧 .js 会让 vitest 优先加载它们导致解析失败）。
- **引擎纯函数 + 种子确定性**：`newGame(config)` 同 config 逐字节一致；`applyAction` 克隆后原地改；随机一律 `createRng(seed)`（mulberry32），引擎内禁止 `Date.now`/`Math.random`；`stableStringify` 做重放与合法性校验（行动 = 枚举集成员比对）。
- **行动模型**：原子行动 + pending 队列。主行动消耗回合；免费行动不消耗；pending（charge 队首/其他 kind 的 .player）> setupQueue[0] > currentPlayerIdx（`actorOf` 统一裁决，server/web 共用）。
- **撤销（undo）**：`session.undo(seat)` 截断落库到该座位最近回合起点（`actorOf==seat && pending==null` 的最近点）并重放重建；尾段含其他**真人**座位行动则拒（AI 行动/响应可一并回退）。web 端 `store.undo()`；快照 seq 回归时 store 同步裁剪行动日志；GameScreen 回合起点检查点驱动「撤销条」（每次提交后浮出，显示本回合资源/VP 增量，[撤销回合]/[完成]）。
- **回合顺序**：下轮行动顺序 = 本轮 pass 顺序（不是固定桌序；被动充能/leech 仍按桌序）。
- **严格 TS**：strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes。改 types.ts 只追加不改语义。
- **任何服务器拒绝必须有可见反馈**（error-toast；`lastError` 曾只写不上屏，用户以为"点了没反应"）。

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

- 素材在 `packages/web/public/assets/`（个人非商用，不进 git；`assets/README.md` 是法律声明，唯一被 track 的素材文件）。
- **坐标校准一律写数据文件并配测试**：`sector-calibration.ts`（13 扇区统一 325/352.5/81.25，k0=4）、`ship-calibration.ts`（4 船）、`faction-calibration.ts`（族板模板+override）、`research-calibration.ts`（研究板，含 QIC_COVER_RECT）、`panel-calibration.ts`（种族飞船面板 3 穿梭机槽，全族同模板；顶槽印「3-4」仅 3-4 人局用）、`scoreboard-calibration.ts`（实图计分板：6 回合槽/2 终局槽/2 条计数轨/梯形片高级板槽）、`placements.ts`（运行时反推扇区摆放——GameState 不存 placement，按"2 格范围全覆盖 19 格的唯一格"定中心、按布局匹配定旋转；深空三角按内容多重集定面、带镜像旋转匹配定朝向）。
- 图像处理脚本（裁透明边距/细白边/透视校正）在 `reference/harness/` 与 `.venv`（Pillow/PyMuPDF）。**用户自拍素材**（2026-09）：`cut-faction-panels.py` 从 05/06 照片抠 18 块种族飞船面板（含正反面配对校验，输出 `factions/panels/<id>.png` 400×1240）、`cut-scoreboard-assets.py` 从 01-04 照片抠计分板/梯形扩展片×2/QIC 覆盖板（含 alpha；原照片在 ~/Downloads，不入库）。
- **四条船板图**：rebellion/eclipse 用 feuerland 官方渲染（2000×621 黑底）；twilight/tfmars 用 Steam TTS 模组（id 3347152196）内嵌官方渲染（3411×1050 黑底，`*_board_render.jpg`）——曾用 BGG 开箱照但背景灰（44-115 亮度）被用户投诉偏白，feuerland 官网确认无这两艘渲染（Wayback 佐证）。取图渠道备忘：BGG 图库可绕 Cloudflare（`api.geekdo.com/api/images?objectid=<id>&objecttype=thing&pageid=N` 列表 + `api/images/<imageid>` 单图）；Steam Workshop 文件用 `api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/` 免 key 拿 file_url。
- LF 青/粉两色建筑无图：用红/蓝图 + CSS hue-rotate 近似。**青色要 hue-rotate(-65deg) 才与兰提达纯蓝区分**（-35deg 太接近曾被误认为同族）。

## 布局（v9 定稿）

- **顶栏三段式**：左区（与左栏同宽）= 盖亚计划标识 + 第 x/6 轮 + 导出对局；中区（与星图水平对齐）= 本轮计分 + 行动按钮组（含情境按钮 + 兑换下拉）；右区（与右栏同宽）= 先手/轮到/已连接 + 离开房间。
- **左栏两块**：上 = 我的版图 + 正右方竖列【种族飞船面板（LF 实图，上）+ 当回合助推片（下，高 = 版图高 ÷ 2 = `--booster-h`）】（仅 LF 局左栏加宽 `--panel-w`；穿梭机叠加未派显示、已派留空）+ 下方科技/高级/联邦片横条（科技片与研究板同宽 `--rb-tile-w`、联邦片 34px、按获得时间混排）；下 = 对手 TAB 细条（座位色块+行动者指示点）+ 选中对手版图同款组合。2 人局无 TAB。宽屏（>1680px）按 `--ui-k` ≤1.35 放大；**版图/助推器另有全局 0.8× 系数**（底部横条横向防溢出：池随内容定宽 + 舰队 60%，两者不得超过中央宽）。
- **中央**：星图（滚轮缩放/拖拽平移/双击复位/自由旋转手柄）+ 底部横条 = 助推器池（左，片宽按图比例固定、池随内容收缩、间隙 0.3vh）+ 舰队 2×2（右，60% 宽右对齐）。
- **右栏**：研究轨道整图（自然宽高比、科技片错落堆叠；**LF 时 QIC 覆盖板盖住右下 3 绿水晶行动格**，引擎同步禁用）+ 计分区 = **实图计分板**（`ScoreboardBoard`：自拍抠图含行星装饰，6 回合片入扇形槽径向旋转、2 终局片入灰面板槽、绿轨按 count 放玩家色点、LF 下接梯形扩展片（按 `scoringExtension` 选面）+ 第 7 高级板槽）+ **常驻计分表**（计分板正下方，无展开态；板面栈按纵横比自适应高度给表让位）；右栏宽由「研究板 1.073 + 计分板 0.981（LF 再 +0.207）× 宽」反推（`--rail-r-w` 按 data-lf 分两档）。
- **复盘模式**：导入 GameRecord 后布局与对局同构（LeftRail 视角座位版图 + 对手 TAB / 星图 / 右研究计分栏）；回放控制条在**星图正上方**（⏮/◀/▶/⏭/倍速/进度条），顶栏左区 = 标题+轮次+「此处开始对局」（branch_game），右区 = 轮到+退出复盘（对齐「离开房间」）；「视角⇄」按钮在视角版图详情前轮换第一视角。

## 踩过的坑（勿再犯）

- **静默拒绝**：服务器错误消息（not-your-turn/illegal-action）曾只写 `lastError` 不上屏。任何拒绝路径必须有可见反馈。
- **下轮顺序**：曾按固定桌序推进回合，对拍发现应为 pass 顺序。
- **setup 跳过**：ivits（无起始矿）、LF 新族（extra 阶段才放）、xenos（第 3 矿）、darkanians（extra 阶段）的队列推进靠 `settleSetupSkips` 容忍空枚举。**陷阱：该归一化只在 applyAction 后跑——开局无人触发，LF 新族/ivits 在 seat 0 时开局即死锁**；`GameSession` 构造（含 restore/undo 重放）必须先 `settleSetupSkips(newGame(config))`（曾致 JYMRE3 卡死）。
- **复盘分支（branch_game）**：复盘当前步可「此处开始对局」——record 截断到当前步发 `branch_game`，服务端重放校验后开单人+AI 房间（申请者坐 review.viewSeat，其余座位 AI 托管；开放真人补位未实现）。终局面/空前缀/越界座位分别报 import-invalid/bad-message/invalid-seat。
- **科技板位置**：拿板可升哪条轨由开局洗入的 9 个位置决定（`board.techTilePositions`），不是固定的。
- **参考引擎的 quirk 要对齐而非"修正"**：leech 空碗不邀约、fed1 无绿面、setup 放置不产生邀约、ship-credit 建矿逐项扣费（不收 gaia 费/不得 proto 分/排除 asteroid）。
- **AI 驱动永不卡死**：driveAI 全 try/catch + legal[0] 兜底；agent.decide 对任何合法行动集必须返回合法行动（safeScore）。
- **初始地图偏小**：默认 21.6° 旋转用旋转矩形外接框当 viewBox，把包围框无谓放大 ~30%。改用 `rotatedPointsViewBox`（旋转后 hex 中心紧致包围盒）。
- **截图验证**：chrome headless（`--headless --screenshot --window-size --force-device-scale-factor=2`）+ preview.html（不进生产 bundle）是 UI 验收主路径。

## AI（heuristic2，v2 估价框架）

默认 AI 是 `builtin:heuristic2`（registry DEFAULT_SPEC；v1 `builtin:heuristic` 保留作
LLM 预筛/兜底与 bench 基线）。架构参照 BrassBirmingham 的 CFG + overrides 模式，
代码在 `packages/llm/src/heuristic2/`：

- `cfg.ts`：全部权重集中在 `BASE_CFG`（每个参数注明攻略/bench 来源）；**变体显式
  区分**——`LF_DELTA` 仅在 `lostFleet=true` 时深合并（扩展改变估价体系：LF 行星类型
  升值、探船升值等）。版本/调参差异 = `DeepPartial<Cfg>` overrides（`createEvalPlugin`
  的 `tuneEnvVar: GAIA_TUNE_V2` 可注入 JSON 做消融）。
- `context.ts`：`evalCtx(state, seat)` 合并链 BASE→LF_DELTA→插件 overrides→族增量，
  WeakMap 缓存（带 overrides 不缓存——调参路径）。
- `values.ts`/`score.ts`：行动快评（纯函数不仿真，VP 等值）。资源表用社区量化结论
  （BGG 2122654：ore=knowledge=3、QIC=4、power token=2、充能 0.75、credit=1）；
  分阶段权重（R1-2 经济/R3-4 转化/R5-6 VP 冲刺：收入贴现、库存贬值、leech 意愿
  R1-4>1/R6<1）；回合计分板看本轮+下轮（下轮 nextRoundMult 折预期）；第 3 联邦
  额外奖励（社区共识：3 联邦是获胜底线）。
- `position.ts`：局面叶估值（已入账 VP + 库存×阶段权重 + 总收入 NPV + 研究轨里程碑
  + 持有片折算 + 联邦重结算期望 + **终局计分零和位次期望**（finalCount 实时比位次，
  并列按引擎口径均分））。
- `lookahead.ts`：按行动域 topK 剪枝（Brass 经验 K 大反而差）→ applyAction(assumeLegal)
  仿真 → 仍我方行动则 +alpha×次动分 → +leafWeight×叶估值。仿真失败退回静态分。
- `factions.ts`：种族插件 `FactionHooks { cfg(variant), adjustAction, adjustFinal }`
  （Nevlas/Taklons 充能升值、Gleens 盖亚矿+2、Geodens PI 后新类型+6、Lantids 行星
  类型/盖亚终局归零、Ivits 终局减半+早联邦奖励、Terrans 仅 base 给盖亚溢价等）；
  `FACTION_STRENGTH` 按变体分表的 draft 强度表（LF 里 Terrans 底层、Ivits 最强），
  server draft AI 已接线（`pickFactionByStrength`）。

验证方法（指标 = **内战均分** + 对基线胜率；同代码镜像局必然完全重复，镜像只对
异构对抗有意义）：

```bash
# 内战均分（固定种族池，跨轮可比）：
npx vite-node packages/llm/bench/run.ts --agents heuristic2,heuristic2,heuristic2,heuristic2 --games 10 --concurrency 8
# 随机种族池（覆盖面）加 --factions random；base 变体加 --no-lf
# 对抗基线：
npx vite-node packages/llm/bench/run.ts --agents heuristic2,heuristic,heuristic2,heuristic --games 10 --concurrency 8
```

v2 数据（4p LF 固定池，2026-09-18 三轮调优+自我深搜后）：内战均分 ~88（v1 为 50.6）；
**每局最高分均值 114，10/10 局破百（≥100 VP）**，峰值 126；2p 最高均值 100、
5/10 破百；2v2 对抗 v1 胜率 42.5% vs 10.0%。与人类（150-200）的剩余差距：
联邦平均 ~1 个（人类 3 个——几何上孤立分量太多，9-13 卫星的全体合并形状被
深搜正确拒绝）、高级片 ~0.1 个/人（四条件难同时满足）、QIC 经济微弱。
再上一档需要区域级多步规划（从 setup 起布局 2-3 个联邦区）。

调优方法论（本仓已验证的结论，勿再走弯路）：

- **前瞻与叶估值是主力**：关前瞻 −14 分；leafWeight 1.2 是峰值（0.6/1.6/2.0 都更差）；
  alpha 0.5 优于 0.7；候选 topK 加宽更差（Brass 同结论）。
- **"富"叶估值优于去重叶估值**（−9 分）：库存/收入/里程碑与行动分口径重叠不是 bug，
  候选间比较要的是位置完整排序。leaf 还含联邦组潜力（(pv/7)² 凸形）。
- **资源量纲 2.5/2.5/4（ore/knowledge/qic）是峰值**（2/2/3 与 3/3/4.5 都更差）——
  社区交换表（3/3/4）对 AI 偏"抠"，会拒绝必要扩张。
- **联邦凑组（分量感知，score.ts ownComponents）**：贴单分量给凸形（pv≤5 峰值，
  超过贬值——分量养太大 = 一个联邦吃掉所有建筑，毁掉潜在外援联邦）；合并两个
  分量轻罚（0.5×pv）；新种子按 2 格桥接 pv 给凸形。**禁入区（已入联邦格+邻格）
  不计入新组 pv**，否则拉力被已完成的联邦吸走。初始矿无法聚拢（母星全图仅 2-3 格）。
  孤立选址惩罚与 clusterMult>1（早期加强）都被证明伤扩张，勿加。
- **联邦标记（values.ts federationTokenValue）**：绿面票按稀缺敏感计价——手里没有
  其他未翻绿面票时（首张高级片入场券）按 advTicketExpectation（接近开启槽位的最佳
  高级片×0.7×轮数折扣）显著加价，已有票只 +1.5。L5 翻面门票定价 3+0.25×资源面，
  且 L4 轨+可覆盖片在手时再 +6（别让 L5 烧掉高级片的票）。
- **第二座学院给惩罚**（6o+6c 极贵、AC2 无收入轨）；TS 给固定溢价（经济骨干+电力密度）。
- bench 工具：`diagnose.ts`（终局面貌+行动直方图+机会vs选择+VP 构成+联邦组探测）、
  `probe.ts`（指定座位逐决策 Top 候选+组 pv）；`GAIA_BENCH_FACTIONS` 可换固定池。

深搜（selfsearch.ts，自我深搜"假设不碰撞"，**当前默认开启**）：

- 只展开我的行动序列，对手占位（主阶段恒 pass——直接构造
  `{type:'pass', booster: 供应[0]}`（不能续用同款，见 engine pass.ts）免枚举；
  充能恒拒绝；setup/pending 取 legal[0]）。depth=3（我的 3 个主行动）+
  根节点 0.8×最优+0.2×次优加权（brittle plan 对冲）。
- 实测：4p 最高均值 114、10/10 破百（纯静态+2ply 时 ~95、1/3）；2p 最高均值 100。
  耗时：2p ~85s/局、4p ~270s/局（在线可接受，aiPaceMs 兜底；bench 用并发跑）。
- max^n（search.ts）弃用保留：全座位深搜成本爆炸（4p 需 5-6 ply 才到我下动，
  ~7 分钟/局）。深搜成本主要在**每节点的 enumerateActions+静态评分**，任何
  "对手也要枚举"的设计都不可行；剪枝帽随层数衰减是必须的。
- 提速方向：evaluateState 按 stableStringify 备忘、根候选帽收紧、预算按阶段自适应。

## 待办/已知缺口

- LLM 决策链已实现但需 ANTHROPIC_API_KEY 才启用（预筛仍走 v1 scoreAction）。
- Solo Automa 未实现（项目不做单人）。
- Twilight 船板图来自 BGG 开箱照（非官方渲染）。
- Tinkering tiles 只有合影图（未裁单块，面板用文字标签）。
- 推进片池（BoostersStrip）位置用户后续还要调（当前在中央底部左侧）。
