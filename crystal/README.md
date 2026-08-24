# crystal — 水晶手镯识别展示图（Agent-native）

一张手镯图 + 种类数 N → 一张 3:4 展示图：原始手镯 + 每类水晶一颗代表珠 + 中文名标签。

- **识别与 QA 由执行技能的多模态 Agent 自身完成**；本地 Python 零网络/API 调用
- 手镯与代表珠像素 100% 来自原图（rembg u2net 提取，会话复用），不重绘、不重建
- 金属件不识别、不标注；标签只写中文水晶市场名
- 6 个批准的固定实拍场景（3:4），`--scene 1-6` 确定、`auto` 随机

## 安装

```bash
pip install -r crystal/requirements.txt
```

无需任何 API Key。首次运行时 rembg 会缓存 u2net 模型到用户目录（不进仓库）；
可用环境变量 `CRYSTAL_REMBG_MODEL` 覆盖模型名。

## 使用

Agent 先对原图做视觉分析，写出分析 JSON（坐标 0..1000 归一化）：

```json
{
  "bracelet_bbox_1000": [x1, y1, x2, y2],
  "crystals": [
    {"name": "紫水晶", "bbox_1000": [x1, y1, x2, y2], "shape": "round", "confidence": 0.92}
  ]
}
```

然后本地合成：

```bash
python crystal/crystal.py \
  --input path/to/source.jpg \
  --types 3 \
  --analysis analysis.json \
  --output crystal/tests/outputs/result.jpg \
  --scene auto        # 或 1-6
```

退出码：`0` 成功；`1` 输入/校验错误。合成后由 Agent 独立视觉 QA，必要时修正
分析 JSON 并重跑一次。

## 目录

```
crystal/
├── SKILL.md           Agent 技能入口（工作流 + 分析约定）
├── crystal.py         唯一 CLI（纯本地）
├── image_ops.py       校验 / bbox 转换 / rembg 提取 / 合成
├── scenes.yaml        6 场景 3:4 布局
├── templates/         批准的实拍场景资产（1200x1600）
└── tests/             test_mock.py / samples / outputs（outputs 不进 Git）
```
