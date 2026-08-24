---
name: fidelity
description: 商品保真层（通用增强，非物理规则引擎）：多参考图共同约束、不可变特征、证据校验、未知即禁止、禁止凭空新增结构。生成结果必须与参考图做视觉 QA。
---

# 商品保真约束（Fidelity Constraints）

这是 ecom-shot 唯一自建的通用增强层。目标是让生成结果"还是这个商品"，不发展成复杂规则引擎。

## 1. 证据校验（生成前必做）

读入全部参考图，提取两类信息：

- **known_views**：参考图实际证明的视角与细节（正面/侧面/背面/内部/底部……以图为准）
- **immutable_features**：不可变特征 —— 颜色、Logo 与标识、图案/印花、材质质感、比例、关键部件及其数量与连接方式

提取结果写入 Brief 的 fidelity 字段，并进入 Prompt。

## 2. 多参考图共同约束

- 所有参考图**全部**传给生图 Skill，作为同一商品的共同约束；不得只传其中一张而丢弃其余视角信息。
- 多张参考图信息冲突时（如角度不同），以"同一商品的不同视角"理解，不做取舍猜测；确实矛盾（不同商品）时向用户确认。

## 3. 未知即禁止（Unknown = forbidden）

参考图没有证明的视角/部件/细节（如背面、底部、内部结构），Prompt 中：

- 不描述、不让模型猜
- 若构图必须涉及，要求其转向外侧 / 被遮挡 / 不出现在画面

## 4. 不可变即硬约束

immutable_features 全部写入 Prompt 的保真子句，例如：

```
Keep the product exactly as in the reference images: identical color, logo, pattern,
material texture, proportions, and all visible components. Do not add, remove, or
rearrange any parts.
```

## 5. 禁止凭空新增结构

不允许生成中出现参考图不存在的明显商品结构（多出的带/扣/口袋/按键/Logo/配件）。该项同时进入负面约束（`extra logo, duplicated parts, invented product features`）。

## 6. 生成后视觉 QA

每张生成图必须与参考图对照检查（见 qa-checklist.md Q1-Q3），保真失败时定向加强保真子句并重生成一次。
