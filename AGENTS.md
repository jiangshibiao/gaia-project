# AGENTS.md — 盖亚计划数字实现（agent 工作指南）

本文件是给后续 agent 的项目上下文与经验沉淀。修改本文件所述的任何约定时，请同步更新它。

## 项目概览

桌游 **Gaia Project（盖亚计划）+ The Lost Fleet（失落舰队扩展）** 的本地化数字实现。
参照 `../BrassBirmingham` 的 monorepo 结构：

- `packages/engine`（`@gaia/engine`）：零依赖纯 TS 规则引擎。
- `packages/protocol`（`@gaia/protocol`）：ws 消息类型（带版本号）+ `actorOf` + `filterStateFor`（仅剥 `rngState`，盖亚无隐藏信息）。
- `packages/server`（`@gaia/server`）：权威 WebSocket 服务器（房间码/token/重连/SQLite 重放恢复/AI 座位/draft 选族）；快照带全量行动日志（`GameSession.actionLog` 与 actions 表同步）。
- `packages/web`（`@gaia/web`）：React + Vite 客户端，SVG 棋盘，原版美术素材。
- `packages/llm`（`@gaia/llm`）：AI 层——AgentPlugin 插件契约 + registry + 启发式 v1/v2 + LLM 决策链 + bench。

常用命令：

```bash
npm install
npm run fetch-assets -w @gaia/web  # 素材缺失时先跑（见下「素材与版权」）
npm run dev -w @gaia/server   # ws :8430, SQLite packages/server/gaia.db
npm run dev -w @gaia/web      # vite :5175（局域网加 -- --host 0.0.0.0）
# 局域网生产部署（单端口：静态 dist + /ws 同端口；独立于 agent 会话常驻）：
npm run build -w @gaia/web    # 产出 packages/web/dist（含游戏素材 ~107MB）
cd packages/server && PORT=8430 DB_PATH=./gaia.db WEB_DIST=../web/dist \
  nohup npx vite-node src/main.ts > /tmp/gaia-deploy.log 2>&1 & disown
# 访问 http://<局域网IP>:8430（代码改动需重新 build 并重启该进程）
npm run typecheck && npm test # 全仓全绿
# AI bench 见下方「AI（heuristic2）」节
# 注入一局中期对局供人工检查（打印房码/token/localStorage 一行）：
npx vite-node reference/harness/seed-midgame.ts <轮数>
```

**Git**：仓库已对接 GitHub `jiangshibiao/gaia-project`（main）。**游戏素材不进 git**
（版权属出版方，`.gitignore` 排除 `packages/web/public/assets/`，仅 `assets/README.md`
法律声明被 track）；缺失时用 `npm run fetch-assets -w @gaia/web` 从
Etchelon/boardgamers viewer/uiqoo/Feuerland/BGG 等公开来源重建（约 300 文件，
自动裁边/去白边/写扇区校准）。**没有用户明确指令不 commit/push。**

## 关键工程约定（不可破坏）

