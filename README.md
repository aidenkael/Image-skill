# Image-skill V1 — 商品视觉工作台

SHEIN 类电商商品视觉工作台 V1：在浏览器里完成商品理解、**氛围感主图**、**组合卖点图**与**简单优化**。

> 输入真实商品图 → 用户显式发起商品分析 → 选择或调整视觉方向 → AI 场景生成 / 确定性排版 / Sharp 优化 → 可下载的商品视觉图

## V1 范围

- ✅ **商品理解**：用户选择 1–9 张图片并显式触发 qwen3.7-plus 分析，结构化结果与 Visual Plan 按 Workspace 保存
- ✅ **氛围主图（hero）**：默认 AI 自由创作，也可选择分析得到的商品专属方向或输入自定义想法；人物仅作可选覆盖 → qwen-image-3.0-pro 生成（商品保真）
- ✅ **组合卖点图（collage）**：可选用有图片依据的文案建议；Fabric.js 确定性排版、独立编辑并导出 PNG（服务端不调用 AI）
- ✅ **简单优化（optimize）**：Sharp 确定性缩放、裁切、背景填充与格式转换（不调用 AI）
- 🕐 **详情页图（detail）**与批量流水线：后续阶段

## 技术栈（固定）

- Next.js + React + TypeScript（单一可部署应用，非 monorepo）
- `fabric`（Fabric.js v7，浏览器端可编辑画布）
- `sharp`（服务端确定性图片操作：缩略图、视觉预览、优化）
- `zod`（运行时请求/模板校验，唯一事实来源）
- 本地文件系统存储（`.runtime/`，无数据库）
- 工作台级 AI 配置中心：商品分析支持 OpenAI 兼容识图，Hero 支持百炼千问图片与火山方舟 Seedream，并可分别选择活动配置

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置密钥（复制模板后填入）
cp .env.example .env   # 可在 .env 或工作台右上角 AI 设置中填写 Key

# 3. 启动开发服务器
pnpm dev              # http://localhost:3000

# 4. 验证
pnpm test --run       # 定向测试（全打桩，不消耗付费额度）
pnpm build            # 类型检查 + 生产构建
```

## 使用流程

1. **新建或选择商品**（一个商品对应一个独立 Workspace，新建时必须输入名称）
2. **上传商品图**（左侧面板，支持拖拽，JPEG/PNG/WebP，≤20MB）
3. **AI 分析商品**（显式点击，不会在上传、刷新或切换商品时自动付费调用）
4. **切换任务**（顶部：氛围主图 / 组合卖点图 / 简单优化；详情页图仅标记为后续）
5. **氛围主图**：选择源图 → 默认 AI 自由创作，或选择商品专属方向 / 输入自定义想法 → 可选人物参与 → 数量 / 比例 → 生成；
   每张结果可单独下载；生成中可切换任务或商品，返回与刷新后会恢复状态并继续轮询
6. **组合卖点图**：可应用有图片依据的建议或手动编辑 → 创建布局 → Fabric 编辑 → 导出 PNG
7. **简单优化**：选择单图 → 比例 / 完整显示或铺满裁切 / 背景填充 / 尺寸 / 格式 / 质量 → 下载
8. 当前商品、任务选项、分析与 Hero 运行状态、最近 Hero/Optimize 结果与拼图编辑状态会在刷新后恢复；商品与素材均支持带确认的删除

## 项目结构

```text
src/
  app/          # 页面 + API 路由（薄适配层）
  core/         # 纯 TS 契约：workspaces / assets / intelligence / tasks / results / templates
  features/     # UI 功能模块：workspaces / intelligence / system / workbench / assets / hero / collage / optimize
  editor/       # 浏览器端 Fabric 适配：document / canvas / render / export
  server/       # 服务端：workspaces / intelligence / assets / tasks / image(sharp) / providers / storage(fs)
templates/
  collage/      # 3 套拼图模板 JSON（left-hero-right-three / top-hero-bottom-three / four-grid）
  detail/       # 后续阶段保留
.runtime/
  workspaces/<workspaceId>/
    workspace.json
    draft.json
    intelligence.json
    intelligence-run.json
    assets/     # 当前商品的上传原图、缩略图和元数据
    tasks/      # 当前商品的任务记录
    outputs/    # 当前商品的 Hero / Optimize 输出
```

AI 配置仅保存在服务端已忽略的 `.runtime/settings/ai-profiles.json`；浏览器端只接收掩码，不接收完整 Key。旧 `.runtime/settings/ai.json` 或 `DASHSCOPE_API_KEY` 只在新配置文件尚不存在时迁移一次。

活动 API 均以商品工作区为作用域：`/api/workspaces`、
`/api/workspaces/:workspaceId/draft`、`/api/workspaces/:workspaceId/assets` 与
`/api/workspaces/:workspaceId/intelligence` 与 `/api/workspaces/:workspaceId/tasks`。旧的全局 `/api/assets`、`/api/tasks` 不再提供。

## 文档

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 开发指南（产品定义 / 模块边界 / 契约 / 开发顺序）
- `legacy/` — 旧 Agent+Skill 试验资料（历史参考，非运行时）

## License

MIT
