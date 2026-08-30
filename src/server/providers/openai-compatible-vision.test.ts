import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleVisionProvider, buildProductIntelligenceJsonSchema } from './openai-compatible-vision';
import type { ResolvedVisionConfig } from '@/server/settings/ai';

let root = '';
const workspaceId = '11111111-1111-4111-8111-111111111111';
const assetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const referenceId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const baseCompat = { imageInput: true, structuredOutput: 'auto' as const };
const jsonSchemaConfig: ResolvedVisionConfig = { profileId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', apiKey: 'sk-sp-exact-key', enabled: true, driver: 'openai-compatible-vision', endpoint: 'https://stored.example/vision?key=ignored', model: 'future-vision-model-2099', compatibility: { ...baseCompat, structuredOutput: 'json-schema' } };
const autoConfig: ResolvedVisionConfig = { ...jsonSchemaConfig, model: 'any-model-name', compatibility: baseCompat };
const jsonObjectConfig: ResolvedVisionConfig = { ...jsonSchemaConfig, model: 'any-model-name', compatibility: { ...baseCompat, structuredOutput: 'json-object' } };
const payload = {
  analysis: { category: '包', visualSummary: '白色包', visibleFacts: [], visibleText: [], unverifiedFacts: [], assetObservations: [{ assetId, suggestedRole: 'front', quality: 'good', note: '清晰' }] },
  plan: { collage: { titleOptions: [], sellingPoints: [] } },
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

describe('OpenAI 兼容识图 Provider（模型无关）', () => {
  it('json-schema 模式发送 strict response_format，与 model 名无关', async () => {
    const getStrict = responseBody();
    await expect(new OpenAICompatibleVisionProvider(jsonSchemaConfig).analyze(analysisInput())).resolves.toEqual(payload);
    const strict = (getStrict().response_format as { type: string; json_schema: { strict: boolean; schema: Record<string, unknown> } });
    expect(strict.type).toBe('json_schema');
    expect(strict.json_schema.strict).toBe(true);
    const schema = strict.json_schema.schema;
    expect(schema).toMatchObject({ required: ['analysis', 'plan'], additionalProperties: false });
  });

  it('auto 模式优先 json-schema', async () => {
    const getBody = responseBody();
    await new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput());
    const format = getBody().response_format as { type: string };
    expect(format.type).toBe('json_schema');
  });

  it('json-object 模式发送 json_object response_format', async () => {
    const getBody = responseBody();
    await new OpenAICompatibleVisionProvider(jsonObjectConfig).analyze(analysisInput());
    expect(getBody().response_format).toEqual({ type: 'json_object' });
  });

  it('future-vision-model-2099 + json-schema 正常工作（model 是 opaque string）', async () => {
    const futureConfig = { ...jsonSchemaConfig, model: 'future-vision-model-2099' };
    const getBody = responseBody();
    await expect(new OpenAICompatibleVisionProvider(futureConfig).analyze(analysisInput())).resolves.toEqual(payload);
    expect(getBody().model).toBe('future-vision-model-2099');
    expect((getBody().response_format as { type: string }).type).toBe('json_schema');
  });

  it('同一 model 在 json-object 时走 json-object', async () => {
    const getBody = responseBody();
    await new OpenAICompatibleVisionProvider(jsonObjectConfig).analyze(analysisInput());
    expect(getBody().response_format).toEqual({ type: 'json_object' });
  });

  it('auto 模式：json-schema 不支持时降级为 json-object', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      callCount += 1;
      const body = JSON.parse(String(init.body));
      if (callCount === 1) {
        expect((body.response_format as { type: string }).type).toBe('json_schema');
        return Response.json({ error: { message: 'response_format json_schema is not supported' } }, { status: 400 });
      }
      expect((body.response_format as { type: string }).type).toBe('json_object');
      return Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
    }));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).resolves.toEqual(payload);
    expect(callCount).toBe(2);
  });

  it('auto 模式：401/403/429/500 不触发 capability fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('unauthorized', { status: 401 })));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).rejects.toThrow(/Key 无效/);
  });

  it('参考图可进入分析但不能作为事实证据', () => {
    const schema = buildProductIntelligenceJsonSchema({ workspaceId, workspaceName: '商品', assets: [
      { assetId, role: 'front', mimeType: 'image/jpeg', buffer: Buffer.from('image') },
      { assetId: referenceId, role: 'reference', mimeType: 'image/jpeg', buffer: Buffer.from('reference') },
    ] });
    const rootProperties = schema.properties as Record<string, Record<string, unknown>>;
    const observations = ((rootProperties.analysis.properties as Record<string, Record<string, unknown>>).assetObservations.items as Record<string, Record<string, unknown>>).properties.assetId;
    expect((observations as Record<string, unknown>).enum).toEqual([assetId, referenceId]);
    const evidenceItems = ((((rootProperties.analysis.properties as Record<string, Record<string, unknown>>).visibleFacts.items as Record<string, Record<string, unknown>>).properties.evidenceAssetIds as Record<string, Record<string, unknown>>).items);
    expect(evidenceItems.enum).toEqual([assetId, referenceId]);
  });

  it('Hero planning 消费同一 structured adapter', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify({ prompt: 'A natural product hero scene.' }) } }] });
    }));
    await expect(new OpenAICompatibleVisionProvider(jsonSchemaConfig).planHero({ ...heroInput(), creativeIntent: '雨夜归家' })).resolves.toEqual({ prompt: 'A natural product hero scene.' });
    expect(captured).toMatchObject({ model: jsonSchemaConfig.model, enable_thinking: false, stream: false });
    expect(captured.response_format).toMatchObject({ type: 'json_schema', json_schema: { strict: true } });
  });

  it('单元素 Product Intelligence 数组仅在完整通过 Zod 后解包并记录归一化', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify([payload]) } }] })));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).resolves.toEqual(payload);
    await expect(lastLog()).resolves.toMatchObject({ status: 'succeeded', normalization: 'single-item-array-unwrapped' });
  });

  it.each([
    ['空数组', []],
    ['多元素数组', [payload, payload]],
    ['字符串数组项', ['invalid']],
  ])('%s 不会被兼容', async (_name, invalid) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify(invalid) } }] })));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).rejects.toThrow(/AI 返回结果无法解析/);
    await expect(lastLog()).resolves.toMatchObject({ failureStage: 'schema-validate' });
  });

  it.each([
    ['response-json', () => new Response('not json')],
    ['content-extract', () => Response.json({ choices: [{ message: {} }] })],
    ['content-json-parse', () => Response.json({ choices: [{ message: { content: '{not json' } }] })],
    ['schema-validate', () => Response.json({ choices: [{ message: { content: JSON.stringify({ ...payload, analysis: { ...payload.analysis, category: '' } }) } }] })],
  ])('记录 %s 且 UI 仅获得诊断编号', async (stage, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => response()));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).rejects.toThrow(/AI 返回结果无法解析（诊断编号：[0-9a-f]{8}）/);
    const event = await lastLog();
    expect(event.failureStage).toBe(stage);
    if (stage === 'schema-validate') expect(event.zodIssues).toEqual(expect.any(Array));
  });

  it('HTTP 失败记录安全诊断且保留既有中文错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider failure', { status: 401 })));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).rejects.toThrow(/Key 无效/);
  });

  it('planHeroV2 注入人物偏好、创意程度与商品理解，并解析 HeroPlanV2', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(planV2Payload) } }] });
    }));
    await expect(new OpenAICompatibleVisionProvider(jsonObjectConfig).planHeroV2(planV2Input())).resolves.toEqual(planV2Payload);
    const body = JSON.stringify(captured);
    expect(body).toContain('must not include any person');
    expect(body).toContain('bolder staging');
    expect(body).toContain('雨夜归家');
    expect(body).toContain('Product understanding from prior analysis');
    expect(captured.response_format).toEqual({ type: 'json_object' });
    await expect(lastLog()).resolves.toMatchObject({ operation: 'vision.hero-plan-v2', status: 'succeeded', structuredMode: 'json-object' });
  });

  it('planHeroV2 strict 模式下所有根字段必填（含可选的 altPrompt）', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(planV2Payload) } }] });
    }));
    await new OpenAICompatibleVisionProvider(jsonSchemaConfig).planHeroV2(planV2Input());
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
    await expect(new OpenAICompatibleVisionProvider(jsonObjectConfig).reviewHero(reviewInput())).resolves.toEqual(reviewPayload);
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
