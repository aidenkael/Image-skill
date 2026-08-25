# Image-skill V1 — 商品视觉工作台

SHEIN 类电商商品视觉工作台 V1：在浏览器里完成 **氛围感主图** 与 **组合卖点图** 两条核心链路。

> 输入真实商品图 → 用户决定任务类型 / 素材 / 输出数量 / 文字 / 视觉方向 → 确定性排版 + AI 场景生成 → 直接可用的电商视觉图

## V1 范围

- ✅ **氛围主图（hero）**：商品图 + 用户方向 → DashScope qwen-image 场景生成（商品保真，仅改变场景/光线/构图/人物交互）
- ✅ **组合卖点图（collage）**：3 套模板 + 可编辑画布（Fabric.js）→ 确定性排版 → 导出 PNG（**不调用 AI**）
- 🕐 详情页图（detail）、简单优化（optimize）、批量流水线：**仅保留任务契约与模块边界，V2 阶段实现**

## 技术栈（固定）

- Next.js + React + TypeScript（单一可部署应用，非 monorepo）
- `fabric`（Fabric.js v7，浏览器端可编辑画布）
- `sharp`（服务端确定性图片操作：缩略图/元数据）
- `zod`（运行时请求/模板校验，唯一事实来源）
- 本地文件系统存储（`.runtime/`，无数据库）
- DashScope / 阿里云百炼为 V1 唯一 AI Provider

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置密钥（复制模板后填入）
cp .env.example .env   # 至少填写 DASHSCOPE_API_KEY

# 3. 启动开发服务器
pnpm dev              # http://localhost:3000

# 4. 验证
pnpm test --run       # 定向测试（全打桩，不消耗付费额度）
pnpm build            # 类型检查 + 生产构建
```

## 使用流程

1. **新建或选择商品**（一个商品对应一个独立 Workspace，新建时必须输入名称）
2. **上传商品图**（左侧面板，支持拖拽，JPEG/PNG/WebP，≤20MB）
3. **切换任务**（顶部：氛围主图 / 组合卖点图 / 详情页图 / 简单优化）
4. **氛围主图**：选择源图 → 输出数量 / 比例 / 人物 / 场景 → 生成（未配置 Key 时会明确报错）；
   每张结果可单独下载；刷新页面后自动恢复最近一次生成结果
5. **组合卖点图**：选择模板与素材 → 创建布局 → 画布内拖动/缩放/双击编辑文字/替换图片 → 导出 PNG
6. 当前商品、任务选项、最近主图结果与拼图编辑状态会在刷新后恢复；不同商品的素材和任务完全隔离

## 项目结构

```text
src/
  app/          # 页面 + API 路由（薄适配层）
  core/         # 纯 TS 契约：workspaces / assets / tasks / results / templates
  features/     # UI 功能模块：workspaces / workbench / assets / hero / collage / detail
  editor/       # 浏览器端 Fabric 适配：document / canvas / render / export
  server/       # 服务端：workspaces / assets / tasks / image(sharp) / providers / storage(fs)
templates/
  collage/      # 3 套拼图模板 JSON（left-hero-right-three / top-hero-bottom-three / four-grid）
  detail/       # V2 阶段保留
.runtime/
  workspaces/<workspaceId>/
    workspace.json
    draft.json
    assets/     # 当前商品的上传原图、缩略图和元数据
    tasks/      # 当前商品的任务记录
    outputs/    # 当前商品的 Hero 输出
```

活动 API 均以商品工作区为作用域：`/api/workspaces`、
`/api/workspaces/:workspaceId/draft`、`/api/workspaces/:workspaceId/assets` 与
`/api/workspaces/:workspaceId/tasks`。旧的全局 `/api/assets`、`/api/tasks` 不再提供。

## 文档

- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — 开发指南（产品定义 / 模块边界 / 契约 / 开发顺序）
- `legacy/` — 旧 Agent+Skill 试验资料（历史参考，非运行时）

## License

MIT
