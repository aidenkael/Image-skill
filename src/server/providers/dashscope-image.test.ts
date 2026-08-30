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
  batchMode: 'single' as const,
  sizeMode: 'mapped' as const,
  sizeByRatio: { '1:1': '1024*1024', '3:4': '768*1344', '4:3': '1344*768' },
  promptEnhancement: 'auto' as const,
  promptEnhancementSupported: true as const,
  maxReferenceImages: 2,
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
  for (const name of ['ref-1.png', 'ref-2.png', 'ref-3.png']) {
    await fs.writeFile(path.join(root, name), Buffer.from(`ref-${name}`));
  }
});
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

function singleLoopResponses(count: number) {
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

describe('DashScope Image Provider（模型无关）', () => {
  it('future-image-model-2099 原样进入 payload（model 是 opaque string）', async () => {
    const getBody = nativeBatchResponse(1);
    const nativeConfig = { ...config, compatibility: { ...baseCompat, batchMode: 'native' as const } };
    await new DashScopeImageProvider(nativeConfig).generate({ imagePath, prompt: 'hero scene', ratio: '1:1', count: 1 });
    expect(getBody().model).toBe('future-image-model-2099');
  });

  it('size 来自 sizeByRatio 配置而非硬编码函数', async () => {
    const getBody = nativeBatchResponse(1);
    const nativeConfig = { ...config, compatibility: { ...baseCompat, batchMode: 'native' as const } };
    await new DashScopeImageProvider(nativeConfig).generate({ imagePath, prompt: 'hero', ratio: '3:4', count: 1 });
    expect((getBody().parameters as Record<string, unknown>).size).toBe('768*1344');
  });

  it('provider-default 模式不发送 size', async () => {
    const noSizeConfig = { ...config, compatibility: { ...baseCompat, sizeMode: 'provider-default' as const } };
    const { getBodies } = singleLoopResponses(1);
    await new DashScopeImageProvider(noSizeConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect((getBodies()[0].parameters as Record<string, unknown>).size).toBeUndefined();
  });

  it('single count=4 全正常 → 4 requests / 4 outputs', async () => {
    const { getCount } = singleLoopResponses(4);
    const result = await new DashScopeImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 4 });
    expect(result).toHaveLength(4);
    expect(getCount()).toBe(4);
  });

  it('single count=4，第2张 prompt_extend unsupported + auto → 第2张重试 + 后续不带 prompt_extend → 4 outputs', async () => {
    let callCount = 0;
    const bodies: Record<string, unknown>[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      callCount += 1;
      const body = JSON.parse(String(init.body));
      bodies.push(body);
      // 2nd request (i=1, first attempt) → prompt_extend unsupported
      if (callCount === 2) {
        return Response.json({ error: { message: 'prompt_extend is not supported' } }, { status: 400 });
      }
      return Response.json({ output: { choices: [{ message: { content: [{ image: `https://cdn.example/img-${callCount}.png` }] } }] } });
    }));
    const result = await new DashScopeImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 4 });
    expect(result).toHaveLength(4);
    // 4 images: img1 ok, img2 prompt_extend fail → retry ok, img3 ok, img4 ok = 5 calls
    expect(callCount).toBe(5);
    // After downgrade, subsequent requests should NOT have prompt_extend
    const params3 = bodies[3].parameters as Record<string, unknown>;
    expect(params3.prompt_extend).toBeUndefined();
    const params4 = bodies[4].parameters as Record<string, unknown>;
    expect(params4.prompt_extend).toBeUndefined();
  });

  it('promptEnhancement=on + prompt_extend unsupported → 不降级，明确失败', async () => {
    const onConfig = { ...config, compatibility: { ...baseCompat, promptEnhancement: 'on' as const } };
    vi.stubGlobal('fetch', vi.fn(async () => {
      return Response.json({ error: { message: 'prompt_extend is not supported' } }, { status: 400 });
    }));
    await expect(new DashScopeImageProvider(onConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 }))
      .rejects.toThrow(ProviderConfigError);
  });

  it('native + batchMode=native + n unsupported → 不降级 single，明确失败', async () => {
    const nativeConfig = { ...config, compatibility: { ...baseCompat, batchMode: 'native' as const } };
    vi.stubGlobal('fetch', vi.fn(async () => {
      return Response.json({ error: { message: 'n is not supported, max n is 1' } }, { status: 400 });
    }));
    await expect(new DashScopeImageProvider(nativeConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 3 }))
      .rejects.toThrow(/不支持|not support|batch/i);
  });

  it('batchMode=auto + native n unsupported → 降级为 single', async () => {
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
    const { getBodies } = singleLoopResponses(1);
    await new DashScopeImageProvider(onConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect((getBodies()[0].parameters as Record<string, unknown>).prompt_extend).toBe(true);
  });

  it('promptEnhancement=off + supported → 发送 prompt_extend=false', async () => {
    const offConfig = { ...config, compatibility: { ...baseCompat, promptEnhancement: 'off' as const } };
    const { getBodies } = singleLoopResponses(1);
    await new DashScopeImageProvider(offConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect((getBodies()[0].parameters as Record<string, unknown>).prompt_extend).toBe(false);
  });

  it('promptEnhancement=auto → 发送 prompt_extend=true', async () => {
    const { getBodies } = singleLoopResponses(1);
    await new DashScopeImageProvider(config).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect((getBodies()[0].parameters as Record<string, unknown>).prompt_extend).toBe(true);
  });

  it('referenceImage=false 在请求前失败', async () => {
    const noRefConfig = { ...config, compatibility: { ...baseCompat, referenceImage: false } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ output: { choices: [] } })));
    await expect(new DashScopeImageProvider(noRefConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 }))
      .rejects.toThrow(/不支持参考图/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('返回数量不足时抛出错误', async () => {
    const nativeConfig = { ...config, compatibility: { ...baseCompat, batchMode: 'native' as const } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ output: { choices: [{ message: { content: [{ image: 'https://cdn.example/1.png' }] } }] } })));
    await expect(new DashScopeImageProvider(nativeConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 3 }))
      .rejects.toThrow(/结果数量不完整/);
  });

  it('mapped 当前 ratio 缺失 → ProviderConfigError', async () => {
    const missingRatioConfig = {
      ...config,
      compatibility: {
        ...baseCompat,
        sizeByRatio: { '1:1': '1024*1024', '3:4': '768*1344' }, // 缺少 4:3
      },
    };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ output: { choices: [{ message: { content: [{ image: 'https://cdn.example/1.png' }] } }] } })));
    await expect(new DashScopeImageProvider(missingRatioConfig).generate({ imagePath, prompt: 'hero', ratio: '4:3', count: 1 }))
      .rejects.toThrow(ProviderConfigError);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('任意 model 字符串均可工作', async () => {
    const anyModelConfig = { ...config, model: 'some-random-model-xyz' };
    const getBody = nativeBatchResponse(1);
    const nativeConfig = { ...anyModelConfig, compatibility: { ...baseCompat, batchMode: 'native' as const } };
    await new DashScopeImageProvider(nativeConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect(getBody().model).toBe('some-random-model-xyz');
  });
});

