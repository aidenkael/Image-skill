# Image Skill

电商商品图片 AI 生成工作环境。

> 输入真实商品图片 → 自动理解商品 → 自动选择场景/人物/风格 → 生成高质量电商图片

## 项目目标

为电商商品图片生成建立一套长期工作环境，整合现有 Agent Skill、开源 Prompt、ComfyUI 工作流、国内外图片模型 API 和商业软件方案，实现：

- 完整真人自然使用商品（不只是手部特写）
- 人物、商品、背景、光影融为一体
- 商品颜色/结构/图案/Logo 尽量保持一致
- 根据商品类型自动选择场景，也支持手动指定
- 去 AI 味，像真实商业摄影

## 三条方案路线

### 方案 A：Agent + Skill + 图片模型 API【当前第一优先】

利用已有开源 Skill 和 Prompt，结合可替换的图片模型 API（Qwen Image / Seedream / Gemini / FLUX），实现端到端电商图片生成。

**详见 → [docs/open-source-research.md](docs/open-source-research.md)**

### 方案 B：ComfyUI + 成熟工作流

收集高质量 ComfyUI 工作流 JSON（商品摄影、真人场景、商品保持、放大修复等），仓库只保存工作流文件和配置说明，不存放模型和缓存。

当前阶段：资料收集与结构预留。

### 方案 C：成熟商业软件

跟踪 Nightjar / Flair / Photoroom / Claid 等商业软件作为效果标杆和备用生产工具。仓库只记录评测结论。

## 项目结构

```
Image skill/
├─ skills/          # Agent Skill 文件（复用或适配的开源 Skill）
├─ prompts/         # 结构化 Prompt 模板
├─ workflows/       # ComfyUI 工作流 JSON
├─ configs/         # 模型/Provider 配置
├─ references/      # 参考资料、来源记录
├─ tests/           # 测试用例
│  └─ samples/      # 测试商品图片
├─ docs/            # 文档（研究、方案、决策记录）
├─ outputs/         # 生成结果（不提交 Git）
├─ README.md
├─ AGENTS.md        # Agent 行为约束
├─ .gitignore
└─ .env.example     # API Key 模板
```

## 快速开始

1. 复制 `.env.example` 为 `.env`，填入 API Key
2. 查看 `docs/open-source-research.md` 了解已筛选的开源项目
3. 查看 `docs/unified-skill-design.md` 了解统一图片生成流程设计
4. 测试样例放在 `tests/samples/`

## 核心原则

1. 商品必须是画面核心，结构不能随意改变
2. 真人必须完整、动作自然，与商品真实接触
3. 光线/阴影/比例合理，场景符合商品实际使用方式
4. 避免塑料皮肤、假背景、悬浮商品
5. 追求"像真实商业摄影"而非"像 AI 生成图片"
6. 不默认白底图，根据商品类型选择不同视觉方向

## 执行原则

> 先找现成工具 → 再找 Skill → 再找 Workflow → 再借鉴开源代码 → 最后才自行开发

## License

MIT
