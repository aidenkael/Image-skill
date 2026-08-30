import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { profileDefaults, type AIProfileInput } from '@/core/system';
import { runtimePath, writeJson } from '@/server/storage/fs-store';
import {
  AISettingsValidationError,
  createAIProfile,
  deleteAIProfile,
  getAISettingsPublic,
  maskApiKey,
  resolveActiveImageConfig,
  resolveActiveVisionConfig,
  resolveProfileImageConfig,
  resolveProfileVisionConfig,
  setActiveAIProfiles,
  updateAIProfile,
} from './ai';

const previous = {
  runtime: process.env.RUNTIME_DIR,
  key: process.env.DASHSCOPE_API_KEY,
  imageUrl: process.env.DASHSCOPE_API_URL,
  visionUrl: process.env.DASHSCOPE_VISION_API_URL,
};
let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-profiles-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_API_URL;
  delete process.env.DASHSCOPE_VISION_API_URL;
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
afterAll(() => {
  for (const [name, value] of Object.entries({
    RUNTIME_DIR: previous.runtime,
    DASHSCOPE_API_KEY: previous.key,
    DASHSCOPE_API_URL: previous.imageUrl,
    DASHSCOPE_VISION_API_URL: previous.visionUrl,
  })) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

function input(name: string, apiKey?: string, enabled = { vision: true, image: true }): AIProfileInput {
  const defaults = profileDefaults('custom');
  return {
    name, preset: 'custom', apiKey,
    vision: { ...defaults.vision, enabled: enabled.vision, endpoint: 'https://vision.example/v1/chat', model: 'vision-model' },
    image: { ...defaults.image, enabled: enabled.image, endpoint: 'https://image.example/v1/generate', model: 'image-model' },
  };
}

describe('AI Profile 设置存储', () => {
  it('创建、编辑保留/替换密钥并且公开响应永不返回全 Key', async () => {
    const firstKey = 'sk-first-super-secret';
    let settings = await createAIProfile(input('配置 A', firstKey));
    const id = settings.profiles[0].id;
    expect(settings.profiles[0].maskedKey).toBe(maskApiKey(firstKey));
    expect(JSON.stringify(settings)).not.toContain(firstKey);

    settings = await updateAIProfile(id, input('配置 A2'));
    expect((await resolveActiveVisionConfig()).apiKey).toBe(firstKey);
    expect(settings.profiles[0].name).toBe('配置 A2');

    const replacement = 'sk-replacement-secret';
    settings = await updateAIProfile(id, input('配置 A3', replacement));
    expect((await resolveActiveImageConfig()).apiKey).toBe(replacement);
    expect(JSON.stringify(settings)).not.toContain(replacement);
  });

  it('首个能力配置只填空槽，新配置不覆盖现有选择', async () => {
    const vision = await createAIProfile(input('仅识图', 'sk-vision-123456', { vision: true, image: false }));
    const visionId = vision.profiles[0].id;
    expect(vision.activeVisionProfileId).toBe(visionId);
    expect(vision.activeImageProfileId).toBeNull();
    const both = await createAIProfile(input('双能力', 'sk-both-123456'));
    expect(both.activeVisionProfileId).toBe(visionId);
    expect(both.activeImageProfileId).toBe(both.profiles[1].id);
  });

  it('活动选择只接受对应能力，禁用或删除只清理匹配的槽', async () => {
    let settings = await createAIProfile(input('双能力', 'sk-both-123456'));
    const id = settings.profiles[0].id;
    const disabled = await createAIProfile(input('全禁用', 'sk-none-123456', { vision: false, image: false }));
    const disabledId = disabled.profiles[1].id;
    await expect(setActiveAIProfiles({ visionProfileId: disabledId, imageProfileId: id }))
      .rejects.toThrow(AISettingsValidationError);

    settings = await updateAIProfile(id, input('只生图', undefined, { vision: false, image: true }));
    expect(settings.activeVisionProfileId).toBeNull();
    expect(settings.activeImageProfileId).toBe(id);
    settings = await deleteAIProfile(id);
    expect(settings.activeImageProfileId).toBeNull();
    expect(settings.profiles).toHaveLength(1);
  });

  it('启用图片能力时拒绝未替换的 WorkspaceId 模板', async () => {
    const defaults = profileDefaults('aliyun-qwen');
    await expect(createAIProfile({ name: '百炼', preset: 'aliyun-qwen', apiKey: 'sk-qwen-123456', ...defaults }))
      .rejects.toThrow('请将接口地址中的 {WorkspaceId} 替换为百炼工作空间 ID');
  });
});

describe('一次迁移与环境启动兼容', () => {
  it('优先迁移旧运行时 Key，采用显式旧端点并删除旧文件', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-env-123456';
    process.env.DASHSCOPE_API_URL = 'https://legacy.example/image';
    process.env.DASHSCOPE_VISION_API_URL = 'https://legacy.example/vision';
    await writeJson(runtimePath('settings', 'ai.json'), { apiKey: 'sk-runtime-123456' });
    const settings = await getAISettingsPublic();
    expect(settings.profiles).toHaveLength(1);
    expect(settings.profiles[0]).toMatchObject({ name: '现有百炼配置', preset: 'aliyun-qwen' });
    expect((await resolveActiveVisionConfig()).apiKey).toBe('sk-runtime-123456');
    expect((await resolveActiveImageConfig()).endpoint).toBe('https://legacy.example/image');
    await expect(fs.access(runtimePath('settings', 'ai.json'))).rejects.toThrow();
  });

  it('环境 Key 只在配置文件不存在时启动一次，删除后不会复活', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-env-bootstrap-123456';
    let settings = await getAISettingsPublic();
    expect(settings.profiles).toHaveLength(1);
    settings = await deleteAIProfile(settings.profiles[0].id);
    expect(settings.profiles).toHaveLength(0);
    expect((await getAISettingsPublic()).profiles).toHaveLength(0);
  });
});

