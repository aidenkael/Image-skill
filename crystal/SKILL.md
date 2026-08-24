---
name: crystal
description: 水晶手镯参考图——清理裁剪 + Agent 识别 + base 场景生成 + 一次性摆放规划 + wan2.7-image-pro bbox 逐件插入 + 本地编辑式标注。
---

# crystal 技能

输入：一张手镯实拍图。输出：一张像"人工摆拍并手工标注的珠宝参考照片"的成品图。

## 主流水线（planned multi-stage, zero-retry，唯一主路径）

```
fresh analysis
→ base scene: 1 Wan call
→ Agent writes placements once
→ N bbox insertions: exactly 1 Wan call per representative
→ final QA
→ Pillow label once
```

多次调用是**有意设计的阶段**，不是重试：每件代表件由一次独立的
`bbox_list` 插入调用精准放入场景，散珠数量由"每组恰好一个插入阶段"结构性保证。
任一阶段失败即返回失败（退出码 2），不自动再生成、不换模型、不回退。
标注前总成本 = `1 + N` 次图像模型调用。

不使用：一次性多参考图合成（多身份压缩进一次调用，逐件保真失败，已删除）、
rembg/SAM/OpenCV 本地抠图合成、contact sheet、生成重试/候选对比/回退模型。

## Agent 工作流

1. **目视识别**：手镯上视觉可区分的非金属珠/石/珍珠组件分组（组数 = 当前源图新鲜判定，
   不硬编码、不复用历史运行）；金属隔珠/帽/包边/配件不计为珠组，但仍属完整手镯、必须在生成中保留；
   包装、托盘、说明纸、消磁碎石袋、散石及背景中任何类水晶物体不得计为一组、不得污染识别。
   分组定义（通用可见身份，非个案补丁）：`bead_groups` = 手镯上视觉可区分的非金属珠/石/珍珠材质组件
   （物理上属于该手镯）。两个组件仅在允许透视、光照/反射、珠间自然微小差异后设计层面的可见身份仍等价时
   属于同一组；几何/形状、标称物理尺寸、颜色/光学外观、透明度/不透明度、特征纹理/内含物/表面外观
   任一出现清晰可见的设计层面差异，MUST 分为不同组（不用"可分开"等模糊措辞，不引入枚举/分类表）。
   每组以自由文本 visual_identity 描述（几何/相对物理尺寸/颜色/透明度/内含物/纹理/表面特征），无枚举限制。
   代表珠选择：优先手镯上清晰可见、无遮挡、无金属覆盖的该组珠；裁剪必须来自手镯本身，不合成被遮挡/隐藏的水晶面。
2. **写 `analysis.json`**（0..1000 归一化坐标）：
   - `bracelet_bbox_1000` 完整可见手镯产品范围：包含手镯自有的珠/石/珍珠、金属包边、隔珠、连接件、
     吊坠/挂饰；仅排除外包装、托盘、纸张、手及无关背景物体；
   - `bead_groups`：`{"display_name": 中文标注名, "visual_identity": 自由文本可见身份描述,
     "representative_bbox_1000": 代表珠矩形}`（无 group_id）；
   - `visual_identity` 只写可见外观，不写矿物/宝石名、不写 display_name；
   - `display_name` 仅用于最终 Pillow 标注，绝不进入生成 Prompt（猜测的矿名不得污染生成）；
   - 代表矩形紧凑包含该组完整可见代表件、保留最小上下文、不得切穿组件；
     代表矩形落在 `bracelet_bbox_1000` 内仅为坐标 sanity check；物理归属手镯是本步视觉分析职责；
   - 名称必须提供最终中文市场名，空白或含"疑似/可能"等不确定措辞会被显式拒绝（代码抛错，不静默兜底）。
3. **base 阶段**：`python crystal/crystal.py base --input 原图 --analysis analysis.json --output base.png --workdir work`
   （内部：新鲜 analysis 校验 → 清理裁剪 → 每组独立代表件裁剪留存 workdir → 恰好一次场景生成调用；
   base 图只有完整手镯与场景，**不生成任何散珠**，不传任何代表参考图）。
4. **目视 base 图后写 `placements.json`**（一次性决定全部摆放框，不为试验摆位生成图像）：
   ```json
   {"placements": [{"reference_index": 1, "bbox_1000": [x1, y1, x2, y2]}, ...]}
   ```
   - 每组恰好一个框；`reference_index` 从 1 起对应 `bead_groups` 顺序，1..N 各恰好一次；
   - 坐标为当前 3:4 画布上的 0..1000 归一化值，`x1<x2 且 y1<y2`；
   - 框不得压住主手镯、不得刻意相互重叠；
   - 框的物理尺寸须匹配该组手镯组件的真实尺度；
   - 手工摆放感：不对称、自然间距，禁止行/网格/等距/固定弧线模板。
