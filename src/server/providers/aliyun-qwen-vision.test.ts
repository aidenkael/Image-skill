import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AliyunQwenVisionProvider,
  DEFAULT_VISION_API_URL,
  QWEN_VISION_MODEL,
  TOKEN_PLAN_VISION_API_URL,
  resolveVisionApiUrl,
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
    heroDirections: [{ id: 'hero-1', title: '街头', sourceAssetId: ASSET_ID, scene: '城市街头', composition: '居中', lighting: '自然光', person: 'person', prompt: 'Urban street fashion scene.', reason: '适合商品风格' }],
    collage: {
      titleOptions: [{ text: '利落出街', evidenceAssetIds: [ASSET_ID] }],
      sellingPoints: [{ text: '黑色包体', evidenceAssetIds: [ASSET_ID] }],
    },
  },
};

function input() {
  return { workspaceName: '测试商品', assets: [{ assetId: ASSET_ID, role: 'front' as const, mimeType: 'image/jpeg' as const, buffer: Buffer.from('secret-image-bytes') }] };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.DASHSCOPE_API_KEY;
  delete process.env.DASHSCOPE_VISION_API_URL;
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
    const userContent = messages[1].content as Array<{ type: string; text?: string }>;
    expect(userContent.at(-1)?.text).toContain(
      'titleOptions[] as { text, evidenceAssetIds[] }',
    );
    expect(result.analysis.category).toBe('包');
    expect(log).not.toHaveBeenCalled();
  });

  it('支持 content 文本数组并拒绝无效 JSON', async () => {
    process.env.DASHSCOPE_API_KEY = 'sk-test';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: JSON.stringify(payload) }] } }] }), { status: 200 })));
    await expect(new AliyunQwenVisionProvider().analyze(input())).resolves.toMatchObject({ analysis: { category: '包' } });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '{bad' } }] }), { status: 200 })));
    await expect(new AliyunQwenVisionProvider().analyze(input())).rejects.toThrowError(ProviderRequestError);
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
