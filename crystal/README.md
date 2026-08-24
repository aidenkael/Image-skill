# crystal — 水晶手镯识别展示图

最小生产向技能：一张手镯图 + 种类数 N → 一张"原始手镯 + 每类水晶一颗代表珠 + 中文名标签"的实拍风格展示图。

- **运行时 0 次图像生成 API**，恰好 **2 次 Qwen 视觉调用**（识别 + QA）
- 手镯与代表珠像素 100% 来自原图（rembg 提取），不重绘、不重建
- 金属件不识别、不标注；标签只写中文水晶市场名
- 6 个固定实拍场景，轻微随机摆放，接触阴影自然贴合

## 安装

```bash
pip install -r crystal/requirements.txt
```

配置 `.env`（仓库根，勿提交）：

```bash
DASHSCOPE_API_KEY=sk-...
# 可选：
# QWEN_VL_MODEL=qwen-vl-max
# QWEN_VL_API_URL=...
```

## 使用

```bash
python crystal/crystal.py \
  --input path/to/source.jpg \
  --types 3 \
  --output crystal/tests/outputs/result.jpg \
  --scene auto        # 或 1-6
```

退出码：`0` 成功；`2` QA 未通过（图片与 `*.qa.json` 已保存）；`1` 输入错误。

首次运行时 `rembg` 会自动下载轻量分割模型（u2net，缓存在用户目录 `~/.u2net`，不进仓库）。

## 流程

```
INPUT IMAGE → Qwen 识别 N 种水晶(中文名+代表珠坐标) → 本地提取原手镯/代表珠(rembg)
→ 选 1/6 固定场景 → OpenCV/Pillow 合成(阴影+中文名标签) → Qwen 视觉 QA → 输出
```

## 场景模板

`templates/0X.jpg` 为确定性生成的中性实拍风格底图（见 `make_templates.py`），随时可用真实摄影图替换同名文件，无需改代码。

## 目录

```
crystal/
├── SKILL.md           Agent 技能入口
├── crystal.py         唯一 CLI
├── vision.py          identify() / qa()
├── image_ops.py       提取 / 场景 / 合成
├── scenes.yaml        6 场景布局
├── templates/         场景底图
├── make_templates.py  底图生成脚本
└── tests/             samples / outputs（outputs 不进 Git）
```

## 说明

- MobileSAM / SAM2 为可选升级方向，MVP 不依赖；当前几何掩码兜底已满足需求。
- 识别不确定时内部保留 `confidence`，但永不渲染到图片上。