describe('v1 → v2 配置迁移', () => {
  it('v1 配置自动迁移为 v2，保留所有 API Key、active ids、model、endpoint', async () => {
    const profileId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const now = '2026-08-28T00:00:00.000Z';
    const v1Store = {
      schemaVersion: 1,
      profiles: [{
        id: profileId,
        name: '旧配置',
        preset: 'aliyun-qwen',
        apiKey: 'sk-legacy-secret-key',
        vision: {
          enabled: true,
          driver: 'openai-compatible-vision',
          endpoint: 'https://old-vision.example/chat',
          model: 'old-vision-model',
        },
        image: {
          enabled: true,
          driver: 'dashscope-qwen-image',
          endpoint: 'https://old-image.example/generate',
          model: 'old-image-model',
        },
        createdAt: now,
        updatedAt: now,
      }],
      activeVisionProfileId: profileId,
      activeImageProfileId: profileId,
    };
    await writeJson(runtimePath('settings', 'ai-profiles.json'), v1Store);

    const settings = await getAISettingsPublic();
    expect(settings.profiles).toHaveLength(1);
    const profile = settings.profiles[0];
    expect(profile.id).toBe(profileId);
    expect(profile.name).toBe('旧配置');
    expect(profile.preset).toBe('aliyun-qwen');
    expect(profile.vision.model).toBe('old-vision-model');
    expect(profile.image.driver).toBe('dashscope-image'); // migrated
    expect(profile.image.model).toBe('old-image-model');
    expect(profile.vision.compatibility).toEqual({ imageInput: true, structuredOutput: 'auto' });
    expect(profile.image.compatibility).toMatchObject({
      referenceImage: true, batchMode: 'native', sizeMode: 'mapped',
      promptEnhancementSupported: true, maxReferenceImages: 2,
    });
    expect(settings.activeVisionProfileId).toBe(profileId);
    expect(settings.activeImageProfileId).toBe(profileId);

    // Verify the file was written as v2
    const stored = await import('node:fs/promises').then((fs) => fs.readFile(runtimePath('settings', 'ai-profiles.json'), 'utf8')).then(JSON.parse);
    expect(stored.schemaVersion).toBe(2);

    // API Key preserved
    expect((await resolveActiveVisionConfig()).apiKey).toBe('sk-legacy-secret-key');
    expect((await resolveActiveImageConfig()).apiKey).toBe('sk-legacy-secret-key');
  });

  it('v1 dashscope-qwen-image driver 迁移为 dashscope-image', async () => {
    const profileId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const now = '2026-08-28T00:00:00.000Z';
    const v1Store = {
      schemaVersion: 1,
      profiles: [{
        id: profileId, name: '迁移测试', preset: 'aliyun-qwen', apiKey: 'sk-migrate-test-123',
        vision: { enabled: false, driver: 'openai-compatible-vision', endpoint: 'https://v.example/chat', model: 'm1' },
        image: { enabled: true, driver: 'dashscope-qwen-image', endpoint: 'https://i.example/gen', model: 'm2' },
        createdAt: now, updatedAt: now,
      }],
      activeVisionProfileId: null,
      activeImageProfileId: profileId,
    };
    await writeJson(runtimePath('settings', 'ai-profiles.json'), v1Store);
    const settings = await getAISettingsPublic();
    expect(settings.profiles[0].image.driver).toBe('dashscope-image');
  });

  it('compatibility 默认来自 driver/preset，model 可为任意字符串', async () => {
    const profileId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const now = '2026-08-28T00:00:00.000Z';
    const v1Store = {
      schemaVersion: 1,
      profiles: [{
        id: profileId, name: '未来模型', preset: 'custom', apiKey: 'sk-future-model-1',
        vision: { enabled: true, driver: 'openai-compatible-vision', endpoint: 'https://v.example/chat', model: 'future-vision-model-2099' },
        image: { enabled: true, driver: 'dashscope-qwen-image', endpoint: 'https://i.example/gen', model: 'future-image-model-2099' },
        createdAt: now, updatedAt: now,
      }],
      activeVisionProfileId: profileId,
      activeImageProfileId: profileId,
    };
    await writeJson(runtimePath('settings', 'ai-profiles.json'), v1Store);
    const settings = await getAISettingsPublic();
    expect(settings.profiles[0].vision.model).toBe('future-vision-model-2099');
    expect(settings.profiles[0].image.model).toBe('future-image-model-2099');
    // Compatibility came from driver/preset, not model name
    expect(settings.profiles[0].vision.compatibility).toEqual({ imageInput: true, structuredOutput: 'auto' });
    expect(settings.profiles[0].image.compatibility.sizeMode).toBe('mapped');

    // Config resolves correctly regardless of model name
    const visionConfig = await resolveProfileVisionConfig(profileId);
    expect(visionConfig.model).toBe('future-vision-model-2099');
    expect(visionConfig.compatibility.structuredOutput).toBe('auto');

    const imageConfig = await resolveProfileImageConfig(profileId);
    expect(imageConfig.model).toBe('future-image-model-2099');
    expect(imageConfig.compatibility.referenceImage).toBe(true);
  });
});

