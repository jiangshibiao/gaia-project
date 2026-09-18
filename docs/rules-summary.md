# 盖亚计划规则摘要（实现用）

来源：官方规则书（`reference/gaia-base-rules.txt`、`reference/lost-fleet-rules.txt`）+
MIT 开源引擎 `reference/gaia-engine/src/` 交叉验证。标注【未确认】的条目规则书文字
层不可得，实现时取合理简化并在代码注释标注。

## 1. 基础游戏

### 概况
- 1–4 人，6 轮。每轮：I 收入 → II 盖亚 → III 行动 → IV 整理。
- 行动阶段轮流各出 1 个行动，直到全员 Pass。行动前后可做任意免费行动。

### 资源与 Power
- ore / credits / knowledge / Q.I.C. / power tokens。上限：15 ore、15 knowledge、30 credits。
- Power 三区循环 I→II→III：
  - 充能 charge N：优先 I→II；I 空则 II→III；都空则不能充。
  - 花费 spend：仅从 III→I。
  - 获得 gain：供应堆→I 区。丢弃 discard：任意区（除 Gaia 区）→供应堆。
  - 烧脑 burn（免费行动）：弃 II 区 1 token，II 区另 1 token→III。
- 被动充能：任何玩家建矿/升级时，2 格范围内有建筑的其他玩家按范围内最高
  power value 建筑充能 1/2/3/4 power，代价 0/1/2/3 VP。已 Pass 者也可充；
  顺时针依次；全充或不充（VP/循环容量不足按实际部分充）。

### 行动全集
1. **建矿**：1o+2c。目标须为空、可达（射程内）、可居住（terraform 付费或 QIC）。
   行动前可花 QIC 加射程（1q=+2 格）。
2. **启动盖亚计划**：需可用 Gaiaformer + 可达空 Transdim + 把 6/6/4/3/3 power
   （按 Gaia 轨 L1–L5）从任意区移入 Gaia 区。下轮盖亚阶段转化为 Gaia 星球，
   Gaiaformer 留置星球直到在其上建矿收回。
3. **升级**：Mine→TS（6c+2o；2 格内有对手建筑则 3c+2o）；TS→Lab（5c+3o，立即
   拿 1 科技板）；TS→PI（6c+4o，解锁种族 PI 能力）；Lab→Academy（6c+6o，立即
   拿 1 科技板；二选一：+2k 收入学院 或 "行动:+1q" 学院）。
4. **组建联邦**：连通建筑群 power value ≥7（mine=1、TS/lab=2、PI/academy=3）。
   不相邻星球用卫星连接：每卫星=弃 1 power，放与己方星球/卫星相邻空格（不放星球
   上；每格每色 1 颗）。最少星球+卫星；每星球/卫星只属一个联邦；新联邦不得与已有
   联邦相邻。拿 1 枚联邦标记（绿面朝上，立即获得奖励）。
5. **研究推进**：4k 升 1 级。升到 L3 时充能 3 power；升 L5 需翻 1 枚联邦标记到
   灰面，每轨全游戏仅 1 人能到 L5。
6. **Power 行动**（每格每轮全场 1 次）：7pw→3k；5pw→建矿(2 免费 terraform 步)；
   4pw→2o；4pw→7c；4pw→2k；3pw→建矿(1 免费步)；3pw→+2 power tokens。
   **QIC 行动**：4q→拿科技板；3q→重新结算 1 枚联邦标记；2q→3vp+每殖民星球类型
   +1vp。
7. **特殊行动**（橙色格，种族板/科技板/助推器上；无费用，每轮每格 1 次）。
8. **Pass**：归还助推器另选 1 个（不续用同款）；首个 Pass 者拿下轮先手；第 6 轮
   不拿新助推器。
9. **免费行动**：4pw→1q；3pw→1o；1q→1o；4pw→1k；1pw→1c；1k→1c；1o→1c；
   1o→1 power token；+ 烧脑。

