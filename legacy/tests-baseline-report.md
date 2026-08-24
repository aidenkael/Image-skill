# 基线测试报告

> 测试日期：待填写

## 测试目标

验证"原始开源方案 + 图片模型"能否生成一张高质量、完整真人自然使用商品的真实场景图。

## 测试线

### Line A: product-shots 原版 + OmniMaaS (Gemini)

- **Skill 版本**: motiful/product-shots (clone 于 skills/product-shots/)
- **调用脚本**: skills/product-shots/skills/product-shots-image-gen/scripts/generate.py
- **模型**: gemini-3-pro-image-preview（product-shots 默认）
- **网关**: OmniMaaS (api.omnimaas.com)
- **Prompt 来源**: product-shots 原版 Skill 生成（未修改）
- **输入图片**: 待填写
- **输出图片**: 待填写
- **结果**: 待测试

### Line B: Qwen Image Edit 直接调用

- **调用脚本**: scripts/test_qwen_edit.py
- **模型**: qwen-image-edit-plus
- **API**: DashScope (dashscope.aliyuncs.com)
- **Prompt**: 待填写
- **输入图片**: 待填写
- **输出图片**: 待填写
- **结果**: 待测试

## 评估结果

| 指标 | Line A | Line B |
|------|--------|--------|
| 商品是否改变 | - | - |
| 真人是否自然 | - | - |
| 场景是否合理 | - | - |
| AI 味是否明显 | - | - |
| 一次可用率 | - | - |
| 单张成本 | - | - |

## 关键发现

（测试后填写）

## 下一步

（测试后填写）