describe('v2 配置新 capability 字段持久化', () => {
  it('旧 v2 缺少 promptEnhancementSupported/maxReferenceImages 时 Zod default 正常加载', async () => {
    const profileId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const now = '2026-08-30T00:00:00.000Z';
    const v2Store = {
      schemaVersion: 2,
      profiles: [{
        id: profileId, name: '旧 v2', preset: 'custom', apiKey: 'sk-old-v2-secret',
        vision: { enabled: false, driver: 'openai-compatible-vision', endpoint: 'https://v.example/chat', model: 'm1', compatibility: { imageInput: false, structuredOutput: 'auto' } },
        image: { enabled: true, driver: 'dashscope-image', endpoint: 'https://i.example/gen', model: 'm2',
          compatibility: { referenceImage: true, batchMode: 'native', sizeMode: 'provider-default', sizeByRatio: {}, promptEnhancement: 'auto' },
        },
        createdAt: now, updatedAt: now,
      }],
      activeVisionProfileId: null,
      activeImageProfileId: profileId,
    };
    await writeJson(runtimePath('settings', 'ai-profiles.json'), v2Store);
    const settings = await getAISettingsPublic();
    expect(settings.profiles[0].image.compatibility.promptEnhancementSupported).toBe(false);
    expect(settings.profiles[0].image.compatibility.maxReferenceImages).toBe(0);
    const config = await resolveProfileImageConfig(profileId);
    expect(config.compatibility.promptEnhancementSupported).toBe(false);
    expect(config.compatibility.maxReferenceImages).toBe(0);
  });

  it('保存/读取显式 capability（promptEnhancementSupported=false, maxReferenceImages=8）不丢失', async () => {
    const defaults = profileDefaults('custom');
    const wanInput: AIProfileInput = {
      name: 'Wan 配置', preset: 'custom', apiKey: 'sk-wan-config-123',
      vision: { ...defaults.vision, enabled: false, endpoint: 'https://v.example/chat', model: 'm1' },
      image: {
        ...defaults.image,
        enabled: true,
        endpoint: 'https://i.example/gen',
        model: 'wan2.7-image-pro',
        compatibility: {
          ...defaults.image.compatibility,
          promptEnhancementSupported: false,
          maxReferenceImages: 8,
        },
      },
    };
    const settings = await createAIProfile(wanInput);
    const id = settings.profiles[0].id;
    expect(settings.profiles[0].image.compatibility.promptEnhancementSupported).toBe(false);
    expect(settings.profiles[0].image.compatibility.maxReferenceImages).toBe(8);
    const config = await resolveProfileImageConfig(id);
    expect(config.compatibility.promptEnhancementSupported).toBe(false);
    expect(config.compatibility.maxReferenceImages).toBe(8);
  });
});
