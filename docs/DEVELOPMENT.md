# DEVELOPMENT — Image-skill V1 开发指南

> 仅收录耐久性开发指导；旧 Agent+Skill 资料见 `legacy/`（非运行时）。

## 1. 产品定义

SHEIN 类电商商品视觉工作台：卖家上传真实商品图，选择任务类型与视觉方向，
产出可直接投放的氛围主图、组合卖点图与简单优化结果。**用户拥有最终决定权**（任务类型、输入素材、
输出数量、是否含文字、视觉方向）。

运行时 = 常规 Web 软件 + AI Provider；Agent 只是开发工具，不是产品运行时。

## 2. V1 范围

| 能力 | 状态 |
|------|------|
| 氛围主图 hero（AI 场景生成，商品保真） | ✅ V1 完整实现 |
| 组合卖点图 collage（确定性排版 + 可编辑画布 + PNG 导出） | ✅ V1 完整实现 |
| 简单优化 optimize（Sharp，零 AI 调用） | ✅ V1 完整实现 |
| 商品理解（显式 VLM 分析，按 Workspace 保存） | ✅ V1 完整实现 |
| 详情页 detail | 🕐 后续阶段 |
| 批量流水线 / 队列 / SKU 导入 | 🕐 不实现，保留可复用契约 |

评价标准：最终图片质量 / 商品真实性 / 真人自然度 / 去 AI 味 / 卖家使用效率 / 延迟与成本。

## 3. 人机交互

- 单页工作台：左=资源面板，中=预览/编辑画布，右=当前任务控制，顶=商品与任务切换。
- 一个 Workspace 对应一个商品。新建商品必须由用户输入名称，不自动生成占位商品。
- 活动商品 ID 保存在 `localStorage` 的 `image-skill.active-workspace`；素材、任务、草稿和输出按 Workspace 隔离。
- 任务切换保留各自状态；detail 仅作为后续提示，不得静默调用其他任务。
- 商品分析只由用户显式触发，不在上传、刷新或 Workspace 切换时自动调用。
- Hero 默认自由创作且不依赖商品分析；商品专属方向只消费新鲜的 Visual Plan；自定义想法同样不依赖分析。Collage 只消费文案建议，服务端执行始终确定性。
- UI 不暴露 raw prompt 或 Agent 概念；AI 设置管理可编辑的 Provider 预设、端点、模型、掩码 Key 与识图/生图独立活动配置。
- 上传支持拖拽；资源角色可修正；商品草稿以 400ms 防抖持久化；刷新后恢复最近一次 hero/optimize 任务结果与拼图编辑状态；
  hero 每张结果提供同源下载；生成数量不完整（少于请求数）即整体失败，不以部分结果冒充成功；分析与 Hero 的运行状态按 Workspace 落盘，切换/刷新后继续轮询，活动付费操作锁定其使用的素材。

## 4. 模块边界（强制）

| 目录 | 职责 | 禁止 |
|------|------|------|
| `src/core/**` | 纯 TS 契约/规则（zod 唯一事实来源） | 不得 import React/Next/Node fs/Fabric/Provider SDK |
| `src/features/**` | UI 功能模块 | 不得 import `src/server` |
| `src/editor/**` | 浏览器端 Fabric 适配 | 不得含 AI/Provider/业务编排 |
| `src/server/**` | 服务端函数 | 不得 import React/UI 功能模块 |
| `src/app/api/**` | 薄 HTTP 适配层 | 只做校验+服务调用+响应 |
| `src/server/providers/**` | Provider 请求/响应解析 | 只允许出现在本目录 |
| `templates/**` | 模板 JSON（数据，非 React 代码） | — |

## 5. 固定代码结构

非 monorepo，单一可部署应用：

```text
src/
  app/  page.tsx, api/system/status, api/workspaces(/, [workspaceId]/draft|intelligence|assets|tasks|outputs)
  features/  workspaces, workbench, intelligence, system, assets, hero, collage, optimize
  core/  workspaces.ts, assets.ts, intelligence.ts, tasks.ts, results.ts, templates.ts
  editor/  fabric/ (canvas.ts, document.ts, render.ts, export.ts)
  server/  workspaces/service.ts, intelligence/service.ts, assets/service.ts,
            tasks/(service.ts, hero.ts, collage.ts, optimize.ts), image/sharp.ts,
            providers/(image-provider.ts, vision-provider.ts, aliyun-qwen-image.ts, aliyun-qwen-vision.ts), storage/fs-store.ts
templates/
  collage/  left-hero-right-three.json, top-hero-bottom-three.json, four-grid.json
  detail/   （V2 保留）
.runtime/
  workspaces/<workspaceId>/
    workspace.json
    draft.json
    intelligence.json
    intelligence-run.json
    assets/<assetId>/
    tasks/<taskId>.json
    outputs/<taskId>/
（全部不入 Git；旧的全局 assets/tasks/outputs 不再由活动代码读写）
```

