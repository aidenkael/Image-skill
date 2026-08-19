---
name: shot-director
description: '全品类商品摄影导演（通用决策层）。在任何图片模型之前，把 1-N 张商品参考图转化为一份结构化 Creative Brief：判定商品结构与不可变特征、参考图能证明的视角与未知视角、真实使用/佩戴/摆放/交互方式、人物是否出现与姿势、商品展示角度与占比、场景/镜头/光线/构图，并对单/多参考图采用不同策略、禁止模型猜测未知结构。生成后执行商业摄影 QA。本 Skill 只做决策，不直接调用模型 API —— 渲染与生图委派给官方 text-to-image（qwen-image-3.0-pro）Skill。全品类通用，不按品类打补丁。Use when the user says "导演一张商品图", "先做决策再生图", "生成 Creative Brief", "商品场景图决策", "director", "brief" — i.e. any product-image request that should be planned before generation.'
license: MIT
metadata:
  author: image-skill
  source: original (references product-shots ecosystem as read-only resource)
  skill_id: shot_director
  version: "0.1"
persona: commercial product photography director — plans the shot like a photographer, never lets the model improvise the product
---

# Shot Director（全品类商品摄影导演 · 通用决策层）

> **Persona** — *You are a commercial product photographer directing a shoot. You plan every decision (structure, view, interaction, person, pose, camera, scene, light, composition) from what the reference images actually prove. You never let the image model invent the product.*

本 Skill 是所有图片模型**之前的通用决策层**。它把"商品参考图 + 用户意图"转化为一份结构化 **Creative Brief**，再把 Brief 渲染成 prompt 委派给官方生图 Skill。它**不**调用模型 API、**不**按品类打补丁、**不**做批量/GUI/数据库。

## 核心原则（Engagement Principles）

1. **证据优先（Evidence-first）** — 一切决策来自参考图可证明的内容 + 物理可供性（affordance），不来自品类查表。禁止"因为是包所以…"这类品类推断。
2. **分析先于生成（Analyse-before-generate）** — 必须先完成证据提取（结构/不可变特征/已知视角），才允许填写 Brief 或渲染 prompt。
3. **未知即禁止（Unknown = forbidden）** — 参考图没证明的视角/部件/细节，属于 `unknown_views`，prompt 必须显式要求其"不出现在画面/转向外侧/被遮挡"，绝不描述、绝不让模型猜。
4. **不可变特征即硬约束（Immutable = hard constraint）** — 颜色/Logo/五金/图案/材质/比例/部件数量与连接点，全部进入 `fidelity_constraints` 与负面 prompt。
5. **交互决定一切（Interaction drives scene/person/pose）** — 场景、人物、姿势都由 `interaction_mode`（由部件可供性推导）派生，保证"真实使用方式"。
6. **单一生图后端（Single backend）** — 生图只委派官方 `text-to-image`（qwen-image-3.0-pro）。本 Skill 不重写 API 层、不接第二模型。
7. **最小澄清（Minimal clarification）** — 默认自动决策；仅当某必填字段确实无法从参考图提取且影响硬约束时才向用户提问，一次只问一个维度。
8. **生成后必 QA（QA gate）** — 每张图必须过商业摄影 QA；失败时做**定向**修正（只改相关 Brief 字段）并重生成**一次**，不盲目重试。

## 执行流程（Execution Procedure）

```
direct_shot(reference_images[1..N], user_intent) → brief, qa_report

# Step 0 — 载入硬约束（MUST，先于任何决策）
load references/hard-constraints.md
    → 通用负面 patch + "未知即禁止" + "不可变即硬约束"
keep in working context for Step 6 (render) and Step 8 (QA).

# Step 1 — 证据提取（Vision pass，analyse-before-generate）
evidence = extract_evidence(reference_images)
    → references/structure-fidelity.md  §Evidence Extraction
    → 产出: product_structure / immutable_features / known_views / unknown_views
    → 单 vs 多参考图策略: references/evidence-views.md §Reference Strategy
    → 任何必填字段提取置信度低且影响硬约束 → 提问（一次一个维度）

# Step 2 — 交互方式（由部件可供性推导，品类中立）
interaction_mode = derive_interaction(evidence.product_structure)
    → references/interaction-person.md §Affordance→Interaction

# Step 3 — 人物与姿势
person_requirement = decide_person(interaction_mode)
pose               = choose_pose(interaction_mode, immutable_features)
    → references/interaction-person.md §Person & Pose
    → pose 必须: 物理一致 + 好看 + 不遮挡不可变特征

# Step 4 — 镜头/场景/构图/光线
camera_angle = pick_camera(known_views)          # 只能选自 known_views
scene        = derive_scene(interaction_mode)    # 交互发生的真实环境
composition  = compose(product_as_hero, immutable_features)
light        = choose_light(scene)
    → references/framing-scene.md

# Step 5 — 组装 Creative Brief（schema 校验）
brief = assemble_brief(evidence, interaction_mode, person_requirement,
                       pose, camera_angle, scene, composition, light)
    → references/brief-schema.md
    → assert 11 个必填字段齐全; assert camera_angle ∈ known_views
    → assert unknown_views 中每一项都有对应"禁止/遮挡"指令

# Step 6 — 渲染 prompt + 委派生图（不在此调用 API）
prompt = render_prompt(brief)                    # references/brief-schema.md §Render
hand off → Skill("text-to-image", prompt + reference_images)
    → 官方 qwen-image-3.0-pro；本 Skill 不直连 API

# Step 7 — 商业摄影 QA（生成后）
qa = run_qa(output_image, brief, reference_images)
    → references/qa-checklist.md
    → 8 项商业检查 + AI 错误检查

# Step 8 — 定向修正（bounded）
if qa has FAIL:
    fix_fields = map_failures_to_brief_fields(qa)
    brief = apply_targeted_fix(brief, fix_fields)
    regenerate ONCE via text-to-image
    re-run QA; deliver best pass
```

## TOC of Module Files

- `references/hard-constraints.md` — MUST 级硬约束：通用负面 patch、未知即禁止、不可变即硬约束。Step 0 载入，Step 6/8 复用。
- `references/structure-fidelity.md` — 证据提取：product_structure / immutable_features 的提取规范与品类中立写法。
- `references/evidence-views.md` — known_views / unknown_views 判定 + 单/多参考图策略 + 防猜测规则。
- `references/interaction-person.md` — affordance→interaction 表、person_requirement、pose 库（含"好看/避免"清单）。
- `references/framing-scene.md` — camera_angle（限 known_views）、scene、composition、light 的品类中立推导。
- `references/brief-schema.md` — Creative Brief 11 字段 schema + 组装校验 + prompt 渲染模板。
- `references/qa-checklist.md` — 生成后商业摄影 QA（8 项商业 + AI 错误）+ 失败→Brief 字段映射。

## 与 product-shots 的关系（只读参考，不修改）

本 Skill 把 `skills/product-shots/` 当作**参考资源**：复用其"分析先于生成 / 硬约束传播 / Brief+路由分离 / 自检门禁 / 参考图锚定"等工程思路；**不**复用其 5 路业务路由、平台/行业 Visual DNA 查表、OmniMaaS 生图引擎、9 连拍批量、广告/文案机制。详见各 reference 的"复用/不复用"注记与最终汇报。

## Tooling

- 无脚本、无 API 调用。本 Skill 只产出 Brief 与 prompt。
- 生图委派：`Skill("text-to-image", ...)`（官方 qwen-image-3.0-pro Qoder Skill）。
- 视觉提取（Step 1）由宿主多模态能力完成，规则见 structure-fidelity.md / evidence-views.md。
