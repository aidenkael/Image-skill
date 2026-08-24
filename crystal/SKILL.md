---
name: crystal
description: '水晶手镯识别展示图生成（本地合成，0 次生图 API）。输入一张手镯图 + 珠子种类数 N → Qwen 视觉识别恰好 N 种水晶（忽略金属件）→ 本地提取原始手镯与每类一颗代表珠 → 固定实拍场景合成 + 中文名标签 + 接触阴影 → Qwen 视觉 QA。Use when the user says "识别水晶", "识别珠子", "水晶标注图", "珠子种类展示", "这条有几种珠子", "crystal bracelet", "crystal identification image" — i.e. any request to identify crystal types in a bracelet photo and produce a labeled showcase image.'
license: MIT
metadata:
  author: image-skill
  source: thin orchestration ideas from ecom-shot (fidelity + QA principles); extraction via rembg; geometry/compositing via OpenCV + Pillow
  skill_id: crystal
  version: "1.0"
---

# crystal（水晶手镯识别展示图 · 本地合成）

输入一张手镯照片 + 种类数，产出一张"原始手镯 + 每类水晶一颗代表珠 + 中文名标签"的实拍风格展示图。**不重绘、不重建商品**：手镯与珠子像素 100% 来自原图；运行时 0 次图像生成 API，恰好 2 次 Qwen 视觉调用（识别 + QA）。

**边界（MUST）**：
- 不调用任何生图/修图 API（禁止 Qwen Image / Qwen Image Edit）。
- 只识别水晶珠子；金属件（隔珠/吊坠/搭扣）一律不识别、不标注。
- 标签只写中文水晶市场名，不写标题、营销文案、水印、置信度、"疑似/可能"等措辞。
- API Key 只从 `.env` 的 `DASHSCOPE_API_KEY` 读取，不暴露、不回显。

## Agent 交互

输入：参考图（必需）、type_count（必需）、场景（可选，默认 auto）。

- 用户只给了图 → **只问种类数**，例如："这条手链有几种水晶？"
- 不要向用户询问水晶名称；名称由 Qwen 视觉识别。
- 典型对话："这条有3种珠子，生成识别展示图" → 直接执行。

## 执行流程

```
crystal(reference_image, type_count, scene="auto") → image, qa_report

# Step 1 — 运行 CLI（仓库根目录执行）
python crystal/crystal.py \
  --input <用户图片路径> \
  --types <type_count> \
  --output crystal/tests/outputs/result.jpg \
  --scene auto        # 或 1-6 指定场景

# Step 2 — 读取结果
- 退出码 0：成功，把输出图片交给用户，并列出识别出的中文名
- 退出码 2：QA 未通过。图片已保存，向用户展示图片 + QA 问题清单，
  请用户确认；不自动重试、不自动重生成
- 退出码 1：输入错误（图片不存在 / 参数非法），提示用户修正

# Step 3 — 识别失败处理
仅当 Qwen 无法给出名称（返回"未知水晶"）时，才向用户确认该珠子名称；
否则不问。
```

## 场景表（6 个固定场景）

| --scene | 场景 |
|---|---|
| 1 | 米色亚麻珠宝托盘 |
| 2 | 深色丝绒珠宝托盘 |
| 3 | 浅木桌面 + 亚麻布 |
| 4 | 中性石材 + 象牙白展示台 |
| 5 | 深色木纹 + 暖色侧光 |
| 6 | 浅灰织物 / 陶瓷展示面 |
| auto | 随机挑选（默认） |

## 文件

| 文件 | 内容 |
|---|---|
| `crystal.py` | 唯一 CLI 入口 |
| `vision.py` | Qwen 视觉：identify() / qa() |
| `image_ops.py` | rembg 提取、场景选择、OpenCV/Pillow 合成 |
| `scenes.yaml` | 6 个固定场景布局配置 |
| `templates/0X.jpg` | 场景底图（可直接替换为实拍图，无需改代码） |
| `make_templates.py` | 底图确定性生成脚本（可重跑） |

## 保真与 QA 原则（沿用 ecom-shot 思路）

- 图片是唯一商品事实来源：不描述、不生成参考图不存在的结构。
- 代表珠必须使用原图像素；合成只做摆放、接触阴影与标签。
- 成图后必须与原图对照做视觉 QA；QA 失败如实报告，不盲目重试。
