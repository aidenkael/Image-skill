import { beforeEach, describe, expect, it, vi } from 'vitest';

const { visionConfig, imageConfig } = vi.hoisted(() => ({ visionConfig: vi.fn(), imageConfig: vi.fn() }));
vi.mock('@/server/settings/ai', async (original) => ({
  ...await original<typeof import('@/server/settings/ai')>(),
  resolveActiveVisionConfig: visionConfig,
  resolveActiveImageConfig: imageConfig,
}));
import { createActiveImageProvider, createActiveVisionProvider } from './factory';
import { AliyunQwenVisionProvider } from './aliyun-qwen-vision';
import { VolcengineArkImageProvider } from './volcengine-ark-image';
import { AISettingsValidationError } from '@/server/settings/ai';

beforeEach(() => { vi.clearAllMocks(); });

describe('Provider 工厂', () => {
  it('识图与生图分别消费各自活动配置', async () => {
    visionConfig.mockResolvedValue({ profileId: 'v', apiKey: 'vision-key', enabled: true, driver: 'openai-compatible-vision', endpoint: 'https://v.example', model: 'v-model' });
    imageConfig.mockResolvedValue({ profileId: 'i', apiKey: 'image-key', enabled: true, driver: 'volcengine-ark-image', endpoint: 'https://i.example', model: 'i-model' });
    await expect(createActiveVisionProvider()).resolves.toBeInstanceOf(AliyunQwenVisionProvider);
    await expect(createActiveImageProvider()).resolves.toBeInstanceOf(VolcengineArkImageProvider);
  });

  it('未选择活动配置时转换为清晰 Provider 配置错误', async () => {
    visionConfig.mockRejectedValue(new AISettingsValidationError('未选择商品分析 API 配置，请先在 AI 设置中选择。'));
    await expect(createActiveVisionProvider()).rejects.toThrow('未选择商品分析 API 配置');
  });
});
