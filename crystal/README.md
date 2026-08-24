# crystal — 水晶手镯参考图技能

输入一张手镯实拍图，输出一张"人工摆拍 + 手工标注"感的珠宝参考照片：
完整手镯为主体，每组视觉可区分的非金属珠/石/珍珠组件（bead_groups）各取一个代表件，
由 `wan2.7-image-pro` 的 `bbox_list` 逐件精准插入场景（每件恰好一次调用），
小字楷体中文注记（可带细引线）。

## 主流水线（planned multi-stage, zero-retry）

```
fresh analysis
→ base scene: 1 Wan call（完整手镯 + 空场景，不生成任何散珠）
→ Agent writes placements once（每组恰好一个摆放框）
→ N bbox insertions: exactly 1 Wan call per representative
→ final QA
→ Pillow label once
```

多次调用是有意设计的阶段，不是重试：散珠数量由"每组恰好一个插入阶段"结构性保证；
任一阶段失败即返回失败，不自动再生成；标注前成本 = `1 + N` 次图像模型调用。

已移除的旧路径：一次性多参考图合成（多身份压缩进一次调用，逐件保真失败）、
qwen-image-3.0-pro contact sheet（3 张输入图上限迫使身份压缩进一张参考页）、
rembg 本地抠图合成（贴纸感/机械底排/膜状暗边，方向错误）。

## 安装

```
pip install -r crystal/requirements.txt
```

凭证经 `.env`/环境变量（不硬编码）：仅 `DASHSCOPE_API_KEY`，无其他回退；
端点解析：`DASHSCOPE_API_URL` 优先，`sk-sp-` key 走 Token Plan 端点（见根 `.env.example`），
非 Token Plan 凭证且未配置 `DASHSCOPE_API_URL` 时直接失败（不猜测 Wan workspace 端点）；
Crystal 图像模型：`CRYSTAL_IMAGE_MODEL`（默认 `wan2.7-image-pro`；失败即失败，不回退重试；
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
#    组数 = 当前源图新鲜判定（不硬编码、不复用历史运行）

# 2) base 阶段：恰好一次场景生成（无散珠），代表件裁剪留存 workdir
python crystal/crystal.py base --input src.jpg \
    --analysis analysis.json --output base.png --workdir work

# 3) Agent 目视 base 图后一次性写 placements.json：
#    每组恰好一个框，reference_index 1..N 各一次，0..1000 归一化，
#    不压手镯、不刻意重叠、框尺寸匹配组件真实尺度、手工摆放感（非行/网格/等距/弧线）

# 4) compose 阶段：按 reference 顺序每件恰好一次插入调用（顺序串行，非重试）
python crystal/crystal.py compose --input base.png --source src.jpg \
    --analysis analysis.json --placements placements.json \
    --output candidate.png --workdir work

# 5) Agent 目视 QA 候选图后写 labels.json（小字就近标注，可选 point_to 引线）
python crystal/crystal.py label --input candidate.png \
    --labels labels.json --output final.png
```

## 结构

| 文件 | 内容 |
|---|---|
| `crystal.py` | 唯一运行时入口（base / compose / label） |
| `SKILL.md` | Agent 工作流与风格约束 |
| `templates/04.jpg` | 当前唯一批准场景模板 |
| `tests/test_crystal.py` | 本地验证（无网络） |

## 测试

```
python crystal/tests/test_crystal.py
```