### 星球与地图
- 10 种星球：7 母星类型（Terra 蓝/Desert 黄/Swamp 棕/Oxide 红/Volcanic 橙/
  Titanium 灰/Ice 白）+ Gaia 绿 + Transdim 紫 + Lost Planet（隐藏）。
- Terraform 环：Terra→Oxide→Volcanic→Desert→Swamp→Titanium→Ice→回环，
  距离 1–3 步。费用按 Terraforming 轨：L0–1=3o/步、L2=2o/步、L3+=1o/步。
- 射程（Navigation 轨）：L0–1=1、L2–3=2、L4=3、L5=4。路径可穿任何星球。
- Gaia 星球：付 1q 居住；有己方 Gaiaformer 的免 q 且视为可达。
- Transdim：只能经盖亚计划转化。
- 地图：10 扇区（05/06/07 双面）。3–4 人全 10 块；1–2 人用 01–07。同类型星球
  永不直接相邻。hex 布局数据见 `reference/gaia-engine/src/map.ts`。

### 研究轨（6 轨；仅当前级生效；星标为一次性）
- **Terraforming**：L1 +2o\*；L2 2o/步；L3 1o/步；L4 +2o\*；L5 1o/步+获得预设
  联邦标记（算组建联邦）。
- **Navigation**：L1 +1q\*；L2 range2；L3 +1q\*；L4 range3；L5 range4+放置
  Lost Planet（可达空格，算建矿，视为独立星球类型，不可升级，放 1 卫星标记）。
- **AI**：L1–L5 一次性 +1q/+1q/+2q/+2q/+4q。
- **Gaia Project**：L1 花费6pw+第1 Gaiaformer；L2 6pw，+3 power tokens\*；
  L3 4pw+第2个；L4 3pw+第3个；L5 3pw，+4vp 且每颗有建筑的 Gaia 星球+1vp\*。
- **Economy**（收入）：L1 +2c、充能1pw；L2 +1o+2c、充能2pw；L3 +1o+3c、充能3pw；
  L4 +2o+4c、充能4pw；L5 一次性 +3o+6c+充能6pw。
- **Science**（收入）：L1 +1k；L2 +2k；L3 +3k；L4 +4k；L5 一次性 +9k。

### 科技板
- 标准 9 种×4 块（`reference/gaia-engine/src/tiles/techs.ts`）：
  1. +1o+1q\*；2. 每殖民星球类型 +1k\*；3. PI/Academy power value 变 4；
  4. +7vp\*；5. 收入+1o、充能1pw；6. 收入+1k+1c；7. Gaia 建矿 +3vp；
  8. 收入+4c；9. 特殊行动：充能 4pw。
- 高级 15 种（每局随机 6 块；条件：该轨 L4/L5 + 翻联邦标记 + 覆盖自己一块标准
  板，被覆盖失效）：
  1. Pass 时每联邦标记+3vp；2. 每次研究+2vp；3. 特殊行动+1q+5c；
  4. 每 mine+2vp\*；5. Pass 时每 lab+3vp；6. 每已殖民扇区+1o\*；
  7. Pass 时每星球类型+1vp；8. 每 Gaia 星球+2vp\*；9. 每 TS+4vp\*；
  10. 每扇区+2vp\*；11. 特殊行动+3o；12. 每联邦标记+5vp\*；13. 特殊行动+3k；
  14. 每次建矿+3vp；15. 每次升 TS+3vp。
- 拿板即升对应轨 1 级（轨正下方 6 块）或任意轨（底排 3 块）；可选择不升。

### 联邦标记（19 枚 = 6 种×3 + Gleens 专属）
12vp（双面灰，不可翻）；8vp+1q；8vp+2 power；7vp+2o；7vp+6c；6vp+2k；
Gleens 专属 1o+1k+2c。开局随机 1 枚（非 Gleens）放 Terraforming 轨 L5。

