import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResolvedImageConfig } from '@/server/settings/ai';
import { VolcengineArkImageProvider } from './volcengine-ark-image';
import { ProviderCapabilityError, ProviderConfigError } from './provider-errors';

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
    promptEnhancementSupported: false,
    maxReferenceImages: 0,
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
  it('batchMode=single count=3 执行三次独立单图请求并返回三个 URL', async () => {
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

  it('batchMode=auto 使用 single（Ark 无原生批量）', async () => {
    const autoConfig = { ...config, compatibility: { ...config.compatibility, batchMode: 'auto' as const } };
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount += 1;
      return Response.json({ data: [{ url: `https://cdn.example/${callCount}.png` }] });
    }));
    const result = await new VolcengineArkImageProvider(autoConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 2 });
    expect(result).toHaveLength(2);
    expect(callCount).toBe(2);
  });

  it('batchMode=native 请求前失败', async () => {
    const nativeConfig = { ...config, compatibility: { ...config.compatibility, batchMode: 'native' as const } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] })));
    await expect(new VolcengineArkImageProvider(nativeConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 }))
      .rejects.toThrow(ProviderConfigError);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('promptEnhancement=off 正常', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] });
    }));
    await new VolcengineArkImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    // prompt_extend should not be in the body
    expect(captured).not.toHaveProperty('prompt_extend');
  });

  it('promptEnhancement=auto 按 off 处理（不发送任何扩写参数）', async () => {
    const autoConfig = { ...config, compatibility: { ...config.compatibility, promptEnhancement: 'auto' as const } };
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] });
    }));
    await new VolcengineArkImageProvider(autoConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect(captured).not.toHaveProperty('prompt_extend');
  });

  it('promptEnhancement=on 请求前失败', async () => {
    const onConfig = { ...config, compatibility: { ...config.compatibility, promptEnhancement: 'on' as const } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] })));
    await expect(new VolcengineArkImageProvider(onConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 }))
      .rejects.toThrow(ProviderConfigError);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('mapped size 从配置读取', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] });
    }));
    await new VolcengineArkImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect(captured.size).toBe('2048x2048');
  });

  it('mapped ratio 缺失请求前失败', async () => {
    const missingRatioConfig = {
      ...config,
      compatibility: {
        ...config.compatibility,
        sizeByRatio: { '1:1': '2048x2048', '3:4': '1536x2048' }, // 缺少 4:3
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] })));
    await expect(new VolcengineArkImageProvider(missingRatioConfig).generate({ imagePath, prompt: 'hero', ratio: '4:3', count: 1 }))
      .rejects.toThrow(ProviderConfigError);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('provider-default 不发 size', async () => {
    const noSizeConfig = { ...config, compatibility: { ...config.compatibility, sizeMode: 'provider-default' as const } };
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] });
    }));
    await new VolcengineArkImageProvider(noSizeConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect(captured.size).toBeUndefined();
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

  it('referenceImage=false 在请求前失败', async () => {
    const noRefConfig = { ...config, compatibility: { ...config.compatibility, referenceImage: false } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [] })));
    await expect(new VolcengineArkImageProvider(noRefConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 }))
      .rejects.toThrow(/不支持参考图/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });
});

describe('Volcengine Ark Benchmark 能力真实性', () => {
  it('多参考图无真实支持：显式不可用错误，不发请求、不用 prompt 伪装', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] })));
    await expect(new VolcengineArkImageProvider(config).generate({
      imagePath,
      prompt: 'hero',
      ratio: '1:1',
      count: 1,
      referenceImagePaths: [path.join(root, 'ref.png')],
    })).rejects.toThrow(ProviderCapabilityError);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('请求级 promptEnhancement=on 显式拒绝（无此能力）', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [{ url: 'https://cdn.example/ok.png' }] })));
    await expect(new VolcengineArkImageProvider(config).generate({
      imagePath, prompt: 'hero', ratio: '1:1', count: 1, promptEnhancement: 'on',
    })).rejects.toThrow(ProviderCapabilityError);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('capabilities 如实声明：无多参考图、无 edit region、无扩写覆盖', () => {
    expect(new VolcengineArkImageProvider(config).capabilities()).toEqual({
      supportsMultipleReferences: false,
      maxReferenceImages: 0,
      supportsEditRegions: false,
      supportsPromptEnhancementOverride: false,
    });
  });
});
