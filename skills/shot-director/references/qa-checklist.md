---
name: qa-checklist
description: 生成后商业摄影 QA —— 8 项商业检查（C1-C8）+ AI 错误检查（A1-A5），以及失败→Brief 字段的定向修正映射。不只看 AI 错误，更看"是否卖得动"。
---

# Commercial Photography QA（生成后门禁）

对每张生成图，对照 reference_images 与 brief 逐项检查。商业检查 C1-C8 与 AI 检查 A1-A5 全过才交付。

## 商业检查（C1-C8）

| # | 检查 | 判据 | 失败→修正字段 |
|---|---|---|---|
| C1 | 使用方式真实 | 交互符合 interaction_mode 的真实物理（背法/握法/摆放合理） | pose, interaction_mode |
| C2 | 姿势/背法好看 | 姿势自然美观，无别扭/僵硬/失衡 | pose |
| C3 | 结构未被改 | 轮廓/部件/连接与 reference 一致 | fidelity_constraints（加强 keep-exactly） |
| C4 | 无不存在部件 | 没有多出的带/扣/口袋/Logo（duplicated parts） | fidelity_constraints（部件数量子句） |
| C5 | 镜头未超参考范围 | 画面未展示 unknown_views 的捏造细节 | camera_angle, fidelity_constraints（unknown 禁止） |
| C6 | 真正突出商品 | 商品为焦点、占比达标、known 面朝镜头不被挡 | composition, pose.朝向 |
| C7 | 有购买吸引力 | 场景/光线/氛围让人想要拥有，非杂乱/廉价感 | scene, light |
| C8 | 无一眼假视觉关系 | 无悬浮/错阴影/穿模/比例失调/接触点假 | composition, pose |

## AI 错误检查（A1-A5）

| # | 检查 | 失败→修正 |
|---|---|---|
| A1 | 无多余肢体/手指 | negative patch |
| A2 | 皮肤非塑料/蜡感 | 质量子句（natural skin pores） |
| A3 | Logo/文字未乱码 | fidelity_constraints（标识子句） |
| A4 | 背景非假/过饱和 | scene, light, negative patch |
| A5 | 无水印/假 UI | negative patch |

## 定向修正（Step 8，bounded）

```
failures = [items failing C1-C8 / A1-A5]
if failures:
    fields = union(map_failures_to_brief_fields(failures))
    brief = strengthen(brief, fields)      # 只改相关字段，不重写全部
    regenerate ONCE via text-to-image
    re-run QA; deliver the passing (or better) image
else:
    deliver
```

> 复用 social-post 的"自检门禁 + 失败→修正"思路，但把修正**定位到 Brief 字段**（而非笼统重写 prompt），并限定一次重生成，避免盲目重试。