### 回合计分板（10 选 6）
1. terraform 步+2vp；2. 研究+2vp；3. 建矿+2vp；4. 联邦标记+5vp；5. 升 TS+4vp；
6. Gaia 建矿+4vp；7. 升 PI/Academy+5vp；8. 升 TS+3vp；9. Gaia 建矿+3vp；
10. 升 PI/Academy+5vp。

### 终局计分板（6 选 2；18/12/6/0；1–2 人局有中立占位）
1. 联邦内建筑最多(10)；2. 建筑总数最多(11)；3. 星球类型最多(5)；4. Gaia 星球
   最多(4)；5. 有建筑扇区最多(6)；6. 卫星最多(8)。

### 回合助推器（10 选 人数+3）
1. 收入+1o+1k；2. 收入+1o+2pw；3. 收入+1q+2c；4. 收入+2c，特殊：建矿(1 免费步)；
5. 收入充能2pw，特殊：建矿/盖亚计划且基本射程+3；6. 收入+1o，Pass 还时每
   mine+1vp；7. 收入+1k，Pass 还时每 lab+3vp；8. 收入+1o，Pass 还时每 TS+2vp；
9. 收入充能4pw，Pass 还时每 PI/Academy+4vp；10. 收入+4c，Pass 还时每 Gaia
   星球+1vp。

### 终局计分
终局板(18/12/6/0) + 每轨 L3/L4/L5 各 +4vp + 每 3 剩余资源(c/k/o)+1vp。平分共享。

### 14 种族（默认 3k+4o+15c+1q，I 区 2 枚/II 区 4 枚；面板收入：mine 揭 +1o×6、
TS +3c/4c/4c/5c、lab +1k、学院1 +2k、PI 充能4pw+1 power token）

| 种族 | 母星 | 差异 | 起始 L1 | 能力 | PI 能力 |
|---|---|---|---|---|---|
| Terrans | Terra | I 区 4 枚 | Gaia | Gaia 阶段 Gaia 区 power→II 区 | 可把该 power 当免费兑换资源 |
| Lantids | Terra | 13c；I4/II0 | – | 可在对手星球建矿（免 terraform；不可升级；不计类型） | 在对手星球建矿 +2k |
| Xenos | Desert | – | AI | 放第 3 个起始矿 | 联邦只需 6；PI 收入 +1q 替代 +1pw |
| Gleens | Desert | – | Nav | QIC 改得等量 ore（升 QIC 学院后失效）；Gaia 费付 1o；Gaia 建矿+2vp | 建 PI 时拿 Gleens 专属联邦标记 |
| Taklons | Swamp | Brainstone 起 I 区 | – | Brainstone 可当 3 power 花 | 被动充能时 +1 power token |
| Ambas | Swamp | – | Nav | – | 每轮一次：交换 PI 与一 mine 位置 |
| Hadsch Hallas | Oxide | – | Eco | – | 可用 credits 做 power 免费兑换 |
| Ivits | Oxide | 无起始矿，最后放 PI 到任一红星 | – | 仅 1 联邦；扩展需 ≥7X；卫星付 1q | 特殊行动：放空间站(pv1) |
| Geodens | Volcanic | – | Terra | – | 建 PI 后首次在每种星球建矿 +3k |
| Bal T'aks | Volcanic | II 区 2 枚 | Gaia | 不能 Nav 推进；免费行动：Gaiaformer↔1q；学院2 改 +4c | 解锁 Nav 推进 |
| Firaks | Titanium | 2k+3o | – | – | 行动：lab 降级回 TS 并推进任意轨 1 级 |
| Bescods | Titanium | 1k | – | PI/学院位置互换、TS/lab 收入互换；每轮一次：免费推进最低轨 | 灰星建筑 pv+1 |
| Nevlas | Ice | 2k | Sci | 免费行动：III 区 1pw→Gaia 区换 1k | III 区 token 当 2 power 花；4pw→1o+1c、6pw→2o |
| Itars | Ice | 5o；I 区 4 枚 | – | 烧脑弃的 token 入 Gaia 区 | 盖亚阶段弃 4 Gaia power 换 1 科技板，可多次 |

