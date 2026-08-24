# 开源项目研究与筛选报告

> 第一阶段调研完成时间：2026-08-19

## 一、核心推荐项目

### 1. motiful/product-shots ⭐⭐⭐⭐⭐

- **仓库**: https://github.com/motiful/product-shots
- **License**: MIT
- **定位**: 开源 Claude Code Skills，一张商品图 → 完整电商视觉套件
- **复用价值**: **极高 — 当前最接近我们需求的现成方案**

#### 能力概览

| Skill | 功能 |
|-------|------|
| `product-shots` | 意图路由，4 轮澄清 + Visual DNA 注入 |
| `product-shots-main-image` | Amazon 合规主图（9 条 MUST 规则编码为 prompt 字段） |
| `product-shots-detail-page` | A+ 详情页模块（hero + feature + lifestyle + spec） |
| `product-shots-multi-angle` | 14 锚点身份锁定，9 角度时装 lookbook |
| `product-shots-ad-creative` | 8 平台广告素材（TikTok/Meta/Google 等） |
| `product-shots-social-post` | 7 行业 DNA 预设，社交媒体帖子 |
| `product-shots-image-gen` | 统一图片生成引擎（OpenAI / Gemini / Flux） |

#### 关键设计亮点

1. **合规前置**: Amazon 9 条规则编码为 prompt 字段，不是后处理检查
2. **身份锚点锁定**: 14 个身份锚点（脸/发/肤/眼/服装/配饰/灯光/相机）锁定跨图一致性
3. **平台风格差异化**: TikTok UGC ≠ Meta editorial ≠ Google polished
4. **模型可替换**: 支持 OpenAI gpt-image-2 / Gemini gemini-3-pro / Flux，通过 OmniMaaS 网关或任意 OpenAI 兼容接口
5. **Visual DNA**: 平台 × 行业交叉的视觉语言预设

#### API 接入方式

```bash
# 方式 A: OmniMaaS 网关（推荐）
export OMNIMAAS_API_KEY='sk-...'
export OMNIMAAS_BASE_URL='https://api.omnimaas.com/v1'

# 方式 B: 任意 OpenAI SDK 兼容网关
export PRODUCT_SHOTS_IMAGEGEN_API_KEY='sk-...'
export PRODUCT_SHOTS_IMAGEGEN_BASE_URL='https://your-gateway/v1'
```

#### 安装

```bash
npx skills add motiful/product-shots
```

#### 与我们项目的适配

- ✅ 直接复用其 Skill 结构和 Prompt 工程思路
- ✅ 其 image-gen 引擎支持多 Provider，符合我们的可替换原则
- ✅ 商品识别 → 场景选择 → Prompt 生成 → 图片生成的完整流程已实现
- ⚠️ 需要评估其对"完整真人使用商品"场景的支持深度
- ⚠️ 需要测试中国国内 API（DashScope / 火山引擎）的接入

---

### 2. StanleyChanH/aliyun-image-skill ⭐⭐⭐⭐

- **仓库**: https://github.com/StanleyChanH/aliyun-image-skill
- **License**: MIT
- **定位**: 阿里云百炼图像生成/编辑/翻译 Skill
- **复用价值**: **高 — 千问 API 的直接调用封装**

#### 能力

- **文生图** (Qwen-Image): 文本生成图像，多分辨率，智能 prompt 改写
- **图像编辑** (Qwen-Image-Edit): 单图编辑、多图融合、风格迁移、细节增强
- **图像翻译** (Qwen-MT-Image): 11→14 种语言，保留排版

#### API 调用

```python
# 文生图
POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
Model: qwen-image-max / qwen-image-plus / qwen-image

# 图像编辑
Model: qwen-image-edit-max / qwen-image-edit-plus / qwen-image-edit
Input: [image_url, text_instruction]
```

#### 与我们项目的适配

- ✅ 国内网络友好，阿里云服务
- ✅ 支持中文 prompt
- ✅ 图像编辑能力可用于"商品图 → 场景图"
- ✅ 可作为 product-shots-image-gen 的一个 Provider
- ⚠️ 24 小时图像存储限制（API 层面）

---

### 3. kingbootoshi/nano-banana-2-skill ⭐⭐⭐⭐

