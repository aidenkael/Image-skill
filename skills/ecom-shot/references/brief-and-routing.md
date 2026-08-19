---
name: brief-and-routing
description: ecom-shot 的 Creative Brief 结构、多图风格锁定（Style Lock）与硬约束传播规则。思路来源：motiful/product-shots（Hub/Brief/硬约束传播，MIT）与 liangdabiao/ecom-details-image（风格锁定/转化驱动，MIT），均为思路级借鉴，非原文复制。
---

# Brief 与路由（薄版本）

## Creative Brief 结构（单图）

生成前必须输出精简 Brief（给用户可见，便于纠偏）：

| 字段 | 说明 |
|---|---|
| goal | 这张图要达成什么（主图/详情/社媒/广告/种草） |
| product | 商品一句话描述 + 材质 + 卖点（来自 Step 1 理解） |
| template | 使用的模板文件 + 场景类型 |
| variant | 风格变体（luxury/fresh/tech/minimal/其他），未指定则不用 |
| composition | 构图、角度、商品占比、留白 |
| fidelity | 保真约束摘要（指向 references/fidelity.md 的具体条款） |
| negative | 负面约束 patch |
| assumptions | 明确做出的假设 |

规则：
1. 分析先于生成 —— 没完成 Step 1 证据提取，不允许出 Brief。
2. 最小澄清 —— 默认自动决策；只有影响硬约束且参考图无法回答的字段才问用户，一次只问一个维度，最多 2 轮。
3. Brief 锁定后才渲染 Prompt —— 渲染阶段不改决策，只翻译成 Prompt。

## 硬约束传播（MUST）

以下负面 patch 必须追加到**每一条** Prompt，不允许省略：

```
social media UI, screenshot, watermark, messy background, distorted text,
phone frame, app interface, extra logo, duplicated parts, invented product features
```

保真约束（references/fidelity.md）与模板的 anti_ai_tips 同样属于硬约束，逐级传播到 Prompt 与 QA，任何环节不得丢弃。

## 多图风格锁定（Style Lock）

当任务是整套图（主图组 / 详情页 / 社媒组图）时，先写一段 Style Lock，原样放进每张 Prompt 开头，不得逐张改写：

- 固定色板：2-3 主色 + 1 强调色，写明具体颜色（hex 或明确描述），禁止每张图重新配色
- 冷暖调统一（warm / cool / neutral）
- 背景系统统一（材质、深浅、空间感）
- 光线系统统一（光源方向、阴影强度）
- 商品呈现稳定（角度风格、比例、材质表现）
- 显式禁止漂移：色板变化、背景随机、光线不一致

同时保证节奏：整套图不全部使用同一拍摄角度，按模板 examples 分配不同角度/景别；连续多图时背景可在 Style Lock 内定的 2-3 种之间交替，避免视觉疲劳。

## 转化驱动力（商品/营销任务）

为商品主图、详情页、广告选图序列前，先判断一种主要驱动力，据此决定图片序列重点（思路来源 ecom-details-image）：

- **视觉驱动**（外观/质感/礼品属性）：质感特写、场景氛围、一眼可见的吸引力
- **痛点驱动**（解决明确麻烦/风险）：问题 → 机制 → 利益证明 → 信任 → CTA
- **情感价值驱动**（身份/归属/情绪）：情绪钩子、生活方式、社交信号

多图序列中每一张都从 25 模板中选取最合适的模板，允许混合（如主图 01 + 特写 04 + 场景 02 + 对比 09）。
