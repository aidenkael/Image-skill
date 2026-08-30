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

const planV2Payload = {
  title: '晨光桌面',
  displayMode: 'scene-staging',
  humanPolicy: 'auto',
  coreSellingAngle: '日常陪伴感',
  preserve: ['白色杯身', '单件', '陶瓷质感'],
  flexible: ['光线氛围'],
  scene: '清晨木桌',
  composition: '居中微俯',
  lighting: '柔和自然光',
  riskChecks: ['杯柄结构', '数量变化'],
  prompt: 'A warm morning tabletop hero.',
};
const reviewPayload = { passed: true, score: 82, issues: [], summary: '结构一致' };
const planV2Input = () => ({
  ...heroInput(),
  humanPolicy: 'avoid' as const,
  creativeLevel: 'creative' as const,
  creativeIntent: '雨夜归家',
  productUnderstanding: '白色杯身',
});
const reviewInput = () => ({
  workspaceId,
  source: { assetId, role: 'front' as const, mimeType: 'image/jpeg' as const, buffer: Buffer.from('source') },
  generated: { assetId, role: 'front' as const, mimeType: 'image/jpeg' as const, buffer: Buffer.from('generated') },
  displayMode: 'human-interaction' as const,
  humanPolicy: 'require' as const,
  preserve: ['白色杯身'],
  flexible: ['光线氛围'],
});

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

async function lastLog(): Promise<Record<string, unknown>> {
  const file = path.join(root, '.runtime', 'logs', `ai-${new Date().toISOString().slice(0, 10)}.jsonl`);
  return JSON.parse((await fs.readFile(file, 'utf8')).trim().split('\n').at(-1)!);
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
    expect((await lastLog()).normalization).toBeUndefined();
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

  it('单元素 Product Intelligence 数组仅在完整通过 Zod 后解包并记录归一化', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify([payload]) } }] })));
    await expect(new AliyunQwenVisionProvider(strictConfig).analyze(analysisInput())).resolves.toEqual(payload);
    await expect(lastLog()).resolves.toMatchObject({ status: 'succeeded', normalization: 'single-item-array-unwrapped' });
  });

  it('Hero planning 同样兼容单元素对象数组', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify([{ prompt: 'A natural product hero scene.' }]) } }] })));
    await expect(new AliyunQwenVisionProvider(strictConfig).planHero(heroInput())).resolves.toEqual({ prompt: 'A natural product hero scene.' });
    await expect(lastLog()).resolves.toMatchObject({ operation: 'vision.hero-planning', normalization: 'single-item-array-unwrapped' });
  });

  it.each([
    ['空数组', []],
    ['多元素数组', [payload, payload]],
    ['字符串数组项', ['invalid']],
  ])('%s 不会被兼容', async (_name, invalid) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify(invalid) } }] })));
    await expect(new AliyunQwenVisionProvider(strictConfig).analyze(analysisInput())).rejects.toThrow(/AI 返回结果无法解析/);
    await expect(lastLog()).resolves.toMatchObject({ failureStage: 'schema-validate' });
  });

  it('单元素无效对象仍失败，且记录内层 Zod issues', async () => {
    const invalid = { ...payload, analysis: { ...payload.analysis, category: '' } };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify([invalid]) } }] })));
    await expect(new AliyunQwenVisionProvider(strictConfig).analyze(analysisInput())).rejects.toThrow(/AI 返回结果无法解析/);
    await expect(lastLog()).resolves.toMatchObject({ failureStage: 'schema-validate', zodIssues: [expect.objectContaining({ path: 'analysis.category' })] });
  });

  it.each([
    ['response-json', () => new Response('not json')],
    ['content-extract', () => Response.json({ choices: [{ message: {} }] })],
    ['content-json-parse', () => Response.json({ choices: [{ message: { content: '{not json' } }] })],
    ['schema-validate', () => Response.json({ choices: [{ message: { content: JSON.stringify({ ...payload, analysis: { ...payload.analysis, category: '' } }) } }] })],
  ])('记录 %s 且 UI 仅获得诊断编号', async (stage, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    await expect(new AliyunQwenVisionProvider(strictConfig).analyze(analysisInput())).rejects.toThrow(/AI 返回结果无法解析（诊断编号：[0-9a-f]{8}）/);
    const event = await lastLog();
    expect(event.failureStage).toBe(stage);
    if (stage === 'schema-validate') expect(event.zodIssues).toEqual(expect.any(Array));
  });

  it('HTTP 失败记录安全诊断且保留既有中文错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider failure', { status: 401 })));
    await expect(new AliyunQwenVisionProvider(strictConfig).analyze(analysisInput())).rejects.toThrow(/Key 无效/);
  });

  it('planHeroV2 注入人物偏好、创意程度与商品理解，并解析 HeroPlanV2', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(planV2Payload) } }] });
    }));
    await expect(new AliyunQwenVisionProvider(customConfig).planHeroV2(planV2Input())).resolves.toEqual(planV2Payload);
    const body = JSON.stringify(captured);
    expect(body).toContain('must not include any person');
    expect(body).toContain('bolder staging');
    expect(body).toContain('雨夜归家');
    expect(body).toContain('Product understanding from prior analysis');
    expect(captured.response_format).toEqual({ type: 'json_object' });
    await expect(lastLog()).resolves.toMatchObject({ operation: 'vision.hero-plan-v2', status: 'succeeded' });
  });

  it('planHeroV2 严格模式下所有根字段必填（含可选的 altPrompt）', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(planV2Payload) } }] });
    }));
    await new AliyunQwenVisionProvider(strictConfig).planHeroV2(planV2Input());
    const format = captured.response_format as { type: string; json_schema: { strict: boolean; schema: Record<string, unknown> } };
    expect(format.type).toBe('json_schema');
    expect(format.json_schema.strict).toBe(true);
    expect(format.json_schema.schema).toMatchObject({ additionalProperties: false });
    expect(format.json_schema.schema.required).toEqual(expect.arrayContaining(['title', 'displayMode', 'preserve', 'prompt', 'altPrompt']));
  });

  it('reviewHero 提交原图与生成图并解析 HeroReview', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(reviewPayload) } }] });
    }));
    await expect(new AliyunQwenVisionProvider(customConfig).reviewHero(reviewInput())).resolves.toEqual(reviewPayload);
    const content = (captured.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>).find((message) => message.role === 'user')!.content;
    const images = content.filter((item) => item.type === 'image_url');
    expect(images).toHaveLength(2);
    const body = JSON.stringify(captured);
    expect(body).toContain('human-interaction');
    expect(body).toContain('白色杯身');
    expect(body).toContain('score>=70');
    await expect(lastLog()).resolves.toMatchObject({ operation: 'vision.hero-review', status: 'succeeded' });
  });
});
