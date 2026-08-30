import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  buildSchemaInstruction,
  buildStrictResponseFormat,
  downgradeMode,
  extractJsonFromText,
  extractTextContent,
  isStructuredOutputUnsupported,
  normalizeStructuredPayload,
  parseRawJson,
  resolveStructuredMode,
} from './structured-output';

const TestSchema = z.object({ name: z.string(), count: z.number() });

describe('structured-output: response format 构造', () => {
  it('buildStrictResponseFormat 生成 strict json_schema 且包含所有必填字段', () => {
    const result = buildStrictResponseFormat('test_schema', TestSchema);
    expect(result.type).toBe('json_schema');
    const js = result.json_schema as Record<string, unknown>;
    expect(js.name).toBe('test_schema');
    expect(js.strict).toBe(true);
    const schema = js.schema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(expect.arrayContaining(['name', 'count']));
  });

  it('resolveStructuredMode: json-schema 模式返回 response_format', () => {
    const result = resolveStructuredMode('json-schema', 'test', TestSchema);
    expect(result.mode).toBe('json-schema');
    expect(result.responseFormat).toMatchObject({ type: 'json_schema' });
  });

  it('resolveStructuredMode: json-object 模式返回 json_object 且 systemSuffix 包含真实 JSON Schema', () => {
    const result = resolveStructuredMode('json-object', 'test_schema', TestSchema);
    expect(result.mode).toBe('json-object');
    expect(result.responseFormat).toEqual({ type: 'json_object' });
    expect(result.systemSuffix).toContain('exactly one JSON object');
    expect(result.systemSuffix).toContain('Schema name: test_schema');
    expect(result.systemSuffix).toContain('"type":"object"');
  });

  it('resolveStructuredMode: text-json 模式不发送 response_format 且 systemSuffix 包含真实 JSON Schema', () => {
    const result = resolveStructuredMode('text-json', 'test_schema', TestSchema);
    expect(result.mode).toBe('text-json');
    expect(result.responseFormat).toBeNull();
    expect(result.systemSuffix).toContain('ONLY raw JSON');
    expect(result.systemSuffix).toContain('Schema name: test_schema');
    expect(result.systemSuffix).toContain('"type":"object"');
  });

  it('resolveStructuredMode: auto 模式优先 json-schema', () => {
    const result = resolveStructuredMode('auto', 'test', TestSchema);
    expect(result.mode).toBe('json-schema');
    expect(result.responseFormat).toMatchObject({ type: 'json_schema' });
  });
});

describe('structured-output: 降级策略', () => {
  it('json-schema 降级为 json-object', () => {
    expect(downgradeMode('json-schema')).toBe('json-object');
  });
  it('json-object 降级为 text-json', () => {
    expect(downgradeMode('json-object')).toBe('text-json');
  });
  it('text-json 无法再降级', () => {
    expect(downgradeMode('text-json')).toBeNull();
  });
});

describe('structured-output: HTTP 错误分类', () => {
  it('400 + response_format 相关文本 → 视为 structured output 不支持', () => {
    expect(isStructuredOutputUnsupported(400, 'response_format is not supported')).toBe(true);
    expect(isStructuredOutputUnsupported(400, 'json_schema format unsupported')).toBe(true);
    expect(isStructuredOutputUnsupported(422, 'unsupported format type')).toBe(true);
  });

  it('401/403/404/429/500 → 不视为 structured output 不支持', () => {
    expect(isStructuredOutputUnsupported(401, 'response_format not supported')).toBe(false);
    expect(isStructuredOutputUnsupported(403, 'response_format not supported')).toBe(false);
    expect(isStructuredOutputUnsupported(404, 'model not found')).toBe(false);
    expect(isStructuredOutputUnsupported(429, 'rate limit')).toBe(false);
    expect(isStructuredOutputUnsupported(500, 'internal error')).toBe(false);
  });

  it('400 + 非 response_format 文本 → 不视为 structured output 不支持', () => {
    expect(isStructuredOutputUnsupported(400, 'invalid model')).toBe(false);
    expect(isStructuredOutputUnsupported(400, 'prompt is required')).toBe(false);
  });
});

