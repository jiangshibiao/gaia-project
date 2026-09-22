# BGA 盖亚计划对局数据（git 跟踪的蒸馏记录）

本目录存放从 Board Game Arena 拉取并**蒸馏**的盖亚计划对局记录，供 AI 估价体系
校准（人类对局的联邦数/开局模式/终分分布等）。原始拉取响应（大、含冗余）在
gitignored 的 `reference/bga-cache/`，由 `tools/bga/bga-pull.ts` 产生。

- `tables.jsonl`：每行一桌摘要（tableId/玩家/分数/人数/起止时间/是否正常结束/LF 标记）。
- （可选）`games/<tableId>.json`：逐桌蒸馏行动序列（仅当体积可控时提交）。

数据来源与方式见 `tools/bga/README.md`（端点结构、限流纪律、凭据管理）。
版权说明：对局数据归 BGA 与对局玩家所有，仅作本地研究用途，不二次发布。
