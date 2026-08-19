---
name: hard-constraints
description: shot-director 的 MUST 级硬约束 —— 通用负面 patch、"未知即禁止"、"不可变即硬约束"。Step 0 载入，Step 6（渲染）与 Step 8（QA）复用。品类中立，不含任何品类特例。
---

# Hard Constraints（MUST 级）

## 1. 通用负面 patch（Unified Negative Patch）

每次渲染 prompt 必须附加（品类中立，只挡 AI 通病与假界面）：

```
social media UI, screenshot, watermark, phone frame, app interface,
distorted text, garbled logo, extra limbs, extra fingers, mutated hands,
plastic skin, waxy face, uncanny valley, floating product, fake background,
oversaturated, AI-generated look, extra products, duplicated parts
```

> 复用自 product-shots/hard-constraints 的"统一 patch 传播"思路，但去掉其平台特例（Google Display 等），保留品类中立部分，并新增 `duplicated parts`（挡"肩带混乱/部件复制"类错误）。

## 2. 未知即禁止（Unknown = Forbidden）

- `unknown_views` 中的任何视角/面/内部结构，prompt **不得描述其细节**。
- 必须三选一处理：
  1. **不出现在画面**（镜头只取 known_views）；
  2. **转向外侧/背对镜头**（如 "the back of the product is turned away from camera"）；
  3. **被合理遮挡**（人体/角度/景深自然遮住）。
- 禁止词示例（写入 prompt）：`do not show the back/bottom/interior`, `keep unseen sides out of frame`, `no invented details on unseen surfaces`。

## 3. 不可变即硬约束（Immutable = Hard Constraint）

`immutable_features` 的每一项必须同时进入：
1. 正向 prompt 的 "keep exactly as reference" 子句；
2. 负面 prompt 的对应禁止（如 `changed logo, altered pattern, wrong color, extra strap, missing hardware`）。

部件**数量与连接点**也属不可变（如 "exactly ONE continuous strap attached at two anchor points"）。

## 4. 校验门禁（Step 5 / Step 8 复用）

```
assert camera_angle ∈ known_views
assert every unknown_views item has a forbid/occlude instruction
assert every immutable_features item appears in fidelity_constraints
assert prompt contains unified negative patch
```
