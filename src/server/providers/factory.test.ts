import { beforeEach, describe, expect, it, vi } from 'vitest';

const { visionConfig, imageConfig } = vi.hoisted(() => ({ visionConfig: vi.fn(), imageConfig: vi.fn() }));
vi.mock('@/server/settings/ai', async (original) => ({
  ...await original<typeof import('@/server/settings/ai')>(),
  resolveActiveVisionConfig: visionConfig,
  resolveActiveImageConfig: imageConfig,
}));
import { createActiveImageProvider, createActiveVisionProvider } from './factory';
import { OpenAICompatibleVisionProvider } from './openai-compatible-vision';
import { DashScopeImageProvider } from './dashscope-image';
import { VolcengineArkImageProvider } from './volcengine-ark-image';
import { AISettingsValidationError } from '@/server/settings/ai';

beforeEach(() => { vi.clearAllMocks(); });

const baseVisionCompat = { imageInput: true, structuredOutput: 'auto' as const };
const baseImageCompat = { referenceImage: true, batchMode: 'native' as const, sizeMode: 'mapped' as const, sizeByRatio: { '1:1': '1024*1024', '3:4': '768*1344', '4:3': '1344*768' }, promptEnhancement: 'auto' as const };

describe('Provider 工厂（只按 driver 分派）', () => {
  it('openai-compatible-vision driver → OpenAICompatibleVisionProvider', async () => {
    visionConfig.mockResolvedValue({ profileId: 'v', apiKey: 'vision-key', enabled: true, driver: 'openai-compatible-vision', endpoint: 'https://v.example', model: 'any-vision-model', compatibility: baseVisionCompat });
    await expect(createActiveVisionProvider()).resolves.toBeInstanceOf(OpenAICompatibleVisionProvider);
  });

  it('dashscope-image driver → DashScopeImageProvider', async () => {
    imageConfig.mockResolvedValue({ profileId: 'i', apiKey: 'image-key', enabled: true, driver: 'dashscope-image', endpoint: 'https://i.example', model: 'any-image-model', compatibility: baseImageCompat });
    await expect(createActiveImageProvider()).resolves.toBeInstanceOf(DashScopeImageProvider);
  });

  it('volcengine-ark-image driver → VolcengineArkImageProvider', async () => {
    imageConfig.mockResolvedValue({ profileId: 'i', apiKey: 'image-key', enabled: true, driver: 'volcengine-ark-image', endpoint: 'https://i.example', model: 'any-ark-model', compatibility: { ...baseImageCompat, batchMode: 'single' } });
    await expect(createActiveImageProvider()).resolves.toBeInstanceOf(VolcengineArkImageProvider);
  });

  it('任意 model 名不影响 adapter 选择', async () => {
    visionConfig.mockResolvedValue({ profileId: 'v', apiKey: 'vision-key', enabled: true, driver: 'openai-compatible-vision', endpoint: 'https://v.example', model: 'future-vision-model-2099', compatibility: baseVisionCompat });
    imageConfig.mockResolvedValue({ profileId: 'i', apiKey: 'image-key', enabled: true, driver: 'dashscope-image', endpoint: 'https://i.example', model: 'future-image-model-2099', compatibility: baseImageCompat });
    await expect(createActiveVisionProvider()).resolves.toBeInstanceOf(OpenAICompatibleVisionProvider);
    await expect(createActiveImageProvider()).resolves.toBeInstanceOf(DashScopeImageProvider);
  });

  it('未选择活动配置时转换为清晰 Provider 配置错误', async () => {
    visionConfig.mockRejectedValue(new AISettingsValidationError('未选择商品分析 API 配置，请先在 AI 设置中选择。'));
    await expect(createActiveVisionProvider()).rejects.toThrow('未选择商品分析 API 配置');
  });
});
