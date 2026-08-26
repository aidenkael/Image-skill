import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearRuntimeAIKey,
  getAISettingsStatus,
  maskApiKey,
  resolveAICredential,
  saveRuntimeAIKey,
} from './ai';

const previousRuntime = process.env.RUNTIME_DIR;
const previousKey = process.env.DASHSCOPE_API_KEY;
let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-settings-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
  delete process.env.DASHSCOPE_API_KEY;
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
afterAll(() => {
  if (previousRuntime === undefined) delete process.env.RUNTIME_DIR;
  else process.env.RUNTIME_DIR = previousRuntime;
  if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY;
  else process.env.DASHSCOPE_API_KEY = previousKey;
});

describe('本地 AI 设置与凭据解析', () => {
  it('运行时 Key 覆盖环境变量，清除后回退环境变量', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-environment-123456';
    await saveRuntimeAIKey('sk-runtime-abcdef123456');
    await expect(resolveAICredential()).resolves.toEqual({
      apiKey: 'sk-runtime-abcdef123456', source: 'runtime',
    });
    await expect(clearRuntimeAIKey()).resolves.toMatchObject({
      configured: true, source: 'environment',
    });
    await expect(resolveAICredential()).resolves.toEqual({
      apiKey: 'sk-environment-123456', source: 'environment',
    });
  });

  it('无 Key 时未配置，公开响应只含掩码且永不返回全 Key', async () => {
    await expect(getAISettingsStatus()).resolves.toMatchObject({
      configured: false, source: 'none', maskedKey: null,
      provider: '阿里云百炼 / DashScope',
      visionModel: 'qwen3.7-plus',
      imageModel: 'qwen-image-3.0-pro',
    });
    const fullKey = 'sk-runtime-super-secret-1234';
    const status = await saveRuntimeAIKey(fullKey);
    expect(status.maskedKey).toBe(maskApiKey(fullKey));
    expect(JSON.stringify(status)).not.toContain(fullKey);
  });
});
