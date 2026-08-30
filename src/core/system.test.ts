import { describe, expect, it } from 'vitest';
import { AIProfileInputSchema, profileDefaults } from './system';

describe('AI Provider 预设', () => {
  it('百炼填充双能力默认值且字段可覆盖', () => {
    const defaults = profileDefaults('aliyun-qwen');
    expect(defaults.vision).toMatchObject({ enabled: true, driver: 'openai-compatible-vision', model: 'qwen3.7-plus' });
    expect(defaults.vision.compatibility).toEqual({ imageInput: true, structuredOutput: 'auto' });
    expect(defaults.image).toMatchObject({ enabled: true, driver: 'dashscope-image', model: 'qwen-image-3.0-pro' });
    expect(defaults.image.compatibility).toMatchObject({
      referenceImage: true, batchMode: 'native', sizeMode: 'mapped', promptEnhancement: 'auto',
    });
    expect(defaults.image.compatibility.sizeByRatio).toEqual({ '1:1': '1024*1024', '3:4': '768*1344', '4:3': '1344*768' });

    const edited = AIProfileInputSchema.safeParse({
      name: '自定义百炼', preset: 'aliyun-qwen', apiKey: 'sk-12345678',
      vision: { ...defaults.vision, endpoint: 'https://edited.example/vision', model: 'edited-vision' },
      image: { ...defaults.image, endpoint: 'https://edited.example/image', model: 'edited-image' },
    });
    expect(edited.success).toBe(true);
  });

  it('火山默认仅启用生图，自定义仍可选择已实现协议', () => {
    const ark = profileDefaults('volcengine-ark');
    expect(ark.vision.enabled).toBe(false);
    expect(ark.image).toMatchObject({ enabled: true, driver: 'volcengine-ark-image', model: 'doubao-seedream-4-0-250828' });
    expect(ark.image.compatibility).toMatchObject({
      referenceImage: true, batchMode: 'single', sizeMode: 'mapped', promptEnhancement: 'off',
    });
    const custom = profileDefaults('custom');
    expect(custom.vision.enabled).toBe(false);
    expect(custom.image.enabled).toBe(false);
  });

  it('任意未来模型名可通过 schema 校验（model 是 opaque string）', () => {
    const visionDefaults = profileDefaults('aliyun-qwen').vision;
    const imageDefaults = profileDefaults('aliyun-qwen').image;

    const futureVision = AIProfileInputSchema.safeParse({
      name: '未来视觉', preset: 'custom', apiKey: 'sk-12345678',
      vision: { ...visionDefaults, model: 'future-vision-model-2099' },
      image: { ...imageDefaults, endpoint: 'https://edited.example/image', model: 'future-image-model-2099' },
    });
    expect(futureVision.success).toBe(true);

    const futureImage = AIProfileInputSchema.safeParse({
      name: '未来生图', preset: 'custom', apiKey: 'sk-12345678',
      vision: { ...visionDefaults, enabled: false },
      image: { ...imageDefaults, endpoint: 'https://edited.example/image', model: 'future-image-model-2099' },
    });
    expect(futureImage.success).toBe(true);
  });

  it('compatibility 字段缺失时 schema 拒绝', () => {
    const visionNoCompat = {
      enabled: true, driver: 'openai-compatible-vision',
      endpoint: 'https://vision.example', model: 'some-model',
    };
    const imageDefaults = profileDefaults('aliyun-qwen').image;
    const result = AIProfileInputSchema.safeParse({
      name: '缺字段', preset: 'custom', apiKey: 'sk-12345678',
      vision: visionNoCompat,
      image: imageDefaults,
    });
    expect(result.success).toBe(false);
  });
});
