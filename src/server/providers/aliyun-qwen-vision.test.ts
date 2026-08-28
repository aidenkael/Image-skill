import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AliyunQwenVisionProvider, buildProductIntelligenceJsonSchema, supportsStrictJsonSchema } from './aliyun-qwen-vision';
import type { ResolvedVisionConfig } from '@/server/settings/ai';

let root = '';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const assetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const referenceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const strictConfig: ResolvedVisionConfig = { profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', apiKey: 'sk-sp-exact-key', enabled: true, driver: 'openai-compatible-vision', endpoint: 'https://stored.example/vision?key=ignored', model: 'qwen3.7-plus' };
const customConfig = { ...strictConfig, model: 'stored-vision-model' };
const payload = {
  analysis: { category: '包', visualSummary: '白色包', visibleFacts: [], visibleText: [], unverifiedFacts: [], assetObservations: [{ assetId, suggestedRole: 'front', quality: 'good', note: '清晰' }] },
  plan: { heroConcepts: [{ id: 'hero-1', title: '通勤场景', recommendedSourceAssetId: assetId, creativeBrief: '自然通勤画面', prompt: 'Natural commute scene.', reason: '突出商品' }], collage: { titleOptions: [], sellingPoints: [] } },
};
const analysisInput = () => ({ workspaceId, workspaceName: '商品', assets: [{ assetId, role: 'front' as const, mimeType: 'image/jpeg' as const, buffer: Buffer.from('image') }] });
const heroInput = () => ({ workspaceId, workspaceName: '商品', asset: { assetId, role: 'front' as const, mimeType: 'image/jpeg' as const, buffer: Buffer.from('selected-image') } });

beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'vision-provider-')); process.env.RUNTIME_DIR = path.join(root, '.runtime'); });
afterEach(() => vi.unstubAllGlobals());
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); delete process.env.RUNTIME_DIR; });

function responseBody() {
  let captured: Record<string, unknown> = {};
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    captured = JSON.parse(String(init.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
  }));
  return () => captured;
}

describe('OpenAI 兼容识图 Provider', () => {
  it('Qwen3.7-Plus 使用严格 JSON Schema，其他模型保留兼容模式', async () => {
    expect(supportsStrictJsonSchema('qwen3.7-plus')).toBe(true);
    expect(supportsStrictJsonSchema('QWEN3.7-PLUS-2026')).toBe(true);
    expect(supportsStrictJsonSchema('qwen-vl-plus')).toBe(false);
    const getStrict = responseBody();
    await expect(new AliyunQwenVisionProvider(strictConfig).analyze(analysisInput())).resolves.toEqual(payload);
    const strict = (getStrict().response_format as { type: string; json_schema: { strict: boolean; schema: Record<string, unknown> } });
    expect(strict.type).toBe('json_schema');
    expect(strict.json_schema.strict).toBe(true);
    const schema = strict.json_schema.schema;
    expect(schema).toMatchObject({ required: ['analysis', 'plan'], additionalProperties: false });
    const analysis = (schema.properties as Record<string, Record<string, unknown>>).analysis;
    expect(analysis).toMatchObject({ required: ['category', 'visualSummary', 'visibleFacts', 'visibleText', 'unverifiedFacts', 'assetObservations'], additionalProperties: false });
    const plan = (schema.properties as Record<string, Record<string, unknown>>).plan;
    expect(plan).toMatchObject({ required: ['heroConcepts', 'collage'], additionalProperties: false });
    const evidenceItems = ((((analysis.properties as Record<string, Record<string, unknown>>).visibleFacts.items as Record<string, Record<string, unknown>>).properties.evidenceAssetIds as Record<string, Record<string, unknown>>).items);
    expect(evidenceItems.enum).toEqual([assetId]);
    const heroProperties = ((plan.properties as Record<string, Record<string, unknown>>).heroConcepts.items as Record<string, Record<string, unknown>>).properties as Record<string, Record<string, unknown>>;
    expect((heroProperties.recommendedSourceAssetId as Record<string, unknown>).enum).toEqual([assetId]);

    const getCustom = responseBody();
    await new AliyunQwenVisionProvider(customConfig).analyze(analysisInput());
    expect(getCustom().response_format).toEqual({ type: 'json_object' });
  });

  it('参考图可进入分析但不能作为严格 Hero 源', () => {
    const schema = buildProductIntelligenceJsonSchema({ workspaceId, workspaceName: '商品', assets: [
      { assetId, role: 'front', mimeType: 'image/jpeg', buffer: Buffer.from('image') },
      { assetId: referenceId, role: 'reference', mimeType: 'image/jpeg', buffer: Buffer.from('reference') },
    ] });
    const rootProperties = schema.properties as Record<string, Record<string, unknown>>;
    const heroProps = (((rootProperties.plan.properties as Record<string, Record<string, unknown>>).heroConcepts.items as Record<string, Record<string, unknown>>).properties);
    expect((heroProps.recommendedSourceAssetId as Record<string, unknown>).enum).toEqual([assetId]);
    const observations = ((rootProperties.analysis.properties as Record<string, Record<string, unknown>>).assetObservations.items as Record<string, Record<string, unknown>>).properties.assetId;
    expect((observations as Record<string, unknown>).enum).toEqual([assetId, referenceId]);
  });

  it('Hero planning 使用严格 Schema 与精确配置', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ prompt: 'A natural product hero scene.' }) } }] });
    }));
    await expect(new AliyunQwenVisionProvider(strictConfig).planHero({ ...heroInput(), creativeIntent: '雨夜归家' })).resolves.toEqual({ prompt: 'A natural product hero scene.' });
    expect(captured).toMatchObject({ model: strictConfig.model, enable_thinking: false, stream: false });
    expect(captured.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true, schema: { required: ['prompt'], additionalProperties: false } } });
  });

  it.each([
    ['response-json', () => new Response('not json')],
    ['content-extract', () => Response.json({ choices: [{ message: {} }] })],
    ['content-json-parse', () => Response.json({ choices: [{ message: { content: '{not json' } }] })],
    ['schema-validate', () => Response.json({ choices: [{ message: { content: JSON.stringify({ ...payload, analysis: { ...payload.analysis, category: '' } }) } }] })],
  ])('记录 %s 且 UI 仅获得诊断编号', async (stage, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    await expect(new AliyunQwenVisionProvider(strictConfig).analyze(analysisInput())).rejects.toThrow(/AI 返回结果无法解析（诊断编号：[0-9a-f]{8}）/);
    const file = path.join(root, '.runtime', 'logs', `ai-${new Date().toISOString().slice(0, 10)}.jsonl`);
    const event = JSON.parse((await fs.readFile(file, 'utf8')).trim().split('\n').at(-1)!);
    expect(event.failureStage).toBe(stage);
    if (stage === 'schema-validate') expect(event.zodIssues).toEqual(expect.any(Array));
  });

  it('HTTP 失败记录安全诊断且保留既有中文错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider failure', { status: 401 })));
    await expect(new AliyunQwenVisionProvider(strictConfig).analyze(analysisInput())).rejects.toThrow(/Key 无效/);
  });
});
