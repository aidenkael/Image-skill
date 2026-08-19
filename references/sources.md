# 参考来源记录

## 开源项目

| 项目 | URL | License | commit SHA（复用时） | 用途 |
|------|-----|---------|----------------------|------|
| motiful/product-shots | https://github.com/motiful/product-shots | MIT | `063c508b` | Hub/Brief/硬约束传播/QA 思路（仅借鉴思路；本地快照在 `skills/product-shots/`，只读参考） |
| buluslan/gpt-image2-ecommerce | https://github.com/buluslan/gpt-image2-ecommerce | MIT | `a3673fb6` | 25 个电商场景模板原文复制入 `skills/ecom-shot/references/templates/` |
| liangdabiao/ecom-details-image | https://github.com/liangdabiao/ecom-details-image | MIT（README 声明，仓库无 LICENSE 文件） | `1ec867b7` | 风格锁定/转化驱动/整套图节奏思路（仅借鉴思路，不复制原文） |
| StanleyChanH/aliyun-image-skill | https://github.com/StanleyChanH/aliyun-image-skill | MIT | — | 千问图像 API Skill 封装 |
| kingbootoshi/nano-banana-2-skill | https://github.com/kingbootoshi/nano-banana-2-skill | MIT | — | Gemini 图片生成 CLI |
| ppdbxdawj/seedream-image-skill | https://github.com/ppdbxdawj/ai-skills | MIT | — | Seedream 5.0 图片生成 Skill |
| cliprise/awesome-ai-product-photography-prompts | https://github.com/cliprise/awesome-ai-product-photography-prompts | 教育用途 | — | Prompt 模板参考（授权不明确，仅借鉴思路） |
| cliprise/awesome-seedream-5-prompts | https://github.com/cliprise/awesome-seedream-5-prompts | 教育用途 | — | Seedream Prompt 参考（授权不明确，仅借鉴思路） |

> ecom-shot 内部第三方内容的逐文件来源记录见 `skills/ecom-shot/references/SOURCES.md`。

## 底层模型

| 模型 | URL | License | 说明 |
|------|-----|---------|------|
| QwenLM/Qwen-Image | https://github.com/QwenLM/Qwen-Image | Apache 2.0 | 千问图像生成/编辑基础模型 |
| Qwen-Image-2512 | 同上 | Apache 2.0 | 最新版，人物真实感大幅提升 |
| Qwen-Image-Edit-2511 | 同上 | Apache 2.0 | 最新编辑版，多图融合 |
| Seedream 5.0 | 火山引擎 API | 商业 | 字节跳动即梦 AI |
| Gemini 2.5/3.0 | Google AI Studio | 商业 | Google 图像生成 |

## 商业软件（方案 C 跟踪）

| 软件 | URL | 说明 |
|------|-----|------|
| Nightjar | https://nightjar.ai | AI 商品摄影 |
| Flair | https://flair.ai | AI 商品图设计 |
| Photoroom | https://www.photoroom.com | AI 商品背景替换 |
| Claid | https://claid.ai | AI 商品图增强 |

## Prompt 方法论

- Cliprise Prompt 公式: `format → product → composition → environment → lighting → details → use → restrictions`
- product-shots Visual DNA: 平台 × 行业交叉的视觉语言预设
- Qwen-Image Negative Prompt: `低分辨率，低画质，肢体畸形，手指畸形，画面过饱和，蜡像感，人脸无细节，过度光滑，画面具有AI感`
