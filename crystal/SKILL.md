---
name: crystal
description: 水晶手镯参考图——清理裁剪 + Agent 识别 + 珠子参考页 + 一次生成式编辑 + 本地编辑式标注。
---

# crystal 技能

输入：一张手镯实拍图 + 水晶种类数 N。输出：一张像"人工摆拍并手工标注的珠宝参考照片"的成品图。

## 主流水线（生成式编辑，唯一主路径）

```
源图 → 清理裁剪（紧圈手镯，排除包装/手/纸张）
     → Agent 识别恰好 N 类水晶 + 每类选一颗代表珠
     → 珠子参考页（同一源图矩形原始裁剪、公共比例保留相对尺寸，左→右）
     → 一次 qwen 图像编辑调用（清理源图 + 参考页 + 固定场景模板 04）
     → 本地 Pillow 编辑式标注（小字楷体 + 可选细引线）
     → 成品图
```

不使用 rembg/SAM/本地抠图合成做主路径：半透明水晶在杂乱实拍下抠图必然带膜状暗边/纸张残留，
且本地合成只能产出贴纸感与机械底排，与目标风格根本冲突。

## Agent 工作流

1. **目视识别**：恰好 N 类水晶珠类，且只统计物理位于手镯环体上的珠子（`type_count` = 手镯上恰好 N 种）；
   金属隔珠/银饰忽略；包装、说明纸、消磁碎石袋、散石及背景中任何类水晶物体不得计为一类、不得污染识别。
   分组依据（通用视觉结构，非个案补丁）：由「形状 + 相对尺寸档 + 材质/色族 + 内部纹理」的可见组合决定；
   同色族但形状或尺寸档不同的珠必须分为不同组（如 round vs square/faceted、small round vs large round、
   translucent vs opaque）。
   代表珠选择：优先手镯上清晰可见、无遮挡、无金属覆盖的该类型珠；裁剪必须来自手镯环体本身，不合成被遮挡/隐藏的水晶面。
2. **写 `analysis.json`**（0..1000 归一化坐标，严格 schema）：
   - `bracelet_bbox_1000` 紧圈手镯环体（排除手、包装盒、纸张）；
   - `bead_groups` 恰好 N 项：`{"group_id", "label_name": 中文市场名, "shape": round|square|faceted|barrel|other,
     "size_tier": small|medium|large, "color_family", "material_traits", "representative_bbox_1000": 代表珠矩形}`；
   - 代表珠矩形必须落在 `bracelet_bbox_1000` 内（代码强校验，杜绝包装/散石/背景污染）；
   - 名称不写“疑似/可能”等措辞（代码会清洗）。
3. **运行**：`python crystal/crystal.py run --input 原图 --types N --analysis analysis.json --output candidate.png`
   （内部：新鲜 analysis 校验 → 清理裁剪 → 新鲜参考页 → 一次编辑调用；single-pass，不自动重试、不换模型重跑）。
4. **独立目视 QA** 候选图：手镯保真、恰好 N 颗散珠、与参考页一一对应、布局自然（非机械底排）、
   无文字。不可用则如实报告，不自动重跑生成。
5. **写 `labels.json`**：按生成图中散珠实际摆放就近放名——小字、克制、错落而非居中对齐；
   可选 `point_to` 细引线指向对应散珠（编辑/手写注记感）。
6. **运行**：`python crystal/crystal.py label --input candidate.png --labels labels.json --output final.png`，返回成品。

## 风格约束（已内置于编辑 Prompt）

- 完整手镯为主体；散珠与手镯对应珠同物理尺寸（像从手镯取下摆在一旁），仅允许轻微透视差异，
  不放大成英雄主体、不故意缩小；代表珠自然摆放在手镯旁（不对称、自然间距、舒适留白，
  像人工摆拍），不规定单一固定几何布局；参考页不暗示不同珠类物理尺寸相同；
- 禁止刚性居中直排/等距机械布局；禁止信息图/海报感；
- 生成阶段不产生任何文字；标注阶段仅渲染 N 个中文名，无标题/副标题/营销文案/水印。

## 凭证与模型

- 凭证仅经 `.env`/环境变量 `DASHSCOPE_API_KEY`，无其他凭证回退；
- 端点：`DASHSCOPE_API_URL` 优先；否则 key 以 `sk-sp-` 开头用 Token Plan 端点（见根 `.env.example`），其余用 DashScope 标准端点；
- 模型：`QWEN_EDIT_MODEL` 可覆盖，默认 `qwen-image-3.0-pro`；single-pass，失败不回退重试（退出码 2，如实报告）。

## 资产

- `templates/04.jpg` 为当前唯一批准场景模板（`--template` 可换，但先保证单场景正确）。

## single-pass 约束

- 每次调用：一次新鲜 analysis 校验、一张新鲜参考页、一次图像生成调用、一次标注 pass；
- 无生成重试、无对比重跑循环、不复用上次运行的旧 analysis；
- 质量不达标由 Agent 如实报告，代码层不自动重跑。

## 退出码

0 成功；1 校验/本地错误；2 编辑调用失败（不自动重试）。
