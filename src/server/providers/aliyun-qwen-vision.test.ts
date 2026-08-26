import { afterEach, describe, expect, it, vi } from 'vitest';
import { AliyunQwenVisionProvider } from './aliyun-qwen-vision';
import type { ResolvedVisionConfig } from '@/server/settings/ai';

const config: ResolvedVisionConfig = {
  profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', apiKey: 'sk-sp-exact-key', enabled: true,
  driver: 'openai-compatible-vision', endpoint: 'https://stored.example/vision', model: 'stored-vision-model',
};
const assetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const payload = {
  analysis: { category: '包', visualSummary: '白色包', visibleFacts: [], visibleText: [], unverifiedFacts: [], assetObservations: [{ assetId, suggestedRole: 'front', quality: 'good', note: '清晰' }] },
  plan: { heroConcepts: [{ id: 'hero-1', title: '通勤场景', recommendedSourceAssetId: assetId, creativeBrief: '自然通勤画面', prompt: 'Natural commute scene.', reason: '突出商品' }], collage: { titleOptions: [], sellingPoints: [] } },
};

afterEach(() => vi.unstubAllGlobals());

describe('OpenAI 兼容识图 Provider', () => {
  it('使用精确存储配置且保留结构化请求语义', async () => {
    let captured: { url?: string; authorization?: string; body?: Record<string, unknown> } = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, authorization: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) };
      return Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
    }));
    const result = await new AliyunQwenVisionProvider(config).analyze({ workspaceName: '商品', assets: [{ assetId, role: 'front', mimeType: 'image/jpeg', buffer: Buffer.from('image') }] });
    expect(result.analysis.category).toBe('包');
    expect(captured.url).toBe(config.endpoint);
    expect(captured.authorization).toBe(`Bearer ${config.apiKey}`);
    expect(captured.body).toMatchObject({ model: config.model, response_format: { type: 'json_object' }, enable_thinking: false, stream: false });
  });

  it('上游认证错误使用安全中文错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    await expect(new AliyunQwenVisionProvider(config).analyze({ workspaceName: '商品', assets: [] })).rejects.toThrow(/Key 无效/);
  });

  it('Hero planning 使用所选图片、精确配置与用户创意，并校验返回 prompt', async () => {
    let captured: { url?: string; authorization?: string; body?: Record<string, unknown> } = {};
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, authorization: (init.headers as Record<string, string>).Authorization, body: JSON.parse(String(init.body)) };
      return Response.json({ choices: [{ message: { content: JSON.stringify({ prompt: 'A natural product hero scene.' }) } }] });
    }));
    const result = await new AliyunQwenVisionProvider(config).planHero({
      workspaceName: '商品', creativeIntent: '雨夜归家',
      asset: { assetId, role: 'front', mimeType: 'image/jpeg', buffer: Buffer.from('selected-image') },
    });
    expect(result.prompt).toBe('A natural product hero scene.');
    expect(captured.url).toBe(config.endpoint);
    expect(captured.authorization).toBe(`Bearer ${config.apiKey}`);
    expect(captured.body).toMatchObject({ model: config.model, response_format: { type: 'json_object' }, enable_thinking: false, stream: false });
    const content = ((captured.body!.messages as Array<{ content: Array<{ type: string; image_url?: { url: string }; text?: string }> }>)[0]).content;
    expect(content[0].image_url?.url).toBe(`data:image/jpeg;base64,${Buffer.from('selected-image').toString('base64')}`);
    expect(content[1].text).toContain('雨夜归家');
  });

  it('无效 Hero planning 响应安全失败', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '{"prompt":""}' } }] })));
    await expect(new AliyunQwenVisionProvider(config).planHero({
      workspaceName: '商品', asset: { assetId, role: 'front', mimeType: 'image/jpeg', buffer: Buffer.from('image') },
    })).rejects.toThrow('AI 返回结果无法解析');
  });
});
