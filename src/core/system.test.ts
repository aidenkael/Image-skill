import { describe, expect, it } from 'vitest';
import { AIProfileInputSchema, profileDefaults } from './system';

describe('AI Provider 预设', () => {
  it('百炼填充 Qwen 双能力默认值且字段可覆盖', () => {
    const defaults = profileDefaults('aliyun-qwen');
    expect(defaults.vision).toMatchObject({ enabled: true, driver: 'openai-compatible-vision', model: 'qwen3.7-plus' });
    expect(defaults.image).toMatchObject({ enabled: true, driver: 'dashscope-qwen-image', model: 'qwen-image-3.0-pro' });
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
    const custom = profileDefaults('custom');
    expect(custom.vision.enabled).toBe(false);
    expect(custom.image.enabled).toBe(false);
  });
});
