# crystal — 水晶手镯参考图技能

输入一张手镯实拍图 + 种类数 N，输出一张"人工摆拍 + 手工标注"感的珠宝参考照片：
完整手镯为主体，N 组视觉可区分的非金属珠/石/珍珠组件（bead_groups）各取一个代表件，
每组一张独立参考图直传模型（保留相对物理尺度与组间相对尺寸关系，不放大不缩小），小字楷体中文注记（可带细引线）。

## 主流水线（wan2.7-image-pro 多参考图）

```
源图清理裁剪 → Agent 识别 N 组 → 每组独立代表参考图
→ 一次 wan2.7-image-pro 编辑调用（Image1 完整手镯 + Images 2..N+1 独立参考 + 最后模板 04）
→ Agent 视觉 QA → 本地 Pillow 编辑式标注 → 成品图
```

旧 rembg 本地抠图合成已移除（贴纸感/机械底排/膜状暗边，方向错误）；
旧 qwen-image-3.0-pro contact sheet 路径已移除（3 张输入图上限迫使多身份压缩进一张参考页，
逐组一对一保真失败；wan2.7-image-pro 支持最多 9 张输入图，改为每组独立参考图直传）。

## 安装

```
pip install -r crystal/requirements.txt
```

凭证经 `.env`/环境变量（不硬编码）：仅 `DASHSCOPE_API_KEY`，无其他回退；
端点解析：`DASHSCOPE_API_URL` 优先，`sk-sp-` key 走 Token Plan 端点（见根 `.env.example`），
非 Token Plan 凭证且未配置 `DASHSCOPE_API_URL` 时直接失败（不猜测 Wan workspace 端点）；
Crystal 图像模型：`CRYSTAL_IMAGE_MODEL`（默认 `wan2.7-image-pro`；single-pass，失败不回退重试；
不使用 `QWEN_EDIT_MODEL`，那是 ecom-shot 的配置）。

## 用法

```
# 1) Agent 识别后写 analysis.json：
#    bracelet_bbox_1000 = 完整可见手镯产品范围（含金属配件，排除包装/托盘/手/纸张）；
#    bead_groups = 手镯上视觉可区分的非金属珠/石/珍珠组件（物理上属于该手镯）：
#    允许透视/光照/珠间自然差异后设计层面可见身份仍等价才同组；几何/物理尺寸/颜色/透明度/
#    内含物/纹理/表面任一出现清晰可见设计差异，MUST 分为不同组；
#    每组 {"display_name": 中文标注名, "visual_identity": 可见外观自由文本, "representative_bbox_1000": 代表矩形}，无 group_id；
#    display_name 只用于标注，绝不进入生成 Prompt
#    --types 可选：提供则强校验组数；缺省用当前分析的新鲜组数
#    直接多参考图路径最多支持 7 个 bead_groups（9 张输入图上限 - 手镯 - 模板）
python crystal/crystal.py run --input src.jpg [--types N] \
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