describe('structured-output: payload 归一化', () => {
  it('直接通过 Zod 校验', () => {
    const result = normalizeStructuredPayload({ name: 'test', count: 3 }, TestSchema);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual({ name: 'test', count: 3 });
  });

  it('单元素数组解包', () => {
    const result = normalizeStructuredPayload([{ name: 'test', count: 1 }], TestSchema);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: 'test', count: 1 });
      expect(result.normalization).toBe('single-item-array-unwrapped');
    }
  });

  it('空数组不被兼容', () => {
    const result = normalizeStructuredPayload([], TestSchema);
    expect(result.success).toBe(false);
  });

  it('多元素数组不被兼容', () => {
    const result = normalizeStructuredPayload([{ name: 'a', count: 1 }, { name: 'b', count: 2 }], TestSchema);
    expect(result.success).toBe(false);
  });

  it('字符串数组项不被兼容', () => {
    const result = normalizeStructuredPayload(['invalid'], TestSchema);
    expect(result.success).toBe(false);
  });

  it('单元素无效对象仍失败', () => {
    const result = normalizeStructuredPayload([{ name: '', count: 'not-number' }], TestSchema);
    expect(result.success).toBe(false);
  });

  it('无法满足 Zod 最终明确失败', () => {
    const result = normalizeStructuredPayload({ name: '' }, TestSchema);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeDefined();
  });
});

describe('structured-output: 内容提取', () => {
  it('从 OpenAI chat completion 结构提取文本', () => {
    const content = [{ type: 'text', text: 'hello' }, { type: 'text', text: ' world' }];
    expect(extractTextContent(content)).toBe('hello world');
  });

  it('字符串直接返回', () => {
    expect(extractTextContent('direct text')).toBe('direct text');
  });

  it('非文本项被忽略', () => {
    const content = [{ type: 'image_url', image_url: { url: 'data:...' } }, { type: 'text', text: 'ok' }];
    expect(extractTextContent(content)).toBe('ok');
  });
});

describe('structured-output: text-json 解析', () => {
  it('直接 JSON 解析', () => {
    expect(parseRawJson('{"name":"test","count":1}')).toEqual({ name: 'test', count: 1 });
  });

  it('从 markdown code fence 提取', () => {
    const raw = '```json\n{"name":"test","count":2}\n```';
    expect(parseRawJson(raw)).toEqual({ name: 'test', count: 2 });
  });

  it('从前后文本中提取唯一 JSON 对象', () => {
    const raw = 'Here is the result: {"name":"test","count":3} done.';
    expect(parseRawJson(raw)).toEqual({ name: 'test', count: 3 });
  });

  it('无法提取时抛出错误', () => {
    expect(() => parseRawJson('no json here')).toThrow();
  });
});

describe('structured-output: extractJsonFromText', () => {
  it('提取 markdown 中的 JSON', () => {
    expect(extractJsonFromText('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it('直接解析裸 JSON', () => {
    expect(extractJsonFromText('{"b":2}')).toEqual({ b: 2 });
  });
});

describe('structured-output: buildSchemaInstruction', () => {
  it('输出包含 schema name 和 JSON Schema 字符串', () => {
    const instruction = buildSchemaInstruction('hero_plan_v2', TestSchema);
    expect(instruction).toContain('Schema name: hero_plan_v2');
    expect(instruction).toContain('The required JSON object MUST match this JSON Schema exactly.');
    expect(instruction).toContain('Do not add, remove, rename, merge, split, or change the type of fields.');
    // Must contain the actual schema as JSON string
    expect(instruction).toContain('"type":"object"');
    expect(instruction).toContain('"name"');
    expect(instruction).toContain('"count"');
  });

  it('使用 jsonSchemaOverride 而非 Zod 推导', () => {
    const override = { type: 'object', properties: { custom: { type: 'string' } } };
    const instruction = buildSchemaInstruction('custom_schema', TestSchema, override);
    expect(instruction).toContain('"custom"');
    expect(instruction).not.toContain('"count"');
  });
});