- **源码即产物**：各包 `exports: { ".": "./src/index.ts" }`，无构建步骤；vite-node/vitest/vite 直接吃 TS。NodeNext 下相对导入**必须写 `.js` 后缀**。消费方只许从包根导入（engine 有 public-api 测试守护）。裸 `tsc` 的 `.js` 产物不得进 `packages/*/src`（陈旧 .js 会让 vitest 优先加载导致解析失败）。
- **引擎纯函数 + 种子确定性**：`newGame(config)` 同 config 逐字节一致；`applyAction` 克隆后原地改；随机一律 `createRng(seed)`（mulberry32），引擎内禁止 `Date.now`/`Math.random`；`stableStringify` 做重放与合法性校验（行动 = 枚举集成员比对——**枚举与 apply 必须一致**，replay 会暴露分歧）。
- **行动模型**：原子行动 + pending 队列。主行动消耗回合；免费行动不消耗；pending（charge 队首/其他 kind 的 .player）> setupQueue[0] > currentPlayerIdx（`actorOf` 统一裁决，server/web 共用）。
- **撤销（undo）**：`session.undo(seat)` 截断落库到**该座位最近一条行动**（含其后全部行动）并重放重建——是"单行动"而非"整回合"；web 撤销条只在回合进行中可用（无 confirm-turn），故一键效果 = 撤掉整个未完成回合（主行动+后续免费行动都在尾段一并删）。尾段含其他**真人**座位非响应行动则拒（AI 行动、任意座位的 charge/decline-charge 响应可一并回退）。web 端 `store.undo()`；快照 seq 回归时 store 同步裁剪行动日志。**代客多回合回退须逐座位交替逐条 undo**（每次只删一条；跨真人回合直接调 undo 会被尾段校验拒）。
- **行动确认流**：任何行动选择完整即直接提交服务器（`GameScreen.tryDirectSubmit`，全行动类型；选择末步选完即走，无确认/取消条）。后悔一律用撤销条整回合回退。**确认拦截点只有地图下方撤销条一个**（[完成]=提交 confirm-turn 放闸）。ActionBar 只剩 pending 决策（charge/income-order/tech 选择等）与等待提示；turnhold-banner 与 confirm-bar 均已删除。**直点交互**：地图飞船直点=探索该船（`onMapShipClick`，普通候选优先于射程加成特殊行动）；选择流中地图点船=回答 ship 字段（gleens +2 等 hex 问题下自动 hex=null→ship 一次点完）；PI 热区有专属能力的族直发该能力（`onSpecialTile` 预填，无专属能力族退回特殊行动菜单）；ac2 八角/bescods 八边形/探索板八角（gleens-range 等）/科技片高级片八角（tech9/advtech*）/助推片八角（booster4/5）全部 `onSpecialTile` 直发；研究板行动格/联邦片供应区/船上金框片/版图建筑拖拽/地图 hex（建筑→升级、空地→建矿）直点。行动红框（`actionFlash.ts`）由服务器回播日志驱动（全员可见），~5s。
- **严格 TS**：strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes。改 types.ts 只追加不改语义。
- **任何服务器拒绝必须有可见反馈**（error-toast）。
- **任何 pending 决策类型必须有交互入口**：GameScreen effect 对 gain-tech-tile/free-mine/tinkering/itars-gaia 自动开选择流。新增 pending 类型时**必须同步接选择流**，否则玩家必然卡死。
- **选择流字段清单必须与引擎枚举字段一致**：类别的 fields 漏列引擎枚举里的区分字段会让候选在选择机里塌缩、玩家根本看不到该选项。引擎行动新增载荷字段时，同步检查 `interactions.ts` 对应类别的 fields（有"高级板三件套"字段清单回归测试）。
- **拿板类问题的选项顺序**：高级板问题**置顶**（有高级板候选时先问「高级科技板 / 拿标准板 →」）。**轨道先于翻面**：L5 推进才需翻联邦片——先给全部轨道选项，选到 L5 轨时才出翻面问（单标记自动落定）；普通片+非 L5 轨时翻面问完全不出现。**高级板覆盖基础板的显示**：TechBoosterStrip 里被覆盖的基础板不再单独出现，原位置直接替换为高级板（acquisitions 去重，物理覆盖关系）。**联邦片按"同 id 第几枚"匹配实例**：同 id 两枚的翻面状态可能不同（PlayerMat `fedInstance`，勿回退成按 id find）。

## 规则数据来源与准确性

- 官方规则书文本：`reference/gaia-base-rules.txt`、`reference/lost-fleet-rules.txt`（本地，gitignored）。
- 精确数据交叉验证（MIT 许可）：`reference/gaia-engine`（gaia-project.io 官方引擎源码，基础游戏）与 `reference/gaia-project`（同系，含 Lost Fleet 实现）。
- LF 文字层缺失的组件数据（深空 16 面、Interspace 构成、新族面板、13 神器、6 Tinkering tiles、飞船行动格分配、金框联邦标记、eco 覆盖板双面）由调研 + BGG/uiqoo/Feuerland 图像实证补全，集中在 `packages/engine/src/data/lostfleet.ts`（改数据只动它）。
- 规则细节备忘：2 人局移除叛乱号（Rebellion）；基础 9 种科技片供应 = `min(t.count, playerCount)`；拿科技板可升哪条轨由开局洗入的 `board.techTilePositions` 决定；ship-terraform-step 免 gaia 费/排除 asteroid 是参考引擎原文行为。
- **参考引擎的 quirk 要对齐而非"修正"**：leech 空碗不邀约、fed1 无绿面、setup 放置不产生邀约、ship-credit 建矿逐项扣费（不收 gaia 费/不得 proto 分/排除 asteroid）。