## 2. The Lost Fleet（失落舰队）

### 组件变更
- 移除基础"星球类型"符号组件（1 终局板、1 高级板、4 标准板），换扩展修订版；
  新符号涵盖 11 种（7+Gaia+Lost+asteroid+protoplanet；Transdim 不计）。
- 新助推器/计分板/高级板洗入对应池；新标准板不混洗（放飞船）。
- 研究板 3 个 QIC 行动被覆盖板盖住整局不可用，QIC 行动改由飞船提供。
- Economy 轨 L3/L4 收入用修订板块覆盖（1 块双面，setup 随机选面）：
  pw 面 L3=1o+2c+充3pw、L4=2o+2c+充2pw；vp 面 L3=1o+3c+1vp、L4=2o+4c+1vp。
- 种族微调：Ivits 起始 I 区 2pw+II 区 2pw；Bescods 起始 3k；Lantids +1 power(I 区)，
  少于 4 人用修订 PI 板块。Xenos 新免费行动：1o→1 power 放 III 区。Gleens 探索板
  特殊行动：建矿/盖亚计划/探索飞船射程+2。

### 新星球
- **Protoplanet**：所有种族 3 terraform 步；建矿 +6vp（起始原行星不得分）。
- **Asteroid**：需 1 可用 Gaiaformer（永久报废）；免建矿费。
- 4 新种族无母星；Gaia 居住费 2q。

### 地图设置
- 2 人：扇区 01–07（白描面），中心 1+外圈 6 错开成 6 孔放 Interspace；外缘 6 个
  深空三角缺口放深空板 11–16。"最多小行星"终局板需 ≥6 小行星（否则翻 16 号板到 b 面）。
- 3 人：01–10 去 08；6 孔+2 额外位放 8 块 Interspace；8 块深空板（其中 2 块并排
  放在最后放置扇区旁的大缺口）。飞船板相距 ≥3 格。
- 4 人：全 10 扇区（05–07 白字面），10 孔放 10 块 Interspace（飞船不相邻、≥3）；
  8 块深空板填外缘缺口。
- **深空扇区 = 3 格三角形小板**（8 块双面，编号 11–18；2 人局只用 11–16），
  每格内容 P=原行星/A=小行星/M=Transdim/B=空白（无标准色星球、无 gaia）：
  11a=A/P/B 11b=A/B/B；12a=P/M/B 12b=B/A/B；13a=B/M/A 13b=B/B/A；
  14a=B/P/A 14b=B/B/A；15a=B/P/B 15b=B/P/A；16a=B/B/P 16b=B/A/A（2 小行星）；
  17a=B/M/B 17b=B/B/A；18a=B/P/B 18b=B/B/A（按印刷朝向上/左/下，设置随机旋转）。
- Interspace（单格板：飞船/原行星/小行星/空白）：2 人 3 飞船(twilight/tfmars/
  eclipse)+2 小行星+1 原行星=6 块；3 人 4 飞船+2 小行星+1 原行星+1 空白=8 块；
  4 人 4 飞船+4 小行星+1 原行星+1 空白=10 块。卫星不能放飞船格；飞船格不算
  扇区、不作射程起点。

