---
name: evidence-views
description: known_views / unknown_views 判定规则 + 单参考图 vs 多参考图策略 + 防视角猜测规则。camera_angle 只能选自 known_views。
---

# Evidence Views（视角证据与参考图策略）

## known_views / unknown_views 判定

把视角空间离散化为 6 面 + 内部：`front / back / left / right / top / bottom / interior`。

- 某视角在**任一张**参考图中被实质展示（能看到该面的主要特征）→ 进入 `known_views`，并记录该面已证明的特征。
- 否则 → `unknown_views`。
- 斜角图（3/4 view）同时证明两个面的**部分**特征：记为 `front(3/4)` 等，且只把"实际可见部分"算已知，被透视压缩/遮挡的部分仍属未知。

## 单参考图策略（默认场景）

单张图通常只证明 1-2 个面。策略：

1. `camera_angle` **只选** known_views（优先选信息最多的那个，如 front-3/4）。
2. 人物姿势/商品朝向必须让**已知面朝向镜头**（如 "front face with emblem toward camera"）。
3. unknown_views 全部走 hard-constraints §2 的三选一（不出现在画面/转向外侧/被遮挡）。
4. 保真风险高 → fidelity_constraints 加 `no invented details on unseen surfaces`。

## 多参考图策略

1. `known_views` = 各图已知面的**并集**；相机自由度随之扩大。
2. `immutable_features` = 各图提取的**交集校验**：
   - 一致 → 采纳；
   - 冲突（如两图颜色不同）→ 该属性降级为 unknown，向用户澄清，不猜。
3. 选**主锚图**（信息最全、最清晰的一张）作为生图 reference 的第一张；其余作补充视角。
4. 仍遵守：并集之外的视角 = unknown，同样禁止猜测。

## 防猜测规则（No-Guess）

- prompt 中**任何**对商品表面/部件的描述，必须能在 known_views 中找到来源；否则删除该描述或改写为禁止指令。
- QA 阶段用"view overreach"检查兜底（qa-checklist.md §C5）。