## 差分对拍（规则正确性的核心保障）

`reference/harness/`（gitignored 本地工具）：参考引擎（vite-node 驱动）与我们的引擎
从**完全相同的局面**（`GameConfig.preset` 指定地图摆放 + 全部板块抽取）出发，逐步
执行等价行动，归一化比对状态。

- `run-diff.ts <fixture>`：主程序（`--max-steps N --continue-on-diff`）。`gen-fixture.ts`：随机对局生成。`hunt-scenario.ts`/`hunt-advtech.ts`：定向狩猎缺口机制。`fed-diff.ts`：联邦形状枚举对拍。`NOTES.md`：合理差异（玩家选择类，用 assumeLegal 覆盖并记 NOTE）。
- 现状：**50 局零分歧**（基础/LF/随机/定向/高级板专项），12 类已知缺口全闭合。修 bug 必配 `packages/engine/test/` 回归测试。
- **有意偏离参考引擎一处**：终轮已 pass 的玩家不再收到充能邀约（规则书虽允许跳过后充能，但终轮魔力无价值、接受=纯亏 VP 必然拒绝）。对拍跑到该场景会分歧，属预期，记 NOTE 跳过。
- **对拍盲区**：行动序列来自参考记录，踩不进"我们多枚举的非法候选"——枚举类校验只能补定向测试。
- ts-node 驱动参考引擎不可用（v5 太旧静默不执行）；一律用仓库根 `npx vite-node`。

## 素材与校准（web 美术）

- 素材在 `packages/web/public/assets/`（个人非商用）。**坐标校准一律写数据文件并配测试**：`sector-calibration.ts`（13 扇区统一 325/352.5/81.25，k0=4）、`ship-calibration.ts`（4 船）、`faction-calibration.ts`（族板模板+override：specialSlot/ac2ActionSlot/threeStepSlots/gleensFedSlot/LF_PHOTO 矿行/moweyds 矿行/resourceTrack 资源轨——黄钱×2 先推满 15 再推第二条、白矿、蓝知 token）、`research-calibration.ts`（研究板，含 QIC_COVER_RECT）、`panel-calibration.ts`（种族飞船面板，含 `PANEL_SPECIAL_*` 八边形槽）、`scoreboard-calibration.ts`（实图计分板）、`placements.ts`（运行时反推扇区摆放——GameState 不存 placement；深空板 11b/18b 图像面序与数据序不一致，`DEEP_IMAGE_FACE_ORDER` 渲染覆盖，引擎数据不动——对拍口径）。
- 图像处理脚本在 `reference/harness/` 与 `.venv`（Pillow/PyMuPDF）。用户自拍素材：`cut-faction-panels.py`（抠 18 块种族飞船面板 → `factions/panels/<id>.png`）、`cut-scoreboard-assets.py`（抠计分板/梯形扩展片/QIC 覆盖板；原照片不入库）。
- 船板图来源：rebellion/eclipse 用 feuerland 官方渲染（2000×621 黑底）；twilight/tfmars 用 Steam TTS 模组（id 3347152196）内嵌官方渲染（3411×1050 黑底）。moweyds 族板图 = BGG 西班牙版开箱照下半块（fetch-assets 走 CROPS 重建）。取图渠道备忘：BGG 图库可绕 Cloudflare（`api.geekdo.com/api/images?objectid=<id>&objecttype=thing&pageid=N` 列表 + `api/images/<imageid>` 单图）；Steam Workshop 文件用 `api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/` 免 key 拿 file_url。
- LF 青/粉两色建筑无图：红/蓝图 + CSS hue-rotate 近似，**青色必须 hue-rotate(-65deg)**（与兰提达纯蓝区分）。AC_blue 原图偏紫红，fetch 时用 PIL HSV 的 H 通道 -16 修正。
- 行动格盖片（action token）：`markers/trim/ActionToken.png`（`ACTION_TOKEN_IMAGE`）；渲染宽 = 印刷八边形外径——研究板 `ACTION_TOKEN_SIZE=0.084`、飞船 twilight 0.082 / tfmars 0.088 / rebellion 0.105 / eclipse 0.115；片上盖片（`.tile-used-token`）对准片上的行动格八边形：科技/高级横片锚点 (35%,44%) 宽 46%，助推竖片锚点 (50%,20%) 宽 64%。
- 地图建筑白边：BoardSvg `<defs>` 的 `#building-outline` filter（feMorphology dilate 1.2 + 白 flood 垫底），hue-rotate 在 image 自身 style.filter（先转色后由父 g 描边）。
- 研究轨玩家 token：圆柱形（`.player-dot` + ::before 顶椭圆 + ::after 柱身，玩家色 `--pc`），宽 `LEVEL_DOT_FRAC=0.28`；**z-index 恒为 5**（玩家 token 永远浮在最上层，LF 经济覆盖板/QIC 覆盖板 z-index 1 不得遮挡；经济覆盖板位置 ECONOMY_OVERLAY_POS=0.778）。
- **地图六角格描边**：小格统一**单描边**（`.hex-edge` #5b9be6 细蓝线，叠星球图之上）；**扇区大板块边界**（19 小格一块）用**琥珀金线**（`.sector-edge` #e0a93e 3px；几何 = 枚举扇区格外边，`sectorOutlineSegments` 导出并配几何测试：19 格扇区边界 30 段）。

