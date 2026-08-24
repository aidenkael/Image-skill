---
name: ecom-shot
description: '全品类电商生图决策层（薄封装）。商品参考图 + 用户需求 → 理解商品 → 从 25 个成熟电商场景模板（来源 buluslan/gpt-image2-ecommerce，MIT）中选择呈现方案 → 生成 Creative Brief → 注入商品保真约束 → 委派官方 text-to-image（qwen-image-3.0-pro）Skill 生图 → Agent 多模态 QA。Use when the user says "生成电商图", "商品主图", "详情页", "场景图", "社媒图", "UGC", "模特图", "平铺图", "product image", "ecommerce image", "listing image" — i.e. any e-commerce image request based on product reference photo(s).'
license: MIT
metadata:
  author: image-skill
  source: thin orchestration layer over buluslan/gpt-image2-ecommerce templates (MIT) + motiful/product-shots ideas (MIT) + liangdabiao/ecom-details-image ideas (MIT)
  skill_id: ecom_shot
  version: "1.0"
---

# ecom-shot（全品类电商生图 · 薄决策层）

本 Skill 是**薄决策层**：不重新发明电商摄影规则。呈现形式（白底、场景、平铺、UGC、模特、editorial、luxury、细节图等）由成熟模板和 Agent 根据商品自动选择；本 Skill 只负责：理解商品 → 选模板 → 出 Brief → 加保真约束 → 委派生图 → QA。

**边界（MUST）**：
- 不直接调用模型 API。生图一律委派官方 Qoder `text-to-image` Skill（qwen-image-3.0-pro），调用方式保持现状不改。
- 不自建品类表 / scene 表 / pose 表 / Visual DNA / 大量 Prompt。模板即规则。
- 不暴露、不写入、不回显任何 API Key。

## 执行流程

```
ecom_shot(reference_images[1..N], user_request) → image(s), qa_report

# Step 1 — 商品与需求理解（Vision pass）
读入全部参考图 + 用户需求，提取：
  - 商品是什么：品类（beauty/electronics/food/fashion/home/jewelry/sports/其他）、外观、材质、卖点
  - 参考图证明了哪些视角与不可变特征 → 见 references/fidelity.md
  - 用户要的用途与风格（主图/详情/社媒/广告；luxury/fresh/tech/minimal/其他）
缺非关键信息 → 明确假设后继续，不阻塞。

# Step 2 — 模板匹配（25 个成熟模板，见下方匹配表）
只读取匹配到的模板文件 references/templates/<file>.json，不加载全部。
无匹配 → 默认 01-hero-image.json。

# Step 3 — Creative Brief（见 references/brief-and-routing.md）
输出精简 Brief：目标 / 商品 / 模板 / 风格变体 / 关键构图 / 负面约束 / 保真约束。
多图任务 → 先建立风格锁定（Style Lock），整套图一致。

# Step 4 — Prompt 组装 + 保真约束注入
1. 取模板 prompt_template，替换 {variables}；用户指定风格 → 应用 variants.<name>.overrides；品类已知 → 应用 category_tips
2. 追加 references/fidelity.md 的保真约束（多参考图共同约束、不可变特征、未知视角禁止）
3. 追加负面约束 patch（见 references/brief-and-routing.md §硬约束传播）
4. 保持 Prompt 精简：只留有值字段，自然语言优先，材质与光线必须写明
模板中如有 anti_ai_tips 字段，对应场景必须遵循（UGC/直播/社媒去 AI 味）。

# Step 5 — 委派生图
调用官方 Qoder text-to-image Skill：
  - 参考图全部传入（多参考图共同约束，保真关键）
  - Prompt 使用 Step 4 组装结果
不改调用方式、不接第二模型、不批量脚本化。

# Step 6 — Agent 多模态 QA（见 references/qa-checklist.md）
对照参考图与 Brief 逐项检查。失败 → 定向修正相关 Brief 字段，重生成一次；仍失败 → 如实报告，不盲目重试。
```

## 模板匹配表（25 个场景）

| 触发词 | 模板文件 |
|---|---|
| 白底图, 主图, hero image, packshot | `01-hero-image.json` |
| 场景图, 生活图, lifestyle | `02-lifestyle-scene.json` |
| 平铺图, flat lay, 俯拍 | `03-flat-lay.json` |
| 细节图, 微距, macro, 特写 | `04-detail-macro.json` |
| 海报, poster, banner, 促销 | `05-poster-banner.json` |
| 社交媒体, 小红书, Instagram, TikTok | `06-social-media.json` |
| UGC, 买家秀, GRWM | `07-ugc-style.json` |
| 模特, model, 人物展示 | `08-model-showcase.json` |
| 对比, before after, 前后 | `09-before-after.json` |
| 包装, packaging, 礼盒 | `10-packaging.json` |
| 信息图, A+, 详情页 | `11-infographic.json` |
| 创意, 概念, creative | `12-creative-concept.json` |
| 尺寸, 规格, 使用步骤 | `13-size-spec.json` |
| 套装, 组合, bundle | `14-multi-product.json` |
| 直播, livestream | `15-livestream.json` |
| 试穿, 融入, try on | `16-try-on-virtual.json` |
| 拆解图, 爆炸图, exploded view | `17-exploded-view.json` |
| 隐形模特, ghost mannequin, 3D服装 | `18-ghost-mannequin.json` |
| 多角度, 网格, grid, 多色展示 | `19-multi-angle-grid.json` |
| 杂志, 封面, editorial, magazine | `20-magazine-editorial.json` |
| 季节, 四季, campaign, 春夏秋冬 | `21-seasonal-campaign.json` |
| 奢华, 氛围, 烟雾, luxury, atmospheric | `22-luxury-atmospherics.json` |
| 设备模型, 界面, mockup, SaaS, APP | `23-device-mockup.json` |
| 店铺, 门面, 空间, storefront, 实体店 | `24-storefront.json` |
| 运动, 健身, sports, fitness | `25-sports-campaign.json` |

呈现形式最终由 Agent 结合商品特性判断：用户未指定时，按商品与用途选最合适的模板，而不是默认白底。

## 参考文件

| 文件 | 内容 |
|---|---|
| `references/templates/*.json` | 25 个电商场景模板（原文保留，来源 buluslan/gpt-image2-ecommerce，MIT） |
| `references/brief-and-routing.md` | Brief 结构、风格锁定、硬约束传播（思路来源 product-shots / ecom-details-image） |
| `references/fidelity.md` | 商品保真层：多参考图共同约束、证据校验、未知即禁止 |
| `references/qa-checklist.md` | Agent 多模态 QA 检查清单 |
| `references/SOURCES.md` | 第三方内容来源记录（仓库/文件/commit/License） |