- **仓库**: https://github.com/kingbootoshi/nano-banana-2-skill
- **License**: MIT
- **定位**: Gemini 图片生成 CLI + Claude Code Skill
- **复用价值**: **高 — Gemini 图片生成的成熟封装**

#### 关键能力

- 多分辨率: 512 / 1K / 2K / 4K
- 多宽高比: 1:1, 16:9, 9:16, 4:3 等
- **参考图编辑**: 用 `-r` 传入参考图进行编辑/风格迁移
- **透明背景**: 绿幕 + FFmpeg 抠图
- **成本追踪**: 每次生成记录成本
- 模型: Gemini 3.1 Flash (快速便宜) / Gemini 3 Pro (高质量)

#### 成本参考

| 尺寸 | Flash 成本 | Pro 成本 |
|------|-----------|---------|
| 1K | ~$0.067 | ~$0.134 |
| 2K | ~$0.101 | ~$0.201 |

#### 与我们项目的适配

- ✅ 参考图编辑能力适合"商品图 → 场景图"
- ✅ 成本低，适合高频测试
- ✅ 可作为另一个 Provider 接入

---

### 4. ppdbxdawj/seedream-image-skill ⭐⭐⭐

- **仓库**: https://github.com/ppdbxdawj/seedream-image-skill (在 ai-skills 仓库内)
- **License**: MIT
- **定位**: Seedream 5.0/4.0（即梦 AI）图片生成 Skill
- **复用价值**: **中高 — 字节系模型接入**

#### 能力

- 文生图、图生图、多图融合
- 角色一致性
- 电商场景支持
- 知识卡片、海报、PPT
- 组图/分镜

#### 与我们项目的适配

- ✅ 电商场景是其重点方向
- ✅ 多图融合能力对"商品 + 人物 + 场景"有价值
- ⚠️ 需要通过火山引擎 API 接入

---

### 5. cliprise/awesome-ai-product-photography-prompts ⭐⭐⭐

- **仓库**: https://github.com/cliprise/awesome-ai-product-photography-prompts
- **License**: 教育用途
- **定位**: AI 商品摄影 Prompt 模板库 + 工作流指南
- **复用价值**: **中 — Prompt 模板参考**

#### 核心价值

- 结构化 Prompt 公式: `format → product → composition → environment → lighting → details → use → restrictions`
- 8 类 Prompt 模板（studio / beauty / tech / flat lay / outdoor / food / fashion / source frame）
- QA 检查清单
- 变体测试方法论

#### 与我们项目的适配

- ✅ Prompt 公式可直接借鉴到我们的 Prompt 模板
- ✅ QA 检查清单可用于我们的质量评估
- ⚠️ 纯 Prompt 参考，无代码逻辑

---

## 二、底层模型参考

### Qwen-Image（千问图像）

- **仓库**: https://github.com/QwenLM/Qwen-Image
- **License**: Apache 2.0
- **最新版本**: Qwen-Image-2512（文生图）/ Qwen-Image-Edit-2511（编辑）
- **关键升级**:
  - 更真实的人物质感，大幅降低 AI 感
  - 更细腻的自然纹理
  - 原生 2K 分辨率
  - 集成文生图和编辑能力
- **API**: 通过 DashScope 调用
- **本地部署**: 支持 diffusers，需 GPU

### Seedream 5.0（即梦 AI）

- 字节跳动下一代图像模型
- 支持文生图、图像编辑、多图融合
- 通过火山引擎 Ark API 调用
- 电商场景优化

---

## 三、结论与下一步

### 最值得复用的项目

| 优先级 | 项目 | 复用方式 |
|--------|------|----------|
| 1 | product-shots | 直接复用 Skill 结构 + Prompt 工程 + image-gen 引擎 |
| 2 | aliyun-image-skill | 作为 Qwen API Provider 接入 |
| 3 | nano-banana-2-skill | 作为 Gemini Provider 参考实现 |
| 4 | seedream-image-skill | 作为 Seedream Provider 接入 |
| 5 | awesome-ai-product-photography-prompts | Prompt 模板参考 |

### 下一步行动

1. 将 product-shots 的 Skill 文件本地保存或引用
2. 以 Qwen Image Edit API 为第一个可运行的 Provider
3. 跑通最简单的测试：一张商品图 → 一个场景图
4. 逐步接入其他 Provider