## 布局

- **顶栏三段式**：左区 = 盖亚计划标识 + 第 x/6 轮 + 导出对局；中区（与星图水平对齐）= 本轮计分 + 行动按钮组（含情境按钮 + 兑换下拉）；右区 = 先手/轮到/已连接 + 离开房间。
- **左栏两块**：上 = 我的版图 + 正右方竖列【种族飞船面板（LF 实图，上）+ 当回合助推片（下，高 = `--booster-h`）】（仅 LF 局左栏加宽 `--panel-w`；穿梭机叠加未派显示、已派留空）+ 下方科技/高级/联邦/圣器片横条（科技片与研究板同宽 `--rb-tile-w`、联邦片 34px、圣器同高按原图比例 344×265、按获得时间混排）；下 = 对手 TAB 细条（座位色块+行动者指示点）+ 选中对手版图同款组合。2 人局无 TAB。宽屏（>1680px）按 `--ui-k` ≤1.35 放大；**版图/助推器另有全局 0.8× 系数**。
- **中央**：星图（滚轮缩放/拖拽平移/双击复位/自由旋转手柄）+ 底部横条 = 助推器池（左，池随内容定宽）+ 舰队 2×2（右，60% 宽右对齐），两者不得超过中央宽。
- **右栏**：研究轨道整图（科技片错落堆叠；**LF 时 QIC 覆盖板盖住右下 3 绿水晶行动格**，引擎同步禁用）+ 实图计分板（`ScoreboardBoard`，LF 下接梯形扩展片 + 第 7 高级板槽）+ **常驻计分表**（计分板正下方，无展开态）；右栏宽 `--rail-r-w` 按 data-lf 分两档。
- **复盘模式**：布局与对局同构（LeftRail 视角座位版图 + 对手 TAB / 星图 / 右研究计分栏）；回放控制条在**星图正上方**；顶栏左区 = 标题+轮次+「此处开始对局」，右区 = 轮到+退出复盘；「视角⇄」轮换第一视角。

## 现行规则/交互口径（已定型，勿翻案）