5. **compose 阶段**：`python crystal/crystal.py compose --input base.png --source 原图 --analysis analysis.json --placements placements.json --output candidate.png --workdir work`
   （内部：校验 analysis + placements → 确定性重建代表件裁剪 → 按 reference 顺序每件恰好一次
   `wan2.7-image-pro` `bbox_list` 插入调用：Image 1 = 单件代表参考，Image 2 = 当前画布，
   bbox 只在 Image 2 上、恰好一个选中区域；顺序串行是生产流水线，不是重试循环）。
6. **独立目视 QA** 候选图：手镯保真、恰好 N 颗散珠、每件源身份恰好出现一次（无重复/遗漏/替换）、
   相对物理尺度正确、布局自然手工感、无生成文字、无明显局部编辑接缝、先插入的代表件在后续插入后仍完好。
   不合格则如实报告失败发生在哪个确定性阶段，不重试、不调参重跑。
7. **写 `labels.json`**：按成品图中散珠实际位置就近放名——小字、克制、错落而非居中对齐；
   可选 `point_to` 细引线指向对应散珠（编辑/手写注记感）。
8. **运行**：`python crystal/crystal.py label --input candidate.png --labels labels.json --output final.png`，返回成品。

## 架构约束

- 不再有组数上限：逐件插入每次只传 2 张图（代表件 + 画布），与输入图数量上限无关；
- 输入图最低分辨率（≥240x240）：完整手镯裁剪与代表件裁剪短边不足时自动放大（不缩小）；
- 插入尺寸跟随画布实际像素（`w*h`），保证多步插入坐标一致。

## 风格约束（已内置于 BASE/INSERT Prompt）

- base：完整手镯自然置入场景，保留全部珠/石/珍珠/金属件的几何、顺序、相对尺度、颜色、透明度、
  内含物与表面特征；不增删合并替换重设计任何手镯组件；为后续散珠预留自然留白；本步不生成任何散珠；
- insert：只编辑选中区域；恰好一件、身份保真（几何/颜色/透明度/内含物/纹理/表面）、
  尺度匹配选中区域与在场手镯；正确接触阴影/局部反射/场景光照，无悬浮、无抠图贴纸边；
  不改变手镯、不改变已放置的代表件、不加任何其他物体；
- 生成阶段不产生任何文字；标注阶段仅渲染 N 个中文名，无标题/副标题/营销文案/水印。

## 校验

- 归一化 bbox（bracelet_bbox_1000、代表矩形、摆放框）都必须满足 `x1 < x2 且 y1 < y2`：
  反向/零面积矩形抛 ValueError，不静默修复；
- `placements` 数量必须等于组数、`reference_index` 恰好覆盖 1..N（缺失/重复/越界抛错）、
  校验后按 1..N 排序；不做自动布局生成；
- 名称空白或含"疑似/可能/大概/或许"等不确定措辞 → 抛错，不静默变成"未知水晶"。

## 凭证与模型

- 凭证仅经 `.env`/环境变量 `DASHSCOPE_API_KEY`，无其他凭证回退；
- Crystal 图像模型：`CRYSTAL_IMAGE_MODEL` 可覆盖，默认 `wan2.7-image-pro`；不使用 `QWEN_EDIT_MODEL`
  （那是 ecom-shot 的配置，与 Crystal 无关）；
- planned multi-stage, zero-retry：阶段失败即失败（退出码 2），无生成重试、无候选对比、无回退模型；
- 端点：`DASHSCOPE_API_URL` 优先；否则 key 以 `sk-sp-` 开头用 Token Plan 端点（见根 `.env.example`）；
  非 Token Plan 凭证且未显式配置 `DASHSCOPE_API_URL` 时直接失败（拒绝猜测 Wan workspace 端点）；
- wan2.7-image-pro 不传 `prompt_extend`；base `size` 保持 3:4（`1200*1600`）。

## 资产

- `templates/04.jpg` 为当前唯一批准场景模板（`--template` 可换，但先保证单场景正确）。

## 零重试口径

- 每次运行：一次新鲜 analysis、一次 base 调用、一次性全部摆放框、每组恰好一次插入调用、一次标注 pass；
- 无生成重试、无对比重跑循环、无回退模型、不复用上次运行的旧 analysis；
- 质量不达标由 Agent 如实报告失败阶段，代码层不自动重跑。

## 退出码

0 成功；1 校验/本地错误；2 图像调用失败（不自动重试）。
