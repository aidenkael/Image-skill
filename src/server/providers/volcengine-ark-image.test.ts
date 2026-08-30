import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResolvedImageConfig } from '@/server/settings/ai';
import { VolcengineArkImageProvider } from './volcengine-ark-image';

let root = '';
let imagePath = '';
const config: ResolvedImageConfig = {
  profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  apiKey: 'ark-secret-123456',
  enabled: true,
  driver: 'volcengine-ark-image',
  endpoint: 'https://stored.example/ark',
  model: 'any-ark-model-name',
  compatibility: {
    referenceImage: true,
    batchMode: 'single',
    sizeMode: 'mapped',
    sizeByRatio: { '1:1': '2048x2048', '3:4': '1536x2048', '4:3': '2048x1536' },
    promptEnhancement: 'off',
  },
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ark-image-'));
  imagePath = path.join(root, 'source.jpg');
  await fs.writeFile(imagePath, Buffer.from('image-bytes'));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('Volcengine Ark 图片 Provider（模型无关）', () => {
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

  it('任一请求失败则整体失败', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      return call === 2 ? new Response('{}', { status: 500 }) : Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] });
    }));
    await expect(new VolcengineArkImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '4:3', count: 3 })).rejects.toThrow(/暂时不可用/);
    expect(call).toBe(2);
  });

  it('任意 model 字符串均可工作（无模型名分支）', async () => {
    const futureConfig = { ...config, model: 'future-ark-model-2099' };
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] });
    }));
    await new VolcengineArkImageProvider(futureConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect(captured.model).toBe('future-ark-model-2099');
    expect(captured.size).toBe('2048x2048');
  });

  it('size 来自配置而非硬编码函数', async () => {
    const customSizeConfig = { ...config, compatibility: { ...config.compatibility, sizeByRatio: { '1:1': '4096x4096', '3:4': '3072x4096', '4:3': '4096x3072' } } };
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] });
    }));
    await new VolcengineArkImageProvider(customSizeConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect(captured.size).toBe('4096x4096');
  });

  it('provider-default 不发送 size', async () => {
    const noSizeConfig = { ...config, compatibility: { ...config.compatibility, sizeMode: 'provider-default' as const } };
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] });
    }));
    await new VolcengineArkImageProvider(noSizeConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect(captured.size).toBeUndefined();
  });

  it('referenceImage=false 在请求前失败', async () => {
    const noRefConfig = { ...config, compatibility: { ...config.compatibility, referenceImage: false } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [] })));
    await expect(new VolcengineArkImageProvider(noRefConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 }))
      .rejects.toThrow(/不支持参考图/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});
