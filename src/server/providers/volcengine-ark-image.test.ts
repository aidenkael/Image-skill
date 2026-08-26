import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResolvedImageConfig } from '@/server/settings/ai';
import { arkSizeForRatio, VolcengineArkImageProvider } from './volcengine-ark-image';

let root = '';
let imagePath = '';
const config: ResolvedImageConfig = {
  profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', apiKey: 'ark-secret-123456', enabled: true,
  driver: 'volcengine-ark-image', endpoint: 'https://stored.example/ark', model: 'stored-seedream-model',
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ark-image-'));
  imagePath = path.join(root, 'source.jpg');
  await fs.writeFile(imagePath, Buffer.from('image-bytes'));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('Volcengine Ark 图片 Provider', () => {
  it('count=3 执行三次独立单图请求并返回三个 URL', async () => {
    const calls: Array<{ url: string; auth: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      calls.push({ url, auth: (init.headers as Record<string, string>).Authorization, body });
      return Response.json({ data: [{ url: `https://cdn.example/${calls.length}.png` }] });
    }));
    const result = await new VolcengineArkImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '3:4', count: 3 });
    expect(result.map((item) => item.url)).toEqual([
      'https://cdn.example/1.png', 'https://cdn.example/2.png', 'https://cdn.example/3.png',
    ]);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.url).toBe(config.endpoint);
      expect(call.auth).toBe(`Bearer ${config.apiKey}`);
      expect(call.body).toMatchObject({
        model: config.model, prompt: 'hero', size: '1536x2048', stream: false,
        sequential_image_generation: 'disabled', response_format: 'url', watermark: false,
      });
      expect(call.body.image).toMatch(/^data:image\/jpeg;base64,/);
    }
  });

  it('任一请求失败则整体失败，且比例映射为 2K 精确尺寸', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      return call === 2 ? new Response('{}', { status: 500 }) : Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] });
    }));
    await expect(new VolcengineArkImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '4:3', count: 3 })).rejects.toThrow(/暂时不可用/);
    expect(call).toBe(2);
    expect(arkSizeForRatio('1:1')).toBe('2048x2048');
    expect(arkSizeForRatio('4:3')).toBe('2048x1536');
  });
});
