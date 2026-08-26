import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {
  AliyunQwenImageProvider,
  DEFAULT_DASHSCOPE_API_URL,
  QWEN_IMAGE_MODEL,
  TOKEN_PLAN_API_URL,
  resolveDashScopeApiUrl,
} from './aliyun-qwen-image';
import { ProviderConfigError, ProviderRequestError } from './image-provider';

/**
 * Provider 定向测试：不消耗付费额度（fetch 全部打桩）。
 * 覆盖：无 Key 配置错误、模型与参数（n / size / prompt_extend=true）、
 * 请求内容构造、端点选择。
 */

let workDir: string;
let imagePath: string;

interface CapturedRequest {
  url?: string;
  headers?: Record<string, string>;
  payload?: {
    model: string;
    input: { messages: { role: string; content: { image?: string; text?: string }[] }[] };
    parameters: { n: number; prompt_extend: boolean; size: string };
  };
}

function stubFetch(images: { url: string }[], captured: CapturedRequest) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    captured.url = String(url);
    captured.headers = init.headers as Record<string, string>;
    captured.payload = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ output: { results: images } }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-provider-test-'));
  process.env.RUNTIME_DIR = path.join(workDir, '.runtime');
  imagePath = path.join(workDir, 'input.png');
  await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } })
    .png()
    .toFile(imagePath);
});

afterAll(async () => {
  delete process.env.RUNTIME_DIR;
  await fs.rm(workDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_API_URL;
});

describe('AliyunQwenImageProvider', () => {
  it('未配置 DASHSCOPE_API_KEY 时抛出明确的 ProviderConfigError', async () => {
    delete process.env.DASHSCOPE_API_KEY;
    const provider = new AliyunQwenImageProvider();
    await expect(
      provider.generate({ imagePath, prompt: 'p', size: '1024*1024', count: 1 }),
    ).rejects.toThrowError(ProviderConfigError);
    await expect(
      provider.generate({ imagePath, prompt: 'p', size: '1024*1024', count: 1 }),
    ).rejects.toThrow(/AI 尚未配置/);
  });

  it('请求体使用 qwen-image-3.0-pro，且 n / size / prompt_extend 正确', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-key';
    const captured: CapturedRequest = {};
    stubFetch([{ url: 'https://cdn.example/a.png' }, { url: 'https://cdn.example/b.png' }], captured);

    const provider = new AliyunQwenImageProvider();
    const result = await provider.generate({
      imagePath,
      prompt: 'scene prompt',
      size: '768*1344',
      count: 2,
    });

    expect(captured.payload?.model).toBe(QWEN_IMAGE_MODEL);
    expect(captured.payload?.model).toBe('qwen-image-3.0-pro');
    expect(captured.payload?.parameters.prompt_extend).toBe(true);
    expect(captured.payload?.parameters.n).toBe(2);
    expect(captured.payload?.parameters.size).toBe('768*1344');
    expect(result.map((r) => r.url)).toEqual([
      'https://cdn.example/a.png',
      'https://cdn.example/b.png',
    ]);
  });

  it('prompt 原样进入请求文本内容，图片以 base64 data URL 提供', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-key';
    const captured: CapturedRequest = {};
    stubFetch([{ url: 'https://cdn.example/a.png' }], captured);

    await new AliyunQwenImageProvider().generate({
      imagePath,
      prompt: 'Keep the product unchanged. Scene: studio light',
      size: '1024*1024',
      count: 1,
    });

    const content = captured.payload?.input.messages[0].content ?? [];
    expect(content.some((c) => c.text === 'Keep the product unchanged. Scene: studio light')).toBe(
      true,
    );
    expect(content.some((c) => c.image?.startsWith('data:image/png;base64,'))).toBe(true);
    expect(captured.headers?.Authorization).toBe('Bearer sk-test-key');
  });

  it('返回数量按请求 count 截断', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-key';
    const captured: CapturedRequest = {};
    stubFetch(
      [
        { url: 'https://cdn.example/a.png' },
        { url: 'https://cdn.example/b.png' },
        { url: 'https://cdn.example/c.png' },
      ],
      captured,
    );
    const result = await new AliyunQwenImageProvider().generate({
      imagePath,
      prompt: 'p',
      size: '1024*1024',
      count: 2,
    });
    expect(result).toHaveLength(2);
  });

  it('响应中没有图片时抛出 ProviderRequestError', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test-key';
    const captured: CapturedRequest = {};
    stubFetch([], captured);
    await expect(
      new AliyunQwenImageProvider().generate({
        imagePath,
        prompt: 'p',
        size: '1024*1024',
        count: 1,
      }),
    ).rejects.toThrowError(ProviderRequestError);
  });
});

describe('端点选择', () => {
  it('标准 Key 走默认端点；sk-sp- Token Plan 凭证走专用端点', () => {
    delete process.env.DASHSCOPE_API_URL;
    expect(resolveDashScopeApiUrl('sk-abc')).toBe(DEFAULT_DASHSCOPE_API_URL);
    expect(resolveDashScopeApiUrl('sk-sp-abc')).toBe(TOKEN_PLAN_API_URL);
  });

  it('显式 DASHSCOPE_API_URL 优先', () => {
    process.env.DASHSCOPE_API_URL = 'https://custom.example/gen';
    expect(resolveDashScopeApiUrl('sk-sp-abc')).toBe('https://custom.example/gen');
  });
});
