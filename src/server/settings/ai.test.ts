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
