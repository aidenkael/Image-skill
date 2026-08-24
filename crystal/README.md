# crystal — 水晶手镯参考图技能

输入一张手镯实拍图 + 种类数 N，输出一张"人工摆拍 + 手工标注"感的珠宝参考照片：
完整手镯为主体，N 颗同物理尺寸的代表珠（像从手镯取下）自然散落其旁，小字楷体中文注记（可带细引线）。

## 主流水线（生成式编辑）

```
源图清理裁剪 → Agent 识别 N 类 + 代表珠 → 珠子参考页
→ 一次 qwen 图像编辑调用（清理源图 + 参考页 + templates/04.jpg）
→ 本地 Pillow 编辑式标注 → 成品图
```

旧 rembg 本地抠图合成已移除（贴纸感/机械底排/膜状暗边，方向错误）。

## 安装

```
pip install -r crystal/requirements.txt
```

凭证经 `.env`/环境变量（不硬编码）：仅 `DASHSCOPE_API_KEY`，无其他回退；
端点解析：`DASHSCOPE_API_URL` 优先，`sk-sp-` key 走 Token Plan 端点（见根 `.env.example`），否则 DashScope 标准端点；
可选 `QWEN_EDIT_MODEL`（默认 qwen-image-3.0-pro，回退 qwen-image-2.0-pro）。

## 用法

```
# 1) Agent 识别后写 analysis.json（bracelet_bbox_1000 + 恰好 N 个 crystals，均为手镯上的珠类）
python crystal/crystal.py run --input src.jpg --types 3 \
    --analysis analysis.json --output candidate.png

# 2) Agent 目视 QA 候选图后写 labels.json（小字就近标注，可选 point_to 引线）
python crystal/crystal.py label --input candidate.png \
    --labels labels.json --output final.png
```

## 结构

| 文件 | 内容 |
|---|---|
| `crystal.py` | 唯一运行时入口（run / label） |
| `SKILL.md` | Agent 工作流与风格约束 |
| `templates/04.jpg` | 当前唯一批准场景模板 |
| `tests/test_crystal.py` | 本地验证（无网络） |

## 测试

```
python crystal/tests/test_crystal.py
```
