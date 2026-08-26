import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AliyunQwenVisionProvider,
  DEFAULT_VISION_API_URL,
  QWEN_VISION_MODEL,
  TOKEN_PLAN_VISION_API_URL,
  resolveVisionApiUrl,
  testVisionConnection,
} from './aliyun-qwen-vision';
import { ProviderRequestError } from './provider-errors';

const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const payload = {
  analysis: {
    category: '包', visualSummary: '黑色方形包体',
    visibleFacts: [{ text: '黑色包体', evidenceAssetIds: [ASSET_ID] }],
    visibleText: [], unverifiedFacts: [],
    assetObservations: [{ assetId: ASSET_ID, suggestedRole: 'front', quality: 'good', note: '主体清晰' }],
  },
  plan: {
    heroConcepts: [{
      id: 'hero-1',
      title: '城市动势',
      recommendedSourceAssetId: ASSET_ID,
      creativeBrief: '用城市节奏表现利落商品气质',
      prompt: 'Dynamic urban commercial storytelling for this product.',
      reason: '适合商品轮廓与气质',
    }],
    collage: {
      titleOptions: [{ text: '利落出街', evidenceAssetIds: [ASSET_ID] }],
      sellingPoints: [{ text: '黑色包体', evidenceAssetIds: [ASSET_ID] }],
    },
  },
};

function input() {
  return { workspaceName: '测试商品', assets: [{ assetId: ASSET_ID, role: 'front' as const, mimeType: 'image/jpeg' as const, buffer: Buffer.from('secret-image-bytes') }] };
}

let runtimeRoot = '';
beforeEach(async () => {
  runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vision-provider-'));
  process.env.RUNTIME_DIR = path.join(runtimeRoot, '.runtime');
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_VISION_API_URL;
  delete process.env.RUNTIME_DIR;
  await fs.rm(runtimeRoot, { recursive: true, force: true });
});

describe('qwen 视觉理解 Provider', () => {
  it('使用 qwen3.7-plus、JSON Object、关闭思考且不记录 base64', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let requestBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      requestBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }), { status: 200 });
    }));
    const result = await new AliyunQwenVisionProvider().analyze(input());
    expect(requestBody.model).toBe(QWEN_VISION_MODEL);
    expect(requestBody.response_format).toEqual({ type: 'json_object' });
    expect(requestBody.enable_thinking).toBe(false);
    expect(requestBody).not.toHaveProperty('max_tokens');
    const messages = requestBody.messages as Array<{
      role: string;
      content: string | Array<{ type: string; text?: string }>;
    }>;
    expect(messages[0].content).toContain('collage.titleOptions');
    expect(messages[0].content).toContain('at most 40 characters');
    expect(messages[0].content).toContain('must never appear in\nevidenceAssetIds');
    expect(messages[0].content).toContain('Do not classify concepts into a predefined');
    expect(messages[0].content).toContain('Freely choose the most effective artistic/commercial treatment');
    const userContent = messages[1].content as Array<{ type: string; text?: string }>;
    expect(userContent.at(-1)?.text).toContain(
      'titleOptions[] as { text, evidenceAssetIds[] }',
    );
    expect(result.analysis.category).toBe('包');
    expect(log).not.toHaveBeenCalled();
  });

  it('认证、限流、网络与无效响应映射为可操作中文错误', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(new AliyunQwenVisionProvider().analyze(input())).rejects.toThrow(/Key 无效/);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 429 })));
    await expect(new AliyunQwenVisionProvider().analyze(input())).rejects.toThrow(/限流/);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(new AliyunQwenVisionProvider().analyze(input())).rejects.toThrow(/无法连接 AI 服务/);
  });

  it('支持 content 文本数组并拒绝无效 JSON', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: JSON.stringify(payload) }] } }] }), { status: 200 })));
    await expect(new AliyunQwenVisionProvider().analyze(input())).resolves.toMatchObject({ analysis: { category: '包' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{bad' } }] }), { status: 200 })));
    await expect(new AliyunQwenVisionProvider().analyze(input())).rejects.toThrowError(ProviderRequestError);
  });

  it('显式连接测试只发送最小文本请求，不包含图片', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test';
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }), { status: 200 });
    }));
    await expect(testVisionConnection()).resolves.toBeUndefined();
    expect(body.model).toBe(QWEN_VISION_MODEL);
    expect(JSON.stringify(body)).not.toContain('image_url');
    expect(JSON.stringify(body)).not.toContain('base64');
  });
});

describe('视觉理解端点选择', () => {
  it('标准 Key 与 sk-sp Key 使用不同兼容端点，显式覆盖优先', () => {
    expect(resolveVisionApiUrl('sk-normal')).toBe(DEFAULT_VISION_API_URL);
    expect(resolveVisionApiUrl('sk-sp-plan')).toBe(TOKEN_PLAN_VISION_API_URL);
    process.env.DASHSCOPE_VISION_API_URL = 'https://example.test/vision';
    expect(resolveVisionApiUrl('sk-sp-plan')).toBe('https://example.test/vision');
  });
});