- **充能 `chargePower` 全局 I→II 优先**（魔力必须 I 区全转完 II 才能 II 转 III；II→III 连跳贪心已被否决）。**蹭能接受计费 = 按实际充入量−1**（chargePower 内部按可充 token 数自封顶；可充 < 邀约量时按实充计费不白亏 VP；显示层 ActionBar 同步按 min(邀约量, 可充数) 封顶，引擎邀约量保持 pv 原文以保重放兼容）。ambas 案例此口径下 III 上限是 4（"同一 token 一次充能动两格"的连跳算法若再提，先与规则书/参考引擎核实再议）。**改口径有重放副作用**：服务器重启重放会按当时口径重算全部历史充能。
- **终轮已 pass 玩家不收充能邀约**：规则书允许跳过后充能，但终轮跳过后魔力无价值、接受=纯亏 VP 必然拒绝，故直接不生成邀约（`makeChargeOffers` 过滤 `passedPlayers && round>=6`；非终轮跳过玩家仍正常收邀约——规则书口径）。**有意偏离参考引擎**（对拍分歧记 NOTE）。**重放兼容**：口径前日志里的 charge/decline-charge 过期响应作 no-op 跳过（三层：engine `apply.ts` + server `session.ts` restore/undo 循环；拒绝响应本无状态变更，跳过状态等价）。
- **收入顺序玩家决策（pending income-order）**：收入同时含 token+充能、**充能 > I 区 token**（I→II 优先下两序才有差异；charge ≤ I 区时新 token 与 II 区旧 token 命运与顺序无关）且加完 token 也转不满时（turn.ts `incomeOrderNeedsDecision`），资源先结、token/充能压入 `state.incomeQueue` 逐个置 pending，玩家二选一先拿豆/先转（actions/income.ts）。`apply.ts settleIncomeSkips` 对非 income-order 行动按 tokens-first 自动冲刷（旧日志重放兼容）；**income-order 行动到来时无待决则 no-op 跳过**（apply.ts + server session.ts restore 循环同款——过宽判定时代记录的 income-order 在精确判定下无待决、两序本一致，跳过是状态等价的，否则恢复即 session-lost）。AI 默认 tokens-first；撤销条豁免（轮初响应类）。
- **回合完成闸（turnHold）**：非 pass 主行动及其 pending 全部响应完毕后 `state.turnHold`=行动者——actorOf/枚举只认持闸玩家（免费兑换/烧脑/`confirm-turn`），**下一玩家按钮不亮**；`confirm-turn` 放闸（不推进，闸已在主行动时推进过）。pass 直接推进不设闸。**完成回合只有地图下方撤销条一个入口**（[完成]=提交 confirm-turn）。**幻影条规避**：GameScreen 检查点 effect 遇 confirm-turn 快照不重置检查点/不重武装撤销条（否则立刻弹出"无变化"第二撤销条）。**重放兼容两个必经点**：`apply.ts settleTurnHoldSkips`（非持闸玩家行动自动放闸）+ server restore/undo 重放循环**仅当 `player !== turnHold` 时**才给免费行动注入库中 player 列为 actor（持闸玩家自己的免费行动绝不注入——actor 字段改变 stableStringify 会破坏合法性比对）。AI 侧：RandomAgent/测试驱动 actingPlayer 补 turnHold；selfsearch `skipTurnHold`；lookahead `stillMyTurn` 认闸。
- **撤销条 = 服务器资格镜像（不依赖内存检查点）**：可见性 = 日志里我最后一个回合内**行动**（主行动/免费行动（烧脑/兑换）/setup——免费行动后未做主要行动也出条；被动充能响应、pass、轮初响应、confirm-turn 不算）存在 + 其后无其他真人非响应行动（与 session.undo 尾段校验一致）+ **最后行动之后尚无我的 confirm-turn**（已完成过的回合刷新后不再弹"回魂条"）+ 未收起；**另加防呆强制显示**：confirm-turn 在我 legalActions 且未收起时必显示（否则对手 pending 窗口期点[完成]会因 confirm-turn 不可用而把唯一完成入口永久藏掉）。**[完成] 仅在 confirm-turn 实际提交后才记 dismissedAt**（按钮在 confirm-turn 不可用时禁用）。检查点只在主行动快照时重置（免费行动不重置，增量 = 整回合累计；回合首动是免费行动时照常建立）。充能不可撤销不弹条；对手真人行动后必消失（server 必拒，显示即误导）。增量显示 `display.describeDelta` 含矿/钱/知/Q/魔 I·II·III/VP。
- **拿板双翻面（researchFlipToken）**：拿高级板（必翻 1 枚绿面联邦标记= `flipToken`）后可升任意轨，升 L5 需再翻第 2 枚（= `researchFlipToken`）；标准板路径升 L5 的翻面仍复用 `flipToken`（重放兼容，旧日志语义不变）。枚举升轨翻面池 = 全部绿面标记按枚扣减拿板用掉的那枚。fold/unfold 规则（upgrade/gain-tech-tile/ship-action/qic 四处同构）：高级板路径 research.flipToken ↔ `researchFlipToken`，标准板路径 ↔ `flipToken`。
- **同座位多连接共存**：resume 不踢同座旧连接（该座位最后一条连接断开才标离线）；web 被动 close 一律自动重连。session-lost 不清 localStorage token（仅 invalid-token 清）。
- **先手洗牌**：`GameConfig.turnOrder`（初始行动顺序，缺省座位序）+ server `drawTurnOrder`（种子派生洗牌，异或常数与抽族流去相关）——random/draft 两模式共用，draft 顺位即对局行动顺序。**座位号 ≠ 顺位下标**：turnOrder 的读取点（setupQueue/advanceSetup/turn.ts 回合推进/draft）混用会错配；涉及 turnOrder 的断言必须补非座位序种子（2p [1,0] 用 seed 2，3p [2,0,1] 用 seed 3）。`firstPlayer = turnOrder[0]`；加一个字段要查它的全部读取点是否都被新语义覆盖。重放兼容：无 turnOrder 的旧局默认座位序不受影响；有 turnOrder 且已过第 1 轮的局迁移时按"首个非 setup 行动者"旋转 config.turnOrder 使其首位 = 实际首动座位。
- **选族 setup 信息区**：`DraftState.preview`（server 用占位族 + 同种子 `buildDraftPreview` 重建局面——引擎 newGame 的 rng 消耗序为 板块→地图→种族，前两项与种族无关故逐格一致）；DraftView 显示 顺位（先手标注）/ 整块实图计分板（ScoreboardBoard 同款：回合片+终局片+星球转化关系）/ 地图预览。规则依据：规则书 setup 先摆图后选族。
- **盖片（已用标记）由 specialUsed/roundAbilityUsed 驱动；回合结束清空 = 能力刷新，属正常**。
- **回合顺序**：下轮行动顺序 = 本轮 pass 顺序（不是固定桌序；被动充能/leech 仍按桌序）。
- **setup 跳过**：ivits（无起始矿）、LF 新族（extra 阶段才放）、xenos（第 3 矿）、darkanians（extra 阶段）的队列推进靠 `settleSetupSkips` 容忍空枚举。**陷阱：该归一化只在 applyAction 后跑**——`GameSession` 构造（含 restore/undo 重放）必须先 `settleSetupSkips(newGame(config))`，否则 LF 新族/ivits 在 seat 0 时开局即死锁。
- **复盘分支（branch_game）**：复盘当前步可「此处开始对局」——record 截断到当前步发 `branch_game`，服务端重放校验后开单人+AI 房间（申请者坐 review.viewSeat，其余座位 AI 托管；开放真人补位未实现）。终局面/空前缀/越界座位分别报 import-invalid/bad-message/invalid-seat。
- **seq 双口径**：服务器 `action_applied.seq` = 行动**落库序号**（= 行动前快照 seq），`snapshot.seq` = 前者 +1。web 端按"检查点以来我的行动"过滤日志时边界必须是 `e.seq >= checkpoint.seq`；dismiss 记录用 `lastMyActionSeq`。**测试模拟 emit 必须遵守真实口径**（action_applied seq = snapshot seq − 1）——填相同 seq 会把这类 bug 全掩盖。
- **draft 阶段房间只在内存**（不落库不打日志，seed 随进程丢失不可复现）——对策：seed 大厅可见（RoomState.seed 已知即下发，Lobby 建房可填、房间视图显示值），对局开始即落库。
- **探索飞船候选**：`exploreCandidates` = 普通 explore-ship + 射程加成特殊行动（gleens-range/booster5/ship-range3）的 ship 目标，同船去重；FleetPanel 探索按钮与「探索飞船」类别同口径（`canExploreShip`）。
- **联邦枚举（极小性终口径）**：分量子集枚举（≤12 分量护栏，超出回退旧策略），pv ≥ 阈值且**极小**；形状违规 ⟺ 存在某分量，去掉后剩余 pv 达标、连通、且卫星**严格更少**（规则书"少 1 星球**且**少 1 卫星"，与参考 `isOutclassedBy` 同）。web 两步式交互：点卫星格（「最少卫星」快捷键：卫星数最少、并列选卫星邻接未殖民星球最少的方案）→（同卫星集多组星球时再选组合）→ 选联邦片（选项按钮 + 研究板供应区/船上金框片可直接点）。

