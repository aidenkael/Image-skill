import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AliyunQwenImageProvider, qwenSizeForRatio } from './aliyun-qwen-image';
import type { ResolvedImageConfig } from '@/server/settings/ai';

let root = '';
let imagePath = '';
const config: ResolvedImageConfig = {
  profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', apiKey: 'sk-sp-exact-key',
  enabled: true, driver: 'dashscope-qwen-image', endpoint: 'https://stored.example/qwen', model: 'stored-qwen-model',
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-image-'));
  imagePath = path.join(root, 'source.png');
  await fs.writeFile(imagePath, Buffer.from('image-bytes'));
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('Qwen 图片 Provider', () => {
  it('使用精确存储的端点/模型/Key并保留参数与比例映射', async () => {
    let captured: { url?: string; authorization?: string; body?: Record<string, unknown> } = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, authorization: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) };
      return Response.json({ output: { results: [{ url: 'https://cdn.example/1.png' }, { url: 'https://cdn.example/2.png' }] } });
    }));
    const result = await new AliyunQwenImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '3:4', count: 2 });
    expect(result).toHaveLength(2);
    expect(captured.url).toBe(config.endpoint);
    expect(captured.authorization).toBe(`Bearer ${config.apiKey}`);
    expect(captured.body).toMatchObject({ model: config.model, parameters: { n: 2, prompt_extend: true, size: '768*1344' } });
    expect(JSON.stringify(captured.body)).toContain('data:image/png;base64,');
    vi.unstubAllGlobals();
  });

  it('数量不足整体失败，比例映射保持 seller 选项', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ output: { results: [{ url: 'https://cdn.example/1.png' }] } })));
    await expect(new AliyunQwenImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 2 })).rejects.toThrow(/数量不完整/);
    expect(qwenSizeForRatio('1:1')).toBe('1024*1024');
    expect(qwenSizeForRatio('4:3')).toBe('1344*768');
    vi.unstubAllGlobals();
  });
});
