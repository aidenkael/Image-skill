import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { OpenAICompatibleVisionProvider, buildProductIntelligenceJsonSchema } from './openai-compatible-vision';
import type { HeroBatchReview, HeroBrief } from '@/core/hero-workflow';
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

const briefPayload: HeroBrief = {
  title: '晨光桌面',
  productIdentity: {
    summary: '白色陶瓷马克杯',
    fixedTraits: ['白色杯身', '单件', '陶瓷质感'],
    movableParts: [],
  },
  presentation: {
    mode: 'scene-staging',
    reason: '桌面场景传达日常使用感',
    interaction: null,
    scene: '清晨木桌',
    camera: '居中微俯 50mm',
    lighting: '柔和自然窗光',
    depthOfField: '轻浅景深',
    scaleCue: null,
  },
  forbiddenChanges: ['杯柄数量变化', '杯身图案改变', '材质变成金属'],
};
const humanBriefPayload: HeroBrief = {
  ...briefPayload,
  presentation: { ...briefPayload.presentation, mode: 'human-interaction', interaction: '模特自然手持' },
};

const directorInput = (humanPolicy: 'auto' | 'avoid' | 'require' = 'auto') => ({
  workspaceId,
  taskId: 'task-1',
  workspaceName: '商品',
  asset: { assetId, role: 'front' as const, mimeType: 'image/jpeg' as const, buffer: Buffer.from('selected-image') },
  humanPolicy,
  creativeIntent: '雨夜归家',
});

const batchReviewPayload: HeroBatchReview = {
  assessments: [
    { candidateIndex: 0, hardFailures: [], softIssues: ['excessive_bokeh'], repairInstruction: null },
    { candidateIndex: 1, hardFailures: ['topology_broken'], softIssues: [], repairInstruction: '保持链条为一条连续链' },
  ],
  preferredOrder: [0, 1],
};