## 踩过的坑（方法论）

- **随机命中型场景测试的脆弱性**：场景类测试一律**定向构造**（手术改状态），随机命中只用于"必然出现"的宽泛条件。
- 后台起 server/web 等长驻任务必须 `disable_timeout`（600s 默认超时曾杀掉对局中的 server）。
- **截图验证**：chrome headless（`--headless --screenshot --window-size --force-device-scale-factor=2`）+ preview.html（不进生产 bundle）是 UI 验收主路径。
- **AI 驱动永不卡死**：driveAI 全 try/catch + legal[0] 兜底；agent.decide 对任何合法行动集必须返回合法行动（safeScore）。
- **代客操作（ws 直连改对局）**：node 脚本连 ws://localhost:8430/ws，DB 读 seats 表 token → resume → submit_action/undo。stableStringify 合法性要求行动体与枚举逐字节一致；脚本必须逐步断言精确 seq 防旧消息混淆（undo 是单行动语义，多回合回退逐座位交替）。脚本放 `reference/harness/`。

## AI（heuristic2，v2 估价框架）

默认 AI 是 `builtin:heuristic2`（registry DEFAULT_SPEC；v1 `builtin:heuristic` 保留作
LLM 预筛/兜底与 bench 基线）。架构参照 BrassBirmingham 的 CFG + overrides 模式，
代码在 `packages/llm/src/heuristic2/`：

