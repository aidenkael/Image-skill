# 第三方来源记录（Provenance）

本目录内所有第三方内容均按下表记录原仓库、来源文件、commit SHA 与 License。

## 1. buluslan/gpt-image2-ecommerce（MIT）

| 项 | 内容 |
|---|---|
| 原仓库 | https://github.com/buluslan/gpt-image2-ecommerce |
| License | MIT（仓库 LICENSE 文件，原文保留于本目录 `LICENSE-buluslan.txt`） |
| commit SHA | `a3673fb6f316664280e6abd90a60a578c6fb2228`（克隆时 main HEAD） |

复制内容（原文保留，未改写）：

| 本项目位置 | 原文件 |
|---|---|
| `templates/01-hero-image.json` … `templates/25-sports-campaign.json`（25 个） | `references/templates/*.json`（同名文件） |

思路借鉴（未复制原文）：25 模板触发词匹配表（见 `../SKILL.md`）、Prompt 组装流程（prompt_template + variants + category_tips）、anti-AI 技巧原则。

未复制：`SKILL.md` 原文、`scripts/imagegen.sh`（Codex CLI 调用链，本项目生图后端为官方 text-to-image Skill，不适配）。

## 2. motiful/product-shots（MIT）

| 项 | 内容 |
|---|---|
| 原仓库 | https://github.com/motiful/product-shots |
| License | MIT |
| commit SHA | `063c508b0b7f4db5cda89f10bdf20df25026dfc5`（复用时 main HEAD；与本项目 `skills/product-shots/` 本地快照内容一致，仅换行符差异） |

仅思路借鉴（未复制原文）：Hub/Brief 决策流程、需求理解与路由思想、硬约束/负面约束传播机制（含统一负面 patch 短语）、生成前自检与 QA 门禁思想。见 `brief-and-routing.md`。

完整仓库快照仍保留于本项目 `skills/product-shots/`，**只作只读参考资料，不是活动 Skill**，不再扩展。

## 3. liangdabiao/ecom-details-image（MIT，README 声明）

| 项 | 内容 |
|---|---|
| 原仓库 | https://github.com/liangdabiao/ecom-details-image |
| License | README 声明 MIT；仓库内**无 LICENSE 文件** → 按"授权不完整"处理：只借鉴思路，不复制任何代码或模板原文 |
| commit SHA | `1ec867b743179af3598db55388f65287c4e04de1`（克隆时 main HEAD） |

思路借鉴（重写表述，见 `brief-and-routing.md`）：多图风格锁定（Campaign Style Lock）思想、转化驱动力诊断（视觉/痛点/情感价值）、整套图角度与背景节奏思想。其 25 模板自述派生自 buluslan，故模板直接取自 buluslan 原始仓库。

## 本项目自建部分

| 文件 | 说明 |
|---|---|
| `../SKILL.md` | 薄决策层流程编排（自建） |
| `brief-and-routing.md` | 精简 Brief 结构与规则（思路来自第三方，表述自建） |
| `fidelity.md` | 商品保真层（自建通用增强） |
| `qa-checklist.md` | Agent 多模态 QA 清单（自建） |