### 飞船与探索（行动 11/12）
- 4 船（2 人局不用 Rebellion）：Twilight(Nautilaks/artifacts)、Rebellion(Vo'Kron)、
  T F Mars(Gaia Federation)、Eclipse(Eridani)。科技槽船（Rebellion/T F Mars/
  Eclipse）各 1 槽随机放 1 块新标准科技板（3 种各 1；2 人局只放 2 块），
  Twilight 0 槽改放人数枚随机 Artifact（13 枚各不相同）；每船随机 1 枚金框
  联邦标记（8 种各 1；2 人局 3 船共 3 枚，其余移出游戏）。
- **行动 11 探索飞船**：船在射程内；有可用穿梭机（2 人 2 个/3–4 人 3 个）；每船
  每人最多 1 个；放最小编号空位；非首个探索者立即按探索轨充能（4 格充能值
  0/2/2/3）。费用 5vp（Taklons 额外 Brainstone→Gaia 区；Nevlas/Itars 额外弃
  1pw；Bal T'aks 付 7vp）。
- 有穿梭机即解锁该船：行动格（每船固定 3 格 = 1 QIC + 1 Power + 1
  Knowledge/Credit，每格每轮全场 1 次）、新联邦标记（组联邦可改拿）、新标准
  科技板（升 lab/学院可改拿，拿后升任意轨 1 级）。
- **行动 12 检查神器**（限 Twilight）：任意区弃 6 power → 拿 1 Artifact。

### 飞船行动格（按船固定）
- **Twilight**（0 科技槽）：3q→重触发已有联邦标记(含即时效果)；3pw+2o→免费升
  TS→lab；1k→+3 射程（建矿/盖亚/探索）。
- **Rebellion**（1 科技槽）：3q→拿 1 科技板(可拿船上)；3pw+1o→免费升 mine→TS；
  2k→+2c+1q。
- **T F Mars**（1 科技槽）：2q→2vp+每块标准科技板 1vp(含被覆盖)；2pw→立即盖亚
  转化(免移 power、立即转化、本轮可建矿复用)；3c→1 个 terraform 步建矿（仅抵
  该步矿费，建矿费与后续步照付）。
- **Eclipse**（1 科技槽）：2q→2vp+每星球类型 1vp；3pw+2k→任意轨升 1 级；
  6c→范围内小行星免费建矿(无需 Gaiaformer)。

### 计分板扩展条
- 第 7 块高级科技板：2 人局条件"≥25vp"；3–4 人局"已探索 3 艘不同飞船"。
  翻联邦标记+覆盖标准板不变。

### 4 新种族（起始 1 建筑，第二阶段放置；无母星；turquoise/pink；基本收入
均 +1o+1k；TS/RL/AC 收入轨标准；探索穿梭机成本均 5vp）
- **Tinkeroids**(asteroid，粉)：2k 4o 15c 1q；能量 I4/II2；+1 Science；PI 收入
  +4pw+1token。起始放 PI；3 种基础星球 3 步、其余 1 步（设置抽块）；Gaia 2q；
  6 块 Tinkering tiles（1–3 轮组/4–6 轮组），每轮开始选 1 块用完移除；
  PI：每轮一次可把当前 tile 上的行动当行动用。
- **Darkanians**(asteroid，粉)：3k 7o 15c 1q；I4/II2；+1 Nav +1 Eco；PI 收入
  +4pw+1token。起始 1 矿；标准星球 1 步；Gaia 2q；PI：首次在每个 Space/Deep
  Space 扇区殖民 +2c+1k。
- **Moweyds**(protoplanet，青)：5k 6o 15c 2q；I4/II4；+1 Gaiaforming；PI 收入
  +4pw+1token。起始 1 矿；开局即有 1 穿梭机在 T F Mars；terraform 同
  Tinkeroids；PI：每轮一次放 Power Ring（6 个）到有己建筑无环星球，pv+2。
- **Space Giants**(protoplanet，青)：3k 6o 15c 1q；I4/II4；+1 Nav；PI 收入
  +6pw+1token。起始 1 矿；标准星球 2 步；探索板特殊行动：建矿(2 免费步)；
  Gaia 2q；PI：一次性拿 1 科技板。

### 扩展新增板块
- 新助推器 4 块（收入 1o/3c/2pw 之一【配对未确认】）：①Pass 时每 Gaiaformer+3vp；
  ②Pass 时每星球类型+1vp；③Pass 时每已殖民深空扇区+2vp；④特殊：免费立即盖亚
  计划。
- 新回合计分 3 张：首次在新扇区建矿+3vp；首次在新星球类型建矿+3vp；建 lab+4vp。
- 新终局计分 3 张：小行星最多；深空扇区最多(Lost Planet 算)；PI 与学院距离最远。
- 新联邦标记 8 枚（金框 8 种各 1，全部有绿面可翻）：12vp；8vp+8c；4vp+4k；
  4vp+2o+1q；7vp+2 power token 直接 III 区；立即拿 1 科技板；免费建矿(无限射程，
  费用照付)；免费建矿(3 免费步，可加程)。
- 新标准科技板 3 种各 1（飞船科技槽用）：①免费建矿(最多 2 免费步)；②基本射程
  永久+1；③一次性 +1o+3k。
- 新高级科技板 6 种各 1：①一次性每 PI/Academy+6vp；②一次性每深空扇区+4vp；
  ③Pass 时每小行星+2vp；④Pass 时每深空扇区+2vp；⑤每次 Q.I.C. 行动+4vp（触发器）；
  ⑥每次 terraform 步+2vp（含免费步；触发器）。
- Artifacts 13 枚各不相同：①收入+1k+1o；②一次性+3c+3o；③一次性+3k+1q；
  ④一次性+5c+2o；⑤+7vp 视作小行星上 1 矿(无扇区)；⑥+7vp 视作原行星上 1 矿；
  ⑦Science 轨每级+3vp；⑧Gaiaforming 轨每级+3vp；⑨每条 ≥L3 轨+3vp；
  ⑩+3vp+每已殖民星球类型+1vp；⑪每已殖民深空扇区+3vp(Lost Planet 计入)；
  ⑫重新触发 1 枚已有联邦标记；⑬收入 2 power 直接 III 区。
- Tinkering tiles 6 块：1–3 轮组=建矿(1 免费步)/充能 4 power/+1 QIC；
  4–6 轮组=免费 3 terraform 步/+3 知识/+2 QIC。

### M1.6 实现口径（实证核定，数据集中 `packages/engine/src/data/lostfleet.ts`）

- 地图几何：外圈扇区沿环错位 1 格，满足"外扇区与内扇区沿 2 格相接 + 6/8/10
  个单格孔"；深空缺口用 halo 算法定位（与 reference/gaia-project lost-fleet-map.ts
  一致：外缘接壤 ≥2 扇区的种子格 + 两个互为邻居的外缘格构成 3 格三角形）；
  深空板按缺口随机铺（板/面/旋转均随机；3 人局"大缺口并排放 2 块"为几何
  自然结果，无需特判）。
- 深空 16 面内容、Interspace 构成、飞船行动格按船分配、科技槽 0/1、探索轨
  充能 0/2/2/3、13 Artifacts、8 金框标记、3 种船上标准板、6 种新高级板、
  6 块 Tinkering tiles、Economy 覆盖板两面、4 新族起始面板：全部实证核定。
- 终局含"最多小行星"且全图 <6 小行星时：强制 16 号深空板用 b 面（规则书翻板
  规则的直译）。
- ship-upgrade-ts-lab（升 lab）：**不拿科技板**——规则文本只给"升级行动"本身，
  未提拿板（对比 fedlf2/space-giants 明示"同升级规则"的措辞）。
- Tinkeroids/Moweyds 的 3 种 3 步星球：setup 时 rng 纯随机抽 3 种【简化】
  （规则书 p.7–8 抽块流程含对手种族母星池，未实现）。
- Lantids 修订 PI（<4 人）：对手星球建矿与母星类型建矿均 +2k（按任务口径，
  3 人局的"充能 1pw"面未实现）。
- 仍存疑（规则书文字层缺失、实证数据未覆盖）：
  ①solo Automa 的 Interspace 构成【未确认】（本项目不做 solo Automa，仅注明）；
  ②新助推器 4 块的收入配对【未确认】；③终局新板中立占位值（asteroid 3、
  deepSpace 3、piAcademyDistance 8）【未确认】。