# 第一版统一图片生成 Skill 方案设计

> 设计日期：2026-08-19
> 状态：设计完成，待实现

## 一、核心流程

```
用户输入商品图 + 可选参数
        ↓
  ┌─────────────┐
  │ 1. 商品理解  │  Agent 分析商品图
  └──────┬──────┘
         ↓
  ┌─────────────┐
  │ 2. 商品分类  │  类别 / 用途 / 目标人群
  └──────┬──────┘
         ↓
  ┌─────────────────┐
  │ 3. 场景/风格选择 │  自动推荐 or 用户指定
  └──────┬──────────┘
         ↓
  ┌─────────────┐
  │ 4. Prompt 生成│  结构化 Prompt 组装
  └──────┬──────┘
         ↓
  ┌─────────────┐
  │ 5. 模型选择  │  Provider + Model
  └──────┬──────┘
         ↓
  ┌─────────────┐
  │ 6. API 调用  │  发送请求，获取结果
  └──────┬──────┘
         ↓
  ┌─────────────┐
  │ 7. 输出保存  │  保存到 outputs/
  └─────────────┘
```

## 二、用户输入

### 必填

- `image`: 商品原图路径或 URL

### 可选覆盖参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `scene` | 场景描述 | 自动根据商品推荐 |
| `person` | 人物类型（完整真人/手部/无人） | 自动推荐 |
| `style` | 摄影风格 | 电商实拍 |
| `composition` | 构图方式 | 自动推荐 |
| `aspect_ratio` | 宽高比 | 1:1 |
| `size` | 输出尺寸 | 1K |
| `count` | 生成数量 | 1 |
| `provider` | 模型提供商 | 读取 .env |
| `model` | 具体模型 | 读取 .env |
| `quality` | 质量档位 | high |

## 三、商品分类体系（第一版）

| 类别 | 典型商品 | 推荐场景方向 |
|------|----------|-------------|
| 包/箱包 | 手提包、背包、钱包 | 通勤、旅行、街头、咖啡 |
| 收纳 | 收纳盒、置物架、整理袋 | 家居整理、桌面、浴室、厨房 |
| 家居小物 | 杯子、香薰、摆件 | 客厅、卧室、书房、窗台 |
| 发饰/美妆工具 | 发夹、梳子、化妆刷 | 梳妆台、浴室、特写 |
| 宠物轻配件 | 牵引绳、宠物包、喂食器 | 户外遛宠、家居、宠物场景 |

## 四、场景选择逻辑

### 自动推荐规则

1. 根据商品类别查表获取候选场景
2. 每个类别预设 3-5 个场景方向
3. 每个场景方向包含：
   - 环境描述（室内/室外、具体空间）
   - 人物类型（年龄、性别、动作）
   - 光线方向（自然光、暖光、侧光）
   - 构图建议（中景、近景、特写）

### 场景 Prompt 模板结构

```
[人物描述], [人物动作 + 与商品的互动],
[商品描述保持约束],
[环境/场景描述],
[光线/氛围],
[摄影风格/构图],
[质量约束],
[负面约束]
```

## 五、Prompt 工程要点

### 商品保持约束

```
The product must remain exactly as shown in the reference image.
Do not alter its shape, color, pattern, logo, size, or any visual detail.
Do not add or remove any elements from the product.
```

### 真人自然度约束

```
The person must look completely real and natural.
Natural skin texture with visible pores, no plastic/waxy appearance.
Natural hair with individual strands visible.
Realistic body proportions and natural pose.
The interaction with the product must look genuine and casual.
```

### 去 AI 味约束（Negative Prompt）

```
low quality, blurry, deformed, extra limbs, extra fingers,
plastic skin, waxy face, uncanny valley, floating product,
fake background, oversaturated, AI-generated look,
watermark, text overlay, extra products
```

## 六、Provider 接口设计（第一版，轻量）

不做复杂抽象层。每个 Provider 就是一个配置文件 + 调用脚本。

### configs/providers.yaml

```yaml
providers:
  qwen:
    name: "Qwen Image (DashScope)"
    api_url: "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation"
    auth_env: "DASHSCOPE_API_KEY"
    auth_header: "Authorization: Bearer {key}"
    models:
      generate: "qwen-image-plus"
      edit: "qwen-image-edit-plus"
    supports_reference_image: true
    max_size: "1328x1328"
    
  gemini:
    name: "Gemini (Google AI Studio)"
    api_url: "https://generativelanguage.googleapis.com/v1beta/models/{model}:predict"
    auth_env: "GEMINI_API_KEY"
    models:
      generate: "gemini-2.5-flash-image"
      edit: "gemini-2.5-flash-image"
    supports_reference_image: true
    max_size: "4096x4096"
    
  seedream:
    name: "Seedream (火山引擎)"
    api_url: "https://your-seedream-endpoint"
    auth_env: "SEEDREAM_API_KEY"
    models:
      generate: "seedream-5-0-pro"
    supports_reference_image: true
    
  omnimaas:
    name: "OmniMaaS Gateway"
    api_url: "{base_url}/images/generations"
    auth_env: "OMNIMAAS_API_KEY"
    auth_header: "Authorization: Bearer {key}"
    models:
      generate: "gemini-3-pro-image-preview"
    supports_reference_image: true
    openai_compatible: true
```

## 七、质量评估（第一版，简单实用）

只记录 5 个核心指标，不用百分制：

| 指标 | 评价 |
|------|------|
| 商品是否改变 | 是/否/轻微 |
| 真人是否自然 | 是/否/勉强 |
| 场景是否合理 | 是/否 |
| AI 味是否明显 | 无/轻微/明显 |
| 一次可用率 | 生成 N 张中可直接使用的比例 |

## 八、测试样例（第一版 5-10 个）

| # | 商品类型 | 说明 |
|---|----------|------|
| 1 | 小包/手提包 | 测试通勤/街头场景 |
| 2 | 收纳盒 | 测试家居场景 |
| 3 | 家居小物（杯子/香薰等） | 测试生活场景 |
| 4 | 发夹/发饰 | 测试人物佩戴场景 |
| 5 | 化妆刷/美妆工具 | 测试梳妆台特写 |
| 6 | 宠物轻配件 | 测试遛宠/家居场景 |

## 九、第一阶段最小执行计划

1. **配置 API**: 填入 DashScope API Key 到 .env
2. **跑通 Qwen Image Edit**: 用一张商品图测试 API 调用
3. **编写第一个 Prompt 模板**: 针对小包/手提包
4. **生成第一张场景图**: 人工评估质量
5. **迭代 Prompt**: 根据评估结果调整
6. **扩展到 3-5 个商品**: 覆盖不同类别
7. **记录结论**: 哪些好用，哪些需要换模型/换方案