describe('DashScope Benchmark 请求变量（多参考图 + 请求级扩写覆盖）', () => {
  function contentImages(body: Record<string, unknown>): string[] {
    const input = body.input as { messages: Array<{ content: Array<Record<string, unknown>> }> };
    return input.messages[0].content.filter((item) => typeof item.image === 'string').map(() => 'image');
  }

  it('qwen-single-extend-on：仅主图 + prompt_extend=true', async () => {
    const { getBodies } = singleLoopResponses(1);
    await new DashScopeImageProvider(config).generate({
      imagePath, prompt: 'hero', ratio: '1:1', count: 1, promptEnhancement: 'on',
    });
    const body = getBodies()[0];
    expect(contentImages(body)).toHaveLength(1);
    expect((body.parameters as Record<string, unknown>).prompt_extend).toBe(true);
  });

  it('qwen-single-extend-off：仅主图 + prompt_extend=false（off 明确关闭）', async () => {
    const onConfig = { ...config, compatibility: { ...baseCompat, promptEnhancement: 'on' as const } };
    const { getBodies } = singleLoopResponses(1);
    await new DashScopeImageProvider(onConfig).generate({
      imagePath, prompt: 'hero', ratio: '1:1', count: 1, promptEnhancement: 'off',
    });
    const body = getBodies()[0];
    expect(contentImages(body)).toHaveLength(1);
    expect((body.parameters as Record<string, unknown>).prompt_extend).toBe(false);
  });

  it('qwen-multi-ref：主图 + 2 张细节参考图 + prompt_extend 关闭', async () => {
    const { getBodies } = singleLoopResponses(1);
    await new DashScopeImageProvider(config).generate({
      imagePath,
      prompt: 'hero',
      ratio: '1:1',
      count: 1,
      referenceImagePaths: [path.join(root, 'ref-1.png'), path.join(root, 'ref-2.png')],
      promptEnhancement: 'off',
    });
    const body = getBodies()[0];
    const input = body.input as { messages: Array<{ content: Array<Record<string, unknown>> }> };
    const content = input.messages[0].content;
    expect(content.filter((item) => typeof item.image === 'string')).toHaveLength(3);
    expect(content[content.length - 1]).toMatchObject({ text: 'hero' });
    expect((body.parameters as Record<string, unknown>).prompt_extend).toBe(false);
  });

  it('超过配置的 maxReferenceImages 上限在请求前明确拒绝', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ output: { choices: [] } })));
    await expect(new DashScopeImageProvider(config).generate({
      imagePath,
      prompt: 'hero',
      ratio: '1:1',
      count: 1,
      referenceImagePaths: [
        path.join(root, 'ref-1.png'), path.join(root, 'ref-2.png'), path.join(root, 'ref-3.png'),
      ],
    })).rejects.toThrow(/最多支持 2 张额外参考图/);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it('capabilities 从配置读取，而非硬编码常量', () => {
    expect(new DashScopeImageProvider(config).capabilities()).toEqual({
      supportsMultipleReferences: true,
      maxReferenceImages: 2,
      supportsEditRegions: false,
      supportsPromptEnhancementOverride: true,
    });
  });
});

