import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DELETE, PUT } from './[profileId]/route';
import { GET, PATCH, POST } from './route';

const previousRuntime = process.env.RUNTIME_DIR;
const previousKey = process.env.DASHSCOPE_API_KEY;
let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-route-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
  delete process.env.DASHSCOPE_API_KEY;
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
afterAll(() => {
  if (previousRuntime === undefined) delete process.env.RUNTIME_DIR; else process.env.RUNTIME_DIR = previousRuntime;
  if (previousKey === undefined) delete process.env.DASHSCOPE_API_KEY; else process.env.DASHSCOPE_API_KEY = previousKey;
});

function request(method: string, body: unknown) {
  return new Request('http://localhost/api/system/ai-settings', {
    method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function input(name: string, apiKey?: string) {
  return {
    name, preset: 'custom', apiKey,
    vision: { enabled: true, driver: 'openai-compatible-vision', endpoint: 'https://vision.example/v1', model: 'vision', compatibility: { imageInput: true, structuredOutput: 'auto' } },
    image: { enabled: true, driver: 'volcengine-ark-image', endpoint: 'https://image.example/v1', model: 'image', compatibility: { referenceImage: true, batchMode: 'single', sizeMode: 'mapped', sizeByRatio: { '1:1': '2048x2048', '3:4': '1536x2048', '4:3': '2048x1536' }, promptEnhancement: 'off' } },
  };
}

describe('AI 设置 REST 路由', () => {
  it('CRUD 与活动选择均返回更新后的无密钥公开设置', async () => {
    const secret = 'sk-route-secret-123456';
    const createdResponse = await POST(request('POST', input('配置 A', secret)));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json();
    expect(JSON.stringify(created)).not.toContain(secret);
    const id = created.profiles[0].id as string;

    const patchedResponse = await PATCH(request('PATCH', { visionProfileId: id, imageProfileId: null }));
    expect(await patchedResponse.json()).toMatchObject({ activeVisionProfileId: id, activeImageProfileId: null });

    const updatedResponse = await PUT(request('PUT', input('配置 B')), { params: Promise.resolve({ profileId: id }) });
    const updated = await updatedResponse.json();
    expect(updated.profiles[0].name).toBe('配置 B');
    expect(JSON.stringify(updated)).not.toContain(secret);

    const getResponse = await GET();
    expect(JSON.stringify(await getResponse.json())).not.toContain(secret);
    const deletedResponse = await DELETE(new Request('http://localhost'), { params: Promise.resolve({ profileId: id }) });
    expect((await deletedResponse.json()).profiles).toHaveLength(0);
  });
});
