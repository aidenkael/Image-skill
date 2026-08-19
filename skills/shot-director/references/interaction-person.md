---
name: interaction-person
description: 由部件可供性（affordance）推导 interaction_mode（品类中立）；决定 person_requirement；提供 pose 库（含"好看/避免"清单），保证真实使用方式与自然好看的姿势。
---

# Interaction & Person（交互 / 人物 / 姿势）

## Affordance → Interaction（品类中立）

不看品类名，只看**部件可供性**。从 product_structure 的部件清单映射到交互：

| 观察到的部件/可供性 | 推导的 interaction_mode | 真实使用方式 |
|---|---|---|
| 长带（可调、两端锚点） | wear-crossbody / wear-shoulder | 斜挎/单肩，带斜跨躯干，主体贴髋部 |
| 短提手/双提手 | carry-hand | 手提/挽臂 |
| 开口/盖/内胆 | fill-place / open-use | 装入物品、开盖取放 |
| 平面底、无携带件 | place-static | 摆放于台面/架 |
| 按钮/旋钮/屏幕 | operate-hand | 手持操作 |
| 可穿戴环/夹（小件） | wear-body / attach | 佩戴于身体/头发/衣物 |

一个商品可有主+次交互（如包：主 wear-crossbody，次 open-use）。选**主交互**驱动场景/人物/姿势。

## person_requirement

| interaction_mode | person_requirement | 说明 |
|---|---|---|
| wear-* / carry-hand / operate-hand / wear-body | required（full body 或 hand-only 视构图） | 交互需要身体 |
| fill-place / open-use | optional（hand-only 常更自然） | 手部入镜即可 |
| place-static | none / optional | 静物为主 |

默认优先 **full body**（用户目标"完整真人自然使用"），除非构图/占比冲突。

## Pose 库（按 interaction_mode）

每个 pose 给出：物理一致 + 好看 + 不遮挡不可变特征。并附"避免"清单。

### wear-crossbody（斜挎）
- 好看：带从一侧肩斜跨至对侧髋，主体自然贴髋/腰侧；known 面（如带 Logo 的正面）朝外朝镜头；身体微侧、步伐自然。
- 避免：带绕颈/绕臂；带出现两条或打结；主体悬空不贴身；known 面被手臂或身体挡住；主体跑到背后。

### wear-shoulder（单肩）
- 好看：带搭单肩，主体垂于身侧髋部；肩线放松。
- 避免：带滑落到肘；主体前后晃动模糊；双带。

### carry-hand（手提）
- 好看：手指自然握提手，腕部放松，主体垂于身侧或微前。
- 避免：握姿僵硬如拎重物；提手变形/断开；手指穿模。

### place-static（摆放）
- 好看：置于真实台面，接触阴影自然，known 面朝镜头。
- 避免：悬浮无阴影；比例与周围物件失调。

### operate-hand / fill-place / open-use / wear-body
- 好看：手与商品接触点真实（有支撑/受力），动作幅度自然。
- 避免：手悬空不接触；接触点穿模；动作违背物理（如反向开盖）。

## 姿势选择守则

1. pose 必须与 interaction_mode 物理一致。
2. pose 不得遮挡 immutable_features（尤其 Logo/标识面朝向镜头）。
3. pose 的"避免"清单自动并入负面 prompt。
