---
name: crystal
description: '水晶手镯识别展示图（Agent-native，本地合成，0 API 调用）。Agent 自身多模态识别恰好 N 种水晶（忽略金属件）并写出归一化分析 JSON → 本地 crystal.py 用 rembg 提取原始手镯与每类一颗代表珠 → 6 个固定实拍场景之一合成 + 中文名标签 + 接触阴影 → Agent 独立视觉 QA。Use when the user says "识别水晶", "识别珠子", "水晶标注图", "珠子种类展示", "这条有几种珠子", "crystal bracelet", "crystal identification image" — i.e. any request to identify crystal types in a bracelet photo and produce a labeled showcase image.'
license: MIT
metadata:
  author: image-skill
  source: thin orchestration ideas from ecom-shot (fidelity + QA principles); extraction via rembg (u2net); geometry/compositing via OpenCV + Pillow
  skill_id: crystal
  version: "2.0"
---

# crystal（水晶手镯识别展示图 · Agent-native 本地合成）

输入一张手镯照片 + 种类数 N，产出一张 3:4 展示图：原始手镯 + 每类水晶一颗代表珠 + 中文名标签。**识别与 QA 由执行本技能的多模态 Agent 自身完成**；本地 Python 只做像素提取与合成，全程零网络/API 调用，手镯与珠子像素 100% 来自原图。

**边界（MUST）**：
- 本地代码不调用任何模型 API（无生图、无视觉 HTTP 层）。
- 只识别水晶珠子；金属件（隔珠/吊坠/搭扣/转运珠金属件）一律不识别、不标注。
- 标签只写中文水晶市场名；不写标题、营销文案、水印、置信度、"疑似/可能"等措辞。
- 场景固定 6 个（批准实拍资产），Agent 不得新建/生成背景。

## Agent 工作流（严格执行）

```
source image + type_count（缺 type_count 时只问这一个值）
→ Agent 视觉识别恰好 N 种水晶（中文市场名；图像是唯一事实来源；
  光照/反光差异不算不同种类；不确定时给最佳市场名，confidence 仅内部）
→ Agent 为每类独立选一颗最清晰代表珠，给出 bbox_1000（0..1000 归一化）
  与 shape（round/square/faceted/irregular），并给 bracelet_bbox_1000
→ Agent 写临时分析 JSON（如 crystal/tests/outputs/analysis.json）
→ 运行本地合成：
    python crystal/crystal.py --input <图> --types N \
        --analysis <json> --output <result.jpg> --scene auto
→ Agent 视觉对比 SOURCE 与 RESULT，独立复检：
  水晶命名（重新评估，不得把第一轮名称当 ground truth）、代表珠选择、
  手镯完整性、标签文字、构图自然度
→ 若明显错误：修正分析 JSON，本地重跑合成一次（最多一次）
→ 返回成品图（附识别名称清单；如重跑后仍有问题，如实说明）
```

## 分析 JSON 约定

```json
{
  "bracelet_bbox_1000": [x1, y1, x2, y2],
  "crystals": [
    {
      "name": "紫水晶",
      "bbox_1000": [x1, y1, x2, y2],
      "shape": "round",
      "confidence": 0.92
    }
  ]
}
```

- `crystals` 恰好 N 项；坐标 0..1000；`confidence` 仅内部、永不渲染。
- crystal.py 强校验：种类数不符 / 坐标越界 → 退出码 1 并报错。

## 场景表（6 个固定场景，--scene 1-6 确定，auto 随机）

| --scene | 场景 |
|---|---|
| 1 | 米色亚麻珠宝托盘 |
| 2 | 黑色丝绒珠宝托盘 |
| 3 | 浅木桌面 + 亚麻托盘 |
| 4 | 中性石材 + 陶瓷圆盘 |
| 5 | 深色木纹 + 暖色侧光 |
| 6 | 浅灰亚麻 + 陶瓷圆盘 |

## 文件

| 文件 | 内容 |
|---|---|
| `crystal.py` | 唯一 CLI 入口（纯本地） |
| `image_ops.py` | 分析校验 / bbox 转换 / rembg 提取（u2net 会话复用）/ 合成 |
| `scenes.yaml` | 6 场景 3:4 布局配置 |
| `templates/0X.jpg` | 批准的实拍场景资产（1200x1600，可同名替换） |
| `tests/test_mock.py` | 零网络 mock 验证 |

## 保真与 QA 原则（沿用 ecom-shot 思路）

- 图像是唯一商品事实来源：不描述、不生成原图不存在的结构。
- 代表珠必须使用原图像素；合成只做摆放、接触阴影与标签。
- 第二轮视觉 QA 必须独立重新评估命名与选珠，不自我印证第一轮结果。