## 6. 开源借用决策

| 项目 | 借用 | 不做什么 |
|------|------|----------|
| Fabric.js（`fabric` v7，官方包；指令指定 `@fabricjs/browser` 在 registry 不存在，用同一库官方包替代） | 浏览器画布/对象/JSON 能力 | 不自写画布原语、不做通用设计器 |
| InvokeAI | 面向功能的 UI 分层与服务边界思路 | 不 fork 其 UI |
| Sharp | 服务端确定性图片操作（缩略图/元数据/优化） | 不自研图像算法 |
| ComfyUI | 仅预留未来外部工作流 Provider 边界（`ImageProvider`） | V1 无依赖 |
| rembg | 预留可选未来背景移除适配器 | V1 不加 Python/运行时依赖 |
| Qwen-Image | 仅 API/Provider 集成 | 不 vendor 模型代码 |

## 7. 任务 / API 契约

- `CreateTaskRequest { kind, assetIds[], count, options }`：所有单件操作都走该契约。
  `count` 按类型校验：hero 1..4，collage 1..3 且 ≤ 模板数，optimize 固定 1。
- `TaskRecord { id, workspaceId, request, status, result?, error?, createdAt, updatedAt }`，落盘当前 Workspace 的 `tasks/`。
- Workspace API：`GET/POST /api/workspaces`、`GET /api/workspaces/:workspaceId`、
  `GET/PUT /api/workspaces/:workspaceId/draft`。
- 资源 API：`GET/POST /api/workspaces/:workspaceId/assets`、
  `GET/PATCH /api/workspaces/:workspaceId/assets/:assetId`。
- 任务 API：`GET/POST /api/workspaces/:workspaceId/tasks`、
  `GET /api/workspaces/:workspaceId/tasks/:taskId`、
  `GET /api/workspaces/:workspaceId/tasks/:taskId/outputs/[...path]`。
- hero 结果下载到 `.runtime/workspaces/<workspaceId>/outputs/<taskId>/`，通过客户端安全 URL 提供；
  不向客户端暴露本地绝对路径，不存 base64 图片体。
- 商品理解 API：`GET/POST /api/workspaces/:workspaceId/intelligence`；结果保存在当前 Workspace。
- Provider 契约：`ProductIntelligenceProvider.analyze(...)` 由活动识图配置解析；
  `ImageProvider.generate(...)` 由活动生图配置解析。百炼 Hero 保持 `prompt_extend: true`，火山方舟按请求数量逐张生成。
- Collage 服务端不调用 AI；Optimize 仅调用 Sharp。
- hero 结果数量必须等于请求数量，否则任务整体失败。
- AI Profile 以 `.runtime/settings/ai-profiles.json` 为唯一运行时事实源；旧 Key/环境变量只在文件不存在时迁移一次。完整 Key 不进入浏览器存储或响应，端点不根据 Key 前缀推断。

## 8. V1 开发顺序

1. core 契约（workspaces/assets/tasks/results/templates）→ 2. server（存储/资源/任务/Provider）→
3. API 路由 → 4. 模板 JSON → 5. editor（Fabric 适配）→ 6. features UI → 7. 定向测试 → 8. 构建验证。

## 9. 必要验证

- `pnpm test --run`：定向测试（全部不消耗付费额度）：
  - core 契约：任务校验（hero 单源/数量、collage 模板/数量、optimize 单源、detail 拒绝）、
    模板文档校验、结果客户端契约（只暴露 URL，不含本地路径）；
  - provider 与 hero 任务：无 Key 配置错误、qwen-image-3.0-pro 请求体（n/size/prompt_extend=true）、
    prompt 构造、返回数量不完整即失败（fetch 全部打桩）；
  - collage 确定性：互异模板、slotIndex 映射、文本开关、方案切换保留编辑、零网络调用；
  - 存储安全：Workspace 路径隔离、路径穿越拒绝、UUID 守卫。
- `pnpm build`：类型检查 + 生产构建。
- 手工冒烟：上传 4 张图 → 构建 left-hero-right-three → 改标题 → 导出 PNG →
  商品分析与 hero 无 Key 时明确报错；Optimize 可生成并下载。
- 自动化验证不消耗付费 AI 生成额度。
