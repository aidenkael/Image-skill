---
name: brief-schema
description: Creative Brief 的 11 个必填字段 schema、组装校验门禁、以及把 Brief 渲染为单一 text prompt 的模板（供委派 text-to-image Skill）。
---

# Creative Brief Schema + Render

## Schema（11 必填字段）

```yaml
product_structure:      # 结构描述（轮廓/部件/连接/比例），品类中立
immutable_features:     # 不可变特征列表（颜色/标识/材质/五金/部件数量/比例）
known_views:            # 参考图证明的视角，如 [front(3/4)]
unknown_views:          # 未证明的视角，如 [back, bottom, interior]
interaction_mode:       # 主交互，如 wear-crossbody
person_requirement:     # required-full-body / required-hand-only / optional / none
pose:                   # 姿势描述 + 朝向（known 面朝镜头）+ 避免清单
camera_angle:           # 必须 ∈ known_views，如 front-3/4, eye-level
scene:                  # 主场景 + 1-2 道具
composition:            # 商品占比/焦点/三分线/DoF
fidelity_constraints:   # 正向 keep-exactly 子句 + 负面禁止（含 unknown 禁止）
```

## 组装校验（Step 5 门禁）

```
assert all 11 fields non-empty
assert camera_angle ∈ known_views
assert ∀ u ∈ unknown_views: fidelity_constraints 含对应禁止/遮挡指令
assert ∀ f ∈ immutable_features: fidelity_constraints 含 f
assert pose.朝向 keeps known 面 toward camera
```

## Render → 单一 text prompt（Step 6）

按固定顺序拼装（人物→交互→商品保真→场景→光线→摄影→质量→负面）：

```
[person_requirement + 人物描述], [pose: 自然交互动作, known 面朝镜头],
The product must remain exactly as in the reference image:
{immutable_features 逐条}. {部件数量子句}.
Do not show {unknown_views}; keep unseen sides out of frame / turned away;
no invented details on unseen surfaces.
[scene 主场景 + 道具], [light],
[camera_angle + composition: 商品占比/三分线/DoF],
photorealistic, natural skin texture with pores, film grain,
Avoid: {unified negative patch + pose 避免清单 + immutable 对应禁止}.
```

> 渲染结果 + reference_images 一并委派 `Skill("text-to-image", ...)`。
> I2I 时 reference 第一张 = 主锚图（多参考图时见 evidence-views.md）。
