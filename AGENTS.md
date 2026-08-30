# AGENTS.md — Agent 行为约束（V1）

本文件约束所有参与 Image-skill V1 商品视觉工作台的 AI Agent 行为。
V1 产品方向以本文为准；仓库内 `legacy/` 目录为历史研究资料，非运行时。

> 仓库范围：本仓库**仅**维护 Image-skill V1 商品视觉工作台。Crystal 桌面技能
> （水晶手镯参考图）已从本仓库拆分为**独立本地项目**（`E:\Crystal Image Skill`），
> 仅本地管理，不进入本仓库 Git 历史或 GitHub。

## 产品定义

- 产品：SHEIN 类电商商品视觉工作台（Web 应用）。
- 最终决定权归用户：任务类型、输入素材、输出数量、是否含文字、视觉方向。
- V1 可执行任务：`氛围主图(hero)`、`组合卖点图(collage)`、`简单优化(optimize)`；详情页与批量流水线为后续阶段。
- Hero 是一键完成的电商摄影工作流：Vision Director → 确定性 Prompt Compiler → Image Provider → 批量 Vision QA → 至多一次基于反馈的补生。
- 用户不得手动操作 Product Intelligence、策划、QA、结构化输出、Provider 策略或重试步骤；成功的 Hero 任务必须恰好交付请求数量。
- Hero 保真锁定商品身份/拓扑，同时允许可动部件物理上合理的状态/姿态变化；不得把关节部件冻结为源图的 2D 姿态。
- Product Intelligence 是有图片依据的商品事实/拼图文案能力，是 Collage 的惰性后台辅助，不是 Hero 前置条件；同一选择不得重复隐藏分析。
- Collage 只消费有图片依据的文案建议且服务端仍为确定性执行。
- `reference` 素材仅可用于视觉方向参考；不得作为 Hero / Collage / Optimize 的商品内容源，也不得作为任何商品事实、标题或卖点证据。
- Product Intelligence 产生的 Collage 标题与卖点必须绑定当前商品图片证据；旧的无证据分析记录不得兼容冒充新结果，必须重新分析。
- 运行时是「常规软件 + AI Provider」，不是 Agent + Skill；Agent 只是开发工具。
- 不同任务必须走不同实现：不要把所有功能都路由到同一次图片生成调用。
- 确定性编辑/排版优先用确定性代码；只有真正需要生成/理解的地方才用 AI。
- Benchmark Lab（`/benchmark/hero`）是独立 R&D 界面，用于对比图像执行路线；不得把它的复杂度引入正式 Hero 工作台。正式产品 UI 保持简单；多参考图、lane 预设与执行实验只属于 Lab。Provider 无真实能力时，Lab 路线必须如实标记不可用，不得用 prompt 文本伪装。

## 绝对禁止

- 训练模型、实现图像生成算法、维护本地大模型栈、搭建本地 ComfyUI 部署。
- 做一个通用 Photoshop / Canva 克隆。
- 现在开发批量界面 / 任务队列 / 并发管理 / SKU 导入（保留可复用的任务契约即可）。
- 把 API Key 写入代码或提交到 Git。
- 把运行期上传/生成文件（`.runtime/`、`outputs/`）提交到 Git。
- 为了"架构漂亮"重写已有成熟能力；为了未来可能需要的功能提前开发。
- 大规模下载模型到本仓库。

## 必须遵守

- 优先复用成熟高星开源依赖；优先国内可访问的 Provider。
- 模型 ID 是 opaque config；运行时能力不得通过模型名推断。
- AI 接入按「协议 adapter + 显式/自动 capability」扩展。
- 同协议新模型只改配置；新协议只新增 provider adapter，不修改 Hero/Product Intelligence 业务层。
- VisionProvider 与 ImageProvider 均遵守该边界。
- 工作台 AI Provider 由服务端 `.runtime/settings/ai-profiles.json` 配置中心管理；商品分析与氛围主图可分别选择不同配置。
- API Key 始终仅限服务端；不得暴露到浏览器存储或 Git。
- Provider 预设只是默认值，用户可编辑 endpoint/model；不得根据 Key 前缀自动切换 Token Plan 或其他端点。
- 每次修改后检查 `.gitignore` 是否覆盖新的大文件目录。
- Commit message 用中文，简明扼要，完成一个有意义阶段后再提交。

## 模块边界（强制）

| 目录 | 职责 | 禁止 |
|------|------|------|
| `src/core/**` | 纯 TS 契约/规则 | 不得 import React / Next / Node fs / Fabric / Provider SDK |
| `src/features/**` | UI 功能模块 | 可以 import core 与客户端/编辑器 API；不得 import `src/server` |
| `src/editor/**` | 浏览器端可编辑文档 / Fabric 适配 | 不得含 AI / Provider / 业务编排 |
| `src/server/**` | 服务端函数 | 可以 import core；不得 import React / UI 功能模块 |
| `src/app/api/**` | 薄 HTTP 适配层 | 只做校验 + 服务调用 + 响应 |
| `src/server/providers/**` | Provider 请求/响应解析 | 只允许出现在本目录内 |
| `templates/**` | 模板 JSON（数据） | 不是 React 代码 |

## 评价标准

> 最终图片质量 + 商品真实性 + 真人自然度 + 去 AI 味 + 卖家使用效率 + 延迟与成本

## 目录使用规则

| 目录 | 用途 | 提交 Git |
|------|------|----------|
| `src/` | 应用代码 | ✅ |
| `templates/` | 模板 JSON | ✅ |
| `docs/` | 文档（含 DEVELOPMENT.md） | ✅ |
| `tests/` | 测试样例（小文件） | ✅ |
| `legacy/` | 历史研究资料（非运行时） | ✅ |
| `.runtime/` | 运行期上传/生成文件 | ❌ |
| `outputs/` | 生成结果 | ❌ |
| `.env` | 密钥 | ❌ |

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