- `cfg.ts`：全部权重集中在 `BASE_CFG`（每个参数注明攻略/bench 来源）；**变体显式
  区分**——`LF_DELTA` 仅在 `lostFleet=true` 时深合并。调参注入：`createEvalPlugin`
  的 `tuneEnvVar: GAIA_TUNE_V2` 可注入 JSON 做消融。
- `context.ts`：`evalCtx(state, seat)` 合并链 BASE→LF_DELTA→插件 overrides→族增量，
  WeakMap 缓存（带 overrides 不缓存——调参路径）。
- `values.ts`/`score.ts`：行动快评（纯函数不仿真，VP 等值）；分阶段权重（R1-2 经济
  /R3-4 转化/R5-6 VP 冲刺）；回合计分板看本轮+下轮（下轮 nextRoundMult 折预期）。
- `position.ts`：局面叶估值（已入账 VP + 库存×阶段权重 + 总收入 NPV + 研究轨里程碑
  + 持有片折算 + 联邦重结算期望 + **终局计分零和位次期望**）。
- `lookahead.ts`：按行动域 topK 剪枝 → applyAction(assumeLegal) 仿真 → 仍我方行动
  则 +alpha×次动分 → +leafWeight×叶估值。仿真失败退回静态分。
- `factions.ts`：种族插件 `FactionHooks { cfg(variant), adjustAction, adjustFinal }`；
  `FACTION_STRENGTH` 按变体分表的 draft 强度表（server draft AI 已接线）。

验证方法（指标 = **内战均分** + 对基线胜率；同代码镜像局必然完全重复，镜像只对
异构对抗有意义）：

```bash
# 内战均分（固定种族池，跨轮可比）：
npx vite-node packages/llm/bench/run.ts --agents heuristic2,heuristic2,heuristic2,heuristic2 --games 10 --concurrency 8
# 随机种族池（覆盖面）加 --factions random；base 变体加 --no-lf
# 对抗基线：
npx vite-node packages/llm/bench/run.ts --agents heuristic2,heuristic,heuristic2,heuristic --games 10 --concurrency 8
```

v2 数据（4p LF 固定池）：内战均分 86.1（v1 为 50.6）、最高均值 105.0、联邦 3.6 个/局。
与人类（150-200）的剩余差距：发展度（人均 15.6 pv vs 人类 ~26 pv）→ 联邦 0.9 个/人
（人类 3 个）、高级片 ~0.1 个/人。已验证的调优结论（勿再走弯路）：

