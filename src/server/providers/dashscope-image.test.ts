import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ResolvedImageConfig } from '@/server/settings/ai';
import { DashScopeImageProvider } from './dashscope-image';
import { ProviderConfigError } from './provider-errors';

let root = '';
let imagePath = '';
const baseCompat = {
  referenceImage: true,
  batchMode: 'native' as const,
  sizeMode: 'mapped' as const,
  sizeByRatio: { '1:1': '1024*1024', '3:4': '768*1344', '4:3': '1344*768' },
  promptEnhancement: 'auto' as const,
};
const config: ResolvedImageConfig = {
  profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  apiKey: 'dashscope-test-key',
  enabled: true,
  driver: 'dashscope-image',
  endpoint: 'https://stored.example/dashscope',
  model: 'future-image-model-2099',
  compatibility: baseCompat,
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'dashscope-image-'));
  imagePath = path.join(root, 'source.jpg');
  await fs.writeFile(imagePath, Buffer.from('image-bytes'));
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

function nativeBatchResponse(count: number) {
  let captured: Record<string, unknown> = {};
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    captured = JSON.parse(String(init.body));
    const choices = Array.from({ length: count }, (_, i) => ({
      message: { content: [{ image: `https://cdn.example/img-${i + 1}.png` }] },
    }));
    return Response.json({ output: { choices } });
  }));
  return () => captured;
}

function singleLoopResponses() {
  let callCount = 0;
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    bodies.push(body);
    callCount += 1;
    return Response.json({ output: { choices: [{ message: { content: [{ image: `https://cdn.example/img-${callCount}.png` }] } }] } });
  }));
  return { getBodies: () => bodies, getCount: () => callCount };
}

describe('DashScope Image Provider（模型无关）', () => {
  it('future-image-model-2099 原样进入 payload（model 是 opaque string）', async () => {
    const getBody = nativeBatchResponse(1);
    await new DashScopeImageProvider(config).generate({ imagePath, prompt: 'hero scene', ratio: '1:1', count: 1 });
    expect(getBody().model).toBe('future-image-model-2099');
  });

  it('size 来自 sizeByRatio 配置而非硬编码函数', async () => {
    const getBody = nativeBatchResponse(1);
    await new DashScopeImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '3:4', count: 1 });
    expect((getBody().parameters as Record<string, unknown>).size).toBe('768*1344');
  });

  it('provider-default 模式不发送 size', async () => {
    const noSizeConfig = { ...config, compatibility: { ...baseCompat, sizeMode: 'provider-default' as const } };
    const getBody = nativeBatchResponse(1);
    await new DashScopeImageProvider(noSizeConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect((getBody().parameters as Record<string, unknown>).size).toBeUndefined();
  });

  it('batchMode=native 发送一次请求且 n=count', async () => {
    const getBody = nativeBatchResponse(3);
    const result = await new DashScopeImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 3 });
    expect(result).toHaveLength(3);
    expect((getBody().parameters as Record<string, unknown>).n).toBe(3);
  });

  it('batchMode=single 循环 count 次', async () => {
    const singleConfig = { ...config, compatibility: { ...baseCompat, batchMode: 'single' as const } };
    const { getBodies, getCount } = singleLoopResponses();
    const result = await new DashScopeImageProvider(singleConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 3 });
    expect(result).toHaveLength(3);
    expect(getCount()).toBe(3);
    for (const body of getBodies()) {
      expect((body.parameters as Record<string, unknown>).n).toBe(1);
    }
  });

  it('batchMode=auto 在 native 不支持时降级为 single', async () => {
    const autoConfig = { ...config, compatibility: { ...baseCompat, batchMode: 'auto' as const } };
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      callCount += 1;
      const body = JSON.parse(String(init.body));
      if (callCount === 1) {
        expect((body.parameters as Record<string, unknown>).n).toBe(2);
        return Response.json({ error: { message: 'n is not supported, max n is 1' } }, { status: 400 });
      }
      return Response.json({ output: { choices: [{ message: { content: [{ image: `https://cdn.example/single-${callCount}.png` }] } }] } });
    }));
    const result = await new DashScopeImageProvider(autoConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 2 });
    expect(result).toHaveLength(2);
    expect(callCount).toBe(3); // 1 native fail + 2 single
  });

  it('promptEnhancement=on → 发送 prompt_extend=true', async () => {
    const onConfig = { ...config, compatibility: { ...baseCompat, promptEnhancement: 'on' as const } };
    const getBody = nativeBatchResponse(1);
    await new DashScopeImageProvider(onConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect((getBody().parameters as Record<string, unknown>).prompt_extend).toBe(true);
  });

  it('promptEnhancement=off → 不发送 prompt_extend', async () => {
    const offConfig = { ...config, compatibility: { ...baseCompat, promptEnhancement: 'off' as const } };
    const getBody = nativeBatchResponse(1);
    await new DashScopeImageProvider(offConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect((getBody().parameters as Record<string, unknown>).prompt_extend).toBeUndefined();
  });

  it('promptEnhancement=auto → 发送 prompt_extend=true', async () => {
    const getBody = nativeBatchResponse(1);
    await new DashScopeImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect((getBody().parameters as Record<string, unknown>).prompt_extend).toBe(true);
  });

  it('referenceImage=false 在请求前失败', async () => {
    const noRefConfig = { ...config, compatibility: { ...baseCompat, referenceImage: false } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ output: { choices: [] } })));
    await expect(new DashScopeImageProvider(noRefConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 }))
      .rejects.toThrow(/不支持参考图/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('返回数量不足时抛出错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ output: { choices: [{ message: { content: [{ image: 'https://cdn.example/1.png' }] } }] } })));
    await expect(new DashScopeImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 3 }))
      .rejects.toThrow(/结果数量不完整/);
  });

  it('任意 model 字符串均可工作', async () => {
    const anyModelConfig = { ...config, model: 'some-random-model-xyz' };
    const getBody = nativeBatchResponse(1);
    await new DashScopeImageProvider(anyModelConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect(getBody().model).toBe('some-random-model-xyz');
  });
});