const batchReviewInput = () => ({
  workspaceId,
  taskId: 'task-1',
  source: { assetId, role: 'front' as const, mimeType: 'image/jpeg' as const, buffer: Buffer.from('source') },
  generated: [
    { assetId, role: 'front' as const, mimeType: 'image/jpeg' as const, buffer: Buffer.from('generated-1') },
    { assetId, role: 'front' as const, mimeType: 'image/jpeg' as const, buffer: Buffer.from('generated-2') },
  ],
  brief: briefPayload,
  humanPolicy: 'auto' as const,
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

/** 读取当天最新一个请求级日志文件（文件名按时间排序） */
async function lastLog(): Promise<Record<string, unknown>> {
  const dir = path.join(root, '.runtime', 'logs', 'ai', new Date().toISOString().slice(0, 10));
  const files = (await fs.readdir(dir)).sort();
  return JSON.parse(await fs.readFile(path.join(dir, files.at(-1)!), 'utf8'));
}

async function logFiles(): Promise<string[]> {
  const dir = path.join(root, '.runtime', 'logs', 'ai', new Date().toISOString().slice(0, 10));
  return (await fs.readdir(dir).catch(() => [])).sort();
}

/** 读取捕获请求中 strict JSON Schema 的 presentation 属性定义 */
function capturedPresentationSchema(captured: Record<string, unknown>) {
  const format = captured.response_format as { json_schema: { schema: Record<string, unknown> } };
  return ((format.json_schema.schema.properties as Record<string, Record<string, unknown>>).presentation.properties as Record<string, Record<string, unknown>>);
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

  it('future-vision-model-2099 正常工作（model 是 opaque string，无模型名分支）', async () => {
    const futureConfig = { ...jsonSchemaConfig, model: 'future-vision-model-2099' };
    const getBody = responseBody();
    await expect(new OpenAICompatibleVisionProvider(futureConfig).analyze(analysisInput())).resolves.toEqual(payload);
    expect(getBody().model).toBe('future-vision-model-2099');
    expect((getBody().response_format as { type: string }).type).toBe('json_schema');
  });

  it('json-object 模式 system prompt 包含真实 JSON Schema', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
    }));
    await new OpenAICompatibleVisionProvider(jsonObjectConfig).analyze(analysisInput());
    const systemMsg = (captured.messages as Array<{ role: string; content: string }>).find((m) => m.role === 'system')!.content;
    expect(systemMsg).toContain('Schema name: product_intelligence');
    expect(systemMsg).toContain('"type":"object"');
    expect(systemMsg).toContain('exactly one JSON object');
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

  it('auto 模式：200 schema-invalid 最多 1 次 retry', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return Response.json({ choices: [{ message: { content: JSON.stringify({ ...payload, analysis: { ...payload.analysis, category: '' } }) } }] });
      }
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

  it('单元素 Product Intelligence 数组仅在完整通过 Zod 后解包并记录归一化', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify([payload]) } }] })));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).resolves.toEqual(payload);
    await expect(lastLog()).resolves.toMatchObject({ status: 'succeeded', extra: expect.objectContaining({ normalization: 'single-item-array-unwrapped' }) });
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
    if (stage === 'schema-validate') expect((event.extra as Record<string, unknown>).zodIssues).toEqual(expect.any(Array));
  });

  it('HTTP 失败保留既有中文错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('provider failure', { status: 401 })));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).rejects.toThrow(/Key 无效/);
  });

  /* ── Hero Director ── */

  it('directHero 使用结构化 HeroBrief schema，模型名保持 opaque', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(briefPayload) } }] });
    }));
    await expect(new OpenAICompatibleVisionProvider(jsonSchemaConfig).directHero(directorInput())).resolves.toEqual(briefPayload);
    expect(captured.model).toBe('future-vision-model-2099');
    const format = captured.response_format as { type: string; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } };
    expect(format).toMatchObject({ type: 'json_schema', json_schema: { strict: true, name: 'hero_brief' } });
    // HeroBrief 不含 prompt 字段（Director 不写最终生成 prompt）
    expect(JSON.stringify(format.json_schema.schema)).not.toContain('"prompt"');
    // 只输入一张源图
    const content = (captured.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>).find((message) => message.role === 'user')!.content;
    expect(content.filter((item) => item.type === 'image_url')).toHaveLength(1);
    await expect(lastLog()).resolves.toMatchObject({ operation: 'hero-director', status: 'succeeded', parsedResult: briefPayload });
  });

  it('Director 不消费 Product Intelligence，只依赖源图', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(briefPayload) } }] });
    }));
    const input = directorInput();
    expect(input).not.toHaveProperty('intelligence');
    expect(input).not.toHaveProperty('productUnderstanding');
    await new OpenAICompatibleVisionProvider(autoConfig).directHero(input);
    const body = JSON.stringify(captured);
    expect(body).toContain('ecommerce photography director');
    expect(body).not.toContain('Product understanding from prior analysis');
    expect(body).toContain('雨夜归家');
  });

  it('require 政策注入硬人物约束并返回 human-interaction 策划', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(humanBriefPayload) } }] });
    }));
    const result = await new OpenAICompatibleVisionProvider(autoConfig).directHero(directorInput('require'));
    expect(JSON.stringify(captured)).toContain('presentation.mode MUST be human-interaction');
    expect(result.presentation.mode).toBe('human-interaction');
  });

  it('avoid 政策注入硬无人约束并返回 scene-staging 策划', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(briefPayload) } }] });
    }));
    const result = await new OpenAICompatibleVisionProvider(autoConfig).directHero(directorInput('avoid'));
    expect(JSON.stringify(captured)).toContain('presentation.mode MUST be scene-staging');
    expect(result.presentation.mode).toBe('scene-staging');
  });

  it('HeroBrief 的 nullable 字段在 strict schema 中以 type 数组表达', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(briefPayload) } }] });
    }));
    await new OpenAICompatibleVisionProvider(jsonSchemaConfig).directHero(directorInput());
    const format = captured.response_format as { json_schema: { schema: Record<string, unknown> } };
    const presentation = ((format.json_schema.schema.properties as Record<string, Record<string, unknown>>).presentation.properties as Record<string, Record<string, unknown>>);
    expect(presentation.interaction.type).toEqual(['string', 'null']);
    expect(presentation.scaleCue.type).toEqual(['string', 'null']);
  });

  it('require 政策收窄 strict JSON Schema：mode 只允许 human-interaction 且 interaction 不可为 null', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(humanBriefPayload) } }] });
    }));
    await new OpenAICompatibleVisionProvider(jsonSchemaConfig).directHero(directorInput('require'));
    const presentation = capturedPresentationSchema(captured);
    expect(presentation.mode.enum).toEqual(['human-interaction']);
    expect(presentation.interaction.type).toBe('string');
  });

  it('avoid 政策收窄 strict JSON Schema：mode 只允许 scene-staging 且 interaction 只能是 null', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(briefPayload) } }] });
    }));
    await new OpenAICompatibleVisionProvider(jsonSchemaConfig).directHero(directorInput('avoid'));
    const presentation = capturedPresentationSchema(captured);
    expect(presentation.mode.enum).toEqual(['scene-staging']);
    expect(presentation.interaction.type).toBe('null');
  });

  it('require：错误 scene-staging 策划即使经 schema retry 也最终 reject，fetch 恰好 2 次', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount += 1;
      return Response.json({ choices: [{ message: { content: JSON.stringify(briefPayload) } }] });
    }));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).directHero(directorInput('require')))
      .rejects.toThrow(/AI 返回结果无法解析/);
    expect(callCount).toBe(2);
  });

  it('avoid：错误 human-interaction 策划最终 reject，不返回错误 HeroBrief', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount += 1;
      return Response.json({ choices: [{ message: { content: JSON.stringify(humanBriefPayload) } }] });
    }));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).directHero(directorInput('avoid')))
      .rejects.toThrow(/AI 返回结果无法解析/);
    expect(callCount).toBe(2);
  });

  it('require：正确 human-interaction 策划成功返回', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify(humanBriefPayload) } }] })));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).directHero(directorInput('require'))).resolves.toEqual(humanBriefPayload);
  });

  /* ── Hero 批量 QA ── */

  it('批量 QA 指令把人物政策明确映射为 human_policy_violated（auto 不产生该 failure）', async () => {
    const run = async (humanPolicy: 'require' | 'avoid' | 'auto') => {
      let captured: Record<string, unknown> = {};
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
        captured = JSON.parse(String(init.body));
        return Response.json({ choices: [{ message: { content: JSON.stringify(batchReviewPayload) } }] });
      }));
      await new OpenAICompatibleVisionProvider(jsonObjectConfig).reviewHeroBatch({ ...batchReviewInput(), humanPolicy });
      const userText = ((captured.messages as Array<{ role: string; content: Array<{ text?: string }> }>)
        .find((message) => message.role === 'user')!.content)
        .map((item) => item.text ?? '').join('\n');
      if (humanPolicy === 'auto') {
        expect(userText).not.toContain('human_policy_violated');
      } else {
        expect(userText).toContain('human_policy_violated');
        expect(userText).toContain(`Human policy=${humanPolicy} is a hard delivery requirement`);
      }
    };
    await run('require');
    await run('avoid');
    await run('auto');
  });

  it('reviewHeroBatch 一次请求包含源图与全部候选图并解析批量评估', async () => {
    let captured: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: JSON.stringify(batchReviewPayload) } }] });
    }));
    await expect(new OpenAICompatibleVisionProvider(jsonObjectConfig).reviewHeroBatch(batchReviewInput())).resolves.toEqual(batchReviewPayload);
    const content = (captured.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>).find((message) => message.role === 'user')!.content;
    const images = content.filter((item) => item.type === 'image_url');
    expect(images).toHaveLength(3);
    expect(content.filter((item) => item.type === 'text').map((item) => item.text).join(' ')).toContain('Candidate 1');
    const body = JSON.stringify(captured);
    expect(body).toContain('白色杯身');
    expect(body).toContain('topology_broken');
    await expect(lastLog()).resolves.toMatchObject({ operation: 'hero-batch-review', status: 'succeeded', parsedResult: batchReviewPayload });
  });

  /* ── 请求级日志 ── */

  it('一次逻辑操作的协议降级写两个独立请求日志文件并共享 traceId', async () => {
    const before = await logFiles();
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return Response.json({ error: { message: 'json_schema not supported' } }, { status: 400 });
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
    }));
    await new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput());
    const after = await logFiles();
    const created = after.filter((file) => !before.includes(file));
    expect(created).toHaveLength(2);
    const [first, second] = await Promise.all(created.map(async (file) => {
      const dir = path.join(root, '.runtime', 'logs', 'ai', new Date().toISOString().slice(0, 10));
      return JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'));
    }));
    expect(first.status).toBe('failed');
    expect(second.status).toBe('succeeded');
    expect(first.requestId).not.toBe(second.requestId);
    expect(first.traceId).toBe(second.traceId);
  });

  it('日志文件不含 API Key / Authorization / data 图片，但保留文本 prompt', async () => {
    const before = await logFiles();
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: JSON.stringify(briefPayload) } }] })));
    await new OpenAICompatibleVisionProvider(autoConfig).directHero(directorInput());
    const after = await logFiles();
    const created = after.filter((file) => !before.includes(file));
    expect(created).toHaveLength(1);
    const dir = path.join(root, '.runtime', 'logs', 'ai', new Date().toISOString().slice(0, 10));
    const raw = await fs.readFile(path.join(dir, created[0]), 'utf8');
    expect(raw).not.toContain('sk-sp-exact-key');
    expect(raw).not.toContain('Bearer ');
    expect(raw).not.toMatch(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]{20}/);
    expect(raw).toContain('[IMAGE_REDACTED]');
    expect(raw).toContain('ecommerce photography director');
    expect(raw).toContain('https://stored.example/vision');
    expect(raw).not.toContain('?key=ignored');
    expect(created[0]).toMatch(/hero-director_[0-9a-f]{8}\.json$/);
  });

  /* ── Protocol fallback / schema retry 独立状态机 ── */

  it('状态机 Case 2: protocol fallback 后仍保留 schema retry', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount += 1;
      if (callCount === 1) {
        return Response.json({ error: { message: 'json_schema not supported' } }, { status: 400 });
      }
      if (callCount === 2) {
        return Response.json({ choices: [{ message: { content: JSON.stringify({ ...payload, analysis: { ...payload.analysis, category: '' } }) } }] });
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
    }));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).resolves.toEqual(payload);
    expect(callCount).toBe(3);
  });

  it('状态机 Case 3: 两次 protocol fallback 后仍保留 schema retry', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      callCount += 1;
      const body = JSON.parse(String(init.body));
      if (callCount === 1) {
        expect((body.response_format as { type: string }).type).toBe('json_schema');
        return Response.json({ error: { message: 'json_schema not supported' } }, { status: 400 });
      }
      if (callCount === 2) {
        expect((body.response_format as { type: string }).type).toBe('json_object');
        return Response.json({ error: { message: 'json_object not supported' } }, { status: 400 });
      }
      if (callCount === 3) {
        expect(body.response_format).toBeUndefined();
        return Response.json({ choices: [{ message: { content: JSON.stringify({ ...payload, analysis: { ...payload.analysis, category: '' } }) } }] });
      }
      return Response.json({ choices: [{ message: { content: JSON.stringify(payload) } }] });
    }));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).resolves.toEqual(payload);
    expect(callCount).toBe(4);
  });

  it('状态机 Case 4: schema retry 最多一次，第二次仍失败则报错', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount += 1;
      return Response.json({ choices: [{ message: { content: JSON.stringify({ ...payload, analysis: { ...payload.analysis, category: '' } }) } }] });
    }));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).rejects.toThrow(/AI 返回结果无法解析/);
    expect(callCount).toBe(2);
  });

  it('状态机 Case 5: auth/rate-limit/server/network 不触发任何 fallback 或 retry', async () => {
    for (const [status, response] of [
      [401, () => new Response('unauthorized', { status: 401 })],
      [403, () => new Response('forbidden', { status: 403 })],
      [404, () => new Response('model not found', { status: 404 })],
      [429, () => new Response('rate limit', { status: 429 })],
      [500, () => new Response('internal error', { status: 500 })],
    ] as const) {
      let callCount = 0;
      vi.stubGlobal('fetch', vi.fn(async () => { callCount += 1; return response(); }));
      await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).rejects.toThrow();
      expect(callCount).toBe(1);
    }
    // network error
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => { callCount += 1; throw new TypeError('fetch failed'); }));
    await expect(new OpenAICompatibleVisionProvider(autoConfig).analyze(analysisInput())).rejects.toThrow();
    expect(callCount).toBe(1);
  });
});