- **前瞻与叶估值是主力**：关前瞻 −14 分；leafWeight 1.2 是峰值；alpha 0.5 优于 0.7；
  候选 topK 加宽更差（Brass 同结论）。"富"叶估值优于去重叶估值（−9 分）。
- **资源量纲 2.5/2.5/4（ore/knowledge/qic）是峰值**——社区交换表（3/3/4）对 AI 偏"抠"。
- **leech 阶段倍率 early 1.4 / mid 1.1 / late 0.7 是峰值**——深搜已能较好处理充能时机。
- **联邦凑组（分量感知，score.ts ownComponents）**：贴单分量给凸形（pv≤5 峰值）；
  合并两个分量轻罚（0.5×pv）；新种子按 2 格桥接 pv 给凸形。**禁入区（已入联邦格+邻格）
  不计入新组 pv**。孤立选址惩罚与 clusterMult>1 都伤扩张，勿加。已组联邦按满值组计入
  潜力（否则深搜系统性拒绝组建）。
- **联邦标记（values.ts federationTokenValue）**：绿面票稀缺敏感计价——无其他未翻
  绿面票时按 advTicketExpectation 显著加价，已有票只 +1.5。L5 翻面门票 3+0.25×
  资源面，L4 轨+可覆盖片在手时再 +6。
- **第二座学院给惩罚**（6o+6c 极贵、AC2 无收入轨）；TS 给固定溢价（经济骨干+电力密度）。
- 多簇联邦潜力 + deficitBoost、LF 飞船拉力（earlyShipBonus + vpDeficitPull）消融均拖分
  且未推动目标行为——默认中性化（代码保留，消融位见 cfg 注释）。
- bench 工具：`diagnose.ts`（终局面貌+行动直方图+机会vs选择+VP 构成+联邦组探测）、
  `probe.ts`（指定座位逐决策 Top 候选+组 pv）；`GAIA_BENCH_FACTIONS` 可换固定池。

深搜（selfsearch.ts，自我深搜"假设不碰撞"，**默认开启**）：

- 只展开我的行动序列，对手占位（主阶段恒 pass——直接构造
  `{type:'pass', booster: 供应[0]}`（不能续用同款，见 engine pass.ts）免枚举；
  充能恒拒绝；setup/pending 取 legal[0]）。depth=4 + 根节点 0.8×最优+0.2×次优加权
  （brittle plan 对冲）。depth5 紧帽抬下限压上限，不采用。
- 成本主要在**每节点的 enumerateActions+静态评分**，任何"对手也要枚举"的设计都
  不可行（max^n search.ts 弃用保留）；剪枝帽随层数衰减是必须的。
- 提速方向：evaluateState 按 stableStringify 备忘、根候选帽收紧、预算按阶段自适应。

## BGA 对局拉取

- 脚本 `tools/bga/bga-pull.ts`（cookie 在 `~/Projects/credentials/bga-cookies.txt`，只按路径
  读取，值不进对话/git）；原始 cache 在 `reference/bga-cache/`（gitignored），蒸馏产物在
  `data/bga/`（git 跟踪）。统计：`bga-analyze.ts`（日志维度）/ `bga-stats.ts`（摘要维度）。
- 经验：getRanking 可用；fetch 必须 20s 硬超时（undici 假死）；logs 段 200 桌/批；
  复盘保留期 ~400 天；archive 生成异步需 12s/25s 两轮轮询才标死；会员硬限额宽。
- 已验证的人类基准：联邦 3.22 个/人、研究 15.4 步/人（AI 目前约 1/4）。

## 待办/已知缺口

- LLM 决策链已实现但需 ANTHROPIC_API_KEY 才启用（预筛仍走 v1 scoreAction）。
- Solo Automa 未实现（项目不做单人）。
- AI 优化 goal（暂停中）：联邦数朝 ≥3 推进；更详细的资源/收入/分数折算估价；LF 前期
  上飞船优先度 + 登船 −5VP 在低分（<5 VP）场景的折扣优先。
- BGA 拉取（进行中）：日志段收尾 → 恢复 500 玩家枚举 → 跑统计报告。