describe('DashScope prompt_extend 能力隔离（promptEnhancementSupported）', () => {
  it('unsupported + on → payload 不含 prompt_extend', async () => {
    const noSupportConfig = { ...config, compatibility: { ...baseCompat, promptEnhancementSupported: false as const, promptEnhancement: 'on' as const } };
    const { getBodies } = singleLoopResponses(1);
    await new DashScopeImageProvider(noSupportConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect((getBodies()[0].parameters as Record<string, unknown>).prompt_extend).toBeUndefined();
  });

  it('unsupported + off → payload 不含 prompt_extend', async () => {
    const noSupportConfig = { ...config, compatibility: { ...baseCompat, promptEnhancementSupported: false as const, promptEnhancement: 'off' as const } };
    const { getBodies } = singleLoopResponses(1);
    await new DashScopeImageProvider(noSupportConfig).generate({ imagePath, prompt: 'hero', ratio: '1:1', count: 1 });
    expect((getBodies()[0].parameters as Record<string, unknown>).prompt_extend).toBeUndefined();
  });

  it('maxReferenceImages=8 时 3 个额外参考图不被拒绝', async () => {
    const wideConfig = { ...config, compatibility: { ...baseCompat, maxReferenceImages: 8 } };
    const { getBodies } = singleLoopResponses(1);
    await new DashScopeImageProvider(wideConfig).generate({
      imagePath,
      prompt: 'hero',
      ratio: '1:1',
      count: 1,
      referenceImagePaths: [path.join(root, 'ref-1.png'), path.join(root, 'ref-2.png'), path.join(root, 'ref-3.png')],
    });
    const body = getBodies()[0];
    const input = body.input as { messages: Array<{ content: Array<Record<string, unknown>> }> };
    expect(input.messages[0].content.filter((item) => typeof item.image === 'string')).toHaveLength(4);
  });

  it('maxReferenceImages=0 时 capabilities 如实声明不支持多参考图', () => {
    const noRefConfig = { ...config, compatibility: { ...baseCompat, maxReferenceImages: 0 } };
    const caps = new DashScopeImageProvider(noRefConfig).capabilities();
    expect(caps.supportsMultipleReferences).toBe(false);
    expect(caps.maxReferenceImages).toBe(0);
  });
});
