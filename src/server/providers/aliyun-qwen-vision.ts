import crypto from 'node:crypto';
import { z } from 'zod';
import { HeroPlanV2Schema, HeroReviewSchema } from '@/core/hero-workflow';
import { HeroRuntimePlanSchema, ProductIntelligencePayloadSchema } from '@/core/intelligence';
import { writeAILog } from '@/server/logging/ai-log';
import type { ResolvedVisionConfig } from '@/server/settings/ai';
import type {
  HeroPlanV2Input,
  HeroPlanningInput,
  HeroReviewInput,
  ProductIntelligenceInput,
  ProductIntelligenceProvider,
} from './vision-provider';
import { invalidProviderResponse, providerFetchError, providerHttpError } from './provider-errors';

export const SYSTEM_PROMPT = `You are an ecommerce product photographer and visual merchandising planner.
Return exactly one object matching the supplied JSON Schema, with no markdown.
Output every required field. Use [] when a required list has no supported facts.
All user-facing analysis/copy text must be Simplified Chinese. Hero prompt text must be English.
Treat all factual product claims as evidence-bound. Only describe facts directly visible in supplied product images.
Never invent material, exact dimensions, weight, capacity, model, compatibility, electrical properties,
waterproof, food-safe, hypoallergenic, certification, performance or durability claims. Put uncertain items in unverifiedFacts.
assetObservations must contain exactly one observation for every supplied asset.
Every returned assetId and evidenceAssetIds value must use an exact supplied asset ID.
Reference assets may guide visual direction only. They must never appear in factual evidenceAssetIds.
recommendedSourceAssetId must use a supplied non-reference asset ID.
visibleFacts, visibleText and collage text must be evidence-bound.
Hero concepts must preserve product identity, shape, proportion, color, pattern, logo/text, visible material appearance,
structure, count, accessories, ports/hardware and visible function. Use ids hero-1, hero-2, hero-3 in order.`;

type JsonSchema = Record<string, unknown>;

function supportedSchema(schema: unknown): JsonSchema {
  const input = schema as JsonSchema;
  const output: JsonSchema = {};
  if (typeof input.type === 'string') output.type = input.type;
  if (typeof input.description === 'string') output.description = input.description;
  if (Array.isArray(input.enum)) output.enum = input.enum;
  if (Array.isArray(input.required)) output.required = input.required;
  if (typeof input.additionalProperties === 'boolean') output.additionalProperties = input.additionalProperties;
  if (input.items && typeof input.items === 'object') output.items = supportedSchema(input.items);
  if (input.properties && typeof input.properties === 'object') {
    output.properties = Object.fromEntries(
      Object.entries(input.properties as JsonSchema).map(([key, value]) => [key, supportedSchema(value)]),
    );
  }
  return output;
}

function property(schema: JsonSchema, ...keys: string[]): JsonSchema {
  let current = schema;
  for (const key of keys) {
    if (key === 'items') {
      const items = current.items;
      if (!items || typeof items !== 'object') throw new Error(`Product Intelligence JSON Schema 缺少 ${keys.join('.')}`);
      current = items as JsonSchema;
      continue;
    }
    const properties = current.properties as JsonSchema | undefined;
    const next = properties?.[key];
    if (!next || typeof next !== 'object') throw new Error(`Product Intelligence JSON Schema 缺少 ${keys.join('.')}`);
    current = next as JsonSchema;
  }
  return current;
}

function restrictAssetIds(schema: JsonSchema, assetIds: string[]): void {
  const items = schema.items as JsonSchema | undefined;
  if (!items) throw new Error('Product Intelligence JSON Schema 缺少 asset ID 列表');
  items.enum = assetIds;
}

function restrictAssetValue(schema: JsonSchema, assetIds: string[]): void {
  schema.enum = assetIds;
}

export function supportsStrictJsonSchema(model: string): boolean {
  return /^qwen3\.7-plus(?:-|$)/i.test(model.trim());
}

/** 从 Zod 契约生成严格 JSON Schema response_format；根层字段全部必填，适配可选字段。 */
export function strictResponseFormat(name: string, schema: z.ZodType): Record<string, unknown> {
  const json = supportedSchema(z.toJSONSchema(schema));
  json.additionalProperties = false;
  const properties = json.properties as JsonSchema | undefined;
  if (properties) json.required = Object.keys(properties);
  return { type: 'json_schema', json_schema: { name, strict: true, schema: json } };
}

const HUMAN_POLICY_INSTRUCTION: Record<HeroPlanV2Input['humanPolicy'], string> = {
  auto: 'auto: decide yourself whether human presence helps the product story; include it only when it truly adds understanding.',
  avoid: 'avoid: the final image must not include any person, hand, body part or human figure.',
  require: 'require: the final image must include meaningful, natural human interaction with the product.',
};

const CREATIVE_LEVEL_INSTRUCTION: Record<HeroPlanV2Input['creativeLevel'], string> = {
  conservative: 'conservative: prioritize structural fidelity; keep scene association light and close to a believable product photo.',
  balanced: 'balanced: default commercial balance between fidelity and atmosphere.',
  creative: 'creative: bolder staging, mood and expression are welcome, but product identity must never change.',
};

function planHeroV2Instruction(input: HeroPlanV2Input): string {
  const parts: string[] = [
    `You are the lead ecommerce photographer and visual merchandising planner. Plan one atmosphere hero image for the product in the supplied photo.`,
    `Workspace product: ${input.workspaceName}`,
    `Before answering, reason about: (1) what is most worth expressing about this product; (2) what state a buyer most needs to see it in at first glance; (3) whether human presence is truly needed to convey scale, usage or wearing effect; (4) what environment enhances the product without stealing focus; (5) which physical/structural details are most prone to hallucination.`,
    `Do not force multiple directions. Return exactly one JSON object matching the supplied schema: one main plan, plus altPrompt as a second interpretation.`,
    `title, coreSellingAngle, scene, composition and riskChecks are user-facing Simplified Chinese; preserve/flexible items may be Chinese; prompt and altPrompt must be English generation prompts.`,
    `preserve must lock the product identity: subject category, core structure/connection, count, dominant colors, dominant material appearance, logo/text/pattern, key hardware or accessories.`,
    `flexible lists the soft aspects the generation may freely interpret (angle, staging state, scene, composition, camera, light, time of day, mood, whether a person appears).`,
    `riskChecks lists the structural hallucinations most likely to happen with this product and therefore forbidden.`,
    `displayMode: scene-staging (staged still life, tabletop or spatial display, hanging, non-human-led presentation) or human-interaction (holding, wearing, carrying, partial body participation).`,
    `Human presence preference from the user: ${HUMAN_POLICY_INSTRUCTION[input.humanPolicy]}`,
    `Creative level from the user: ${CREATIVE_LEVEL_INSTRUCTION[input.creativeLevel]}`,
  ];
  if (input.productUnderstanding) {
    parts.push(`Product understanding from prior analysis (visible facts only): ${input.productUnderstanding}`);
  }
  if (input.creativeIntent) {
    parts.push(`User creative intent (preserve it while adapting it to the visible product): ${input.creativeIntent}`);
  }
  parts.push('Prioritize commercial usefulness, believable photography and low AI-looking output. Never change product identity.');
  return parts.join('\n');
}

function reviewHeroInstruction(input: HeroReviewInput): string {
  return [
    `You are an ecommerce photo reviewer. Image 1 is the original product photo; Image 2 is a generated atmosphere hero based on it.`,
    `Planned display mode: ${input.displayMode}. Human presence policy: ${input.humanPolicy}.`,
    `Must be preserved: ${input.preserve.join('; ')}.`,
    `Allowed to vary: ${input.flexible.join('; ')}.`,
    `Check only four aspects: (1) product identity, structure, count and connection errors against Image 1 - these are critical; (2) naturalness of the human-product relationship, only when displayMode is human-interaction; (3) believability of scene, scale and lighting; (4) obvious AI look and whether it is suitable as an ecommerce atmosphere hero.`,
    `Return exactly one JSON object matching the supplied schema. summary and issues must be Simplified Chinese.`,
    `score is an integer 0..100. passed=true only when score>=70 and there is no severe identity or structure error.`,
  ].join('\n');
}

/** Starts from the core Zod contract, then narrows image references to this provider request. */
export function buildProductIntelligenceJsonSchema(input: ProductIntelligenceInput): JsonSchema {
  const schema = supportedSchema(z.toJSONSchema(ProductIntelligencePayloadSchema));
  const assetIds = [...new Set(input.assets.map((asset) => asset.assetId))];
  const nonReferenceAssetIds = [...new Set(input.assets
    .filter((asset) => asset.role !== 'reference')
    .map((asset) => asset.assetId))];

  restrictAssetIds(property(schema, 'analysis', 'visibleFacts', 'items', 'evidenceAssetIds'), assetIds);
  restrictAssetIds(property(schema, 'analysis', 'visibleText', 'items', 'evidenceAssetIds'), assetIds);
  restrictAssetValue(property(schema, 'analysis', 'assetObservations', 'items', 'assetId'), assetIds);
  restrictAssetIds(property(schema, 'plan', 'collage', 'titleOptions', 'items', 'evidenceAssetIds'), assetIds);
  restrictAssetIds(property(schema, 'plan', 'collage', 'sellingPoints', 'items', 'evidenceAssetIds'), assetIds);
  restrictAssetValue(property(schema, 'plan', 'heroConcepts', 'items', 'recommendedSourceAssetId'), nonReferenceAssetIds);
  return schema;
}

function userPrompt(input: ProductIntelligenceInput): string {
  const assets = input.assets.map((asset) => `- assetId=${asset.assetId}; role=${asset.role}`).join('\n');
  return `Analyze this single ecommerce product from the supplied images.
Workspace product name: ${input.workspaceName}
Supplied assets (use these exact IDs; do not infer IDs):
${assets}
Prefer mobile-commerce clarity, truthful visual merchandising, natural commercial photography and low AI-looking scenes.`;
}

function responseText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const text = (item as { text?: unknown }).text;
    return typeof text === 'string' ? [text] : [];
  }).join('');
}

function responseUsage(body: unknown): unknown {
  return body && typeof body === 'object' ? (body as { usage?: unknown }).usage : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function zodIssues(error: unknown): Array<{ path: string; code: string; message: string }> | undefined {
  if (!(error instanceof z.ZodError)) return undefined;
  return error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }));
}

type LogDetail = Omit<Parameters<typeof writeAILog>[0],
  'requestId' | 'operation' | 'workspaceId' | 'profileId' | 'driver' | 'provider' | 'model' | 'endpoint' | 'durationMs' | 'apiKey' | 'timestamp' | 'assetCount' | 'assetIds'>;

function normalizeStructuredPayload<T extends z.ZodType>(parsed: unknown, schema: T):
  | { success: true; data: z.output<T>; normalization?: 'single-item-array-unwrapped' }
  | { success: false; error: z.ZodError } {
  const direct = schema.safeParse(parsed);
  if (direct.success) return direct;
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) {
    return { success: false, error: direct.error };
  }
  const unwrapped = schema.safeParse(parsed[0]);
  if (!unwrapped.success) return { success: false, error: unwrapped.error };
  return { success: true, data: unwrapped.data, normalization: 'single-item-array-unwrapped' };
}

export class AliyunQwenVisionProvider implements ProductIntelligenceProvider {
  constructor(private readonly config: ResolvedVisionConfig) {}

  async analyze(input: ProductIntelligenceInput) {
    return this.requestStructured({
      input,
      operation: 'vision.product-analysis',
      system: SYSTEM_PROMPT,
      user: userPrompt(input),
      content: input.assets.flatMap((asset) => [
        { type: 'text', text: `assetId=${asset.assetId}; role=${asset.role}` },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${asset.buffer.toString('base64')}` } },
      ]),
      schema: ProductIntelligencePayloadSchema,
      responseFormat: supportsStrictJsonSchema(this.config.model)
        ? { type: 'json_schema', json_schema: { name: 'product_intelligence', strict: true, schema: buildProductIntelligenceJsonSchema(input) } }
        : { type: 'json_object' },
    });
  }

  async planHero(input: HeroPlanningInput) {
    const creativeIntent = input.creativeIntent
      ? `\nUser creative intent (preserve it while adapting it to the visible product): ${input.creativeIntent}`
      : '';
    const planningInstruction = `Inspect the visible product in the supplied image before planning.\n` +
      `Return exactly one object matching the supplied JSON Schema. The prompt must be English and propose one strongest product-specific ecommerce Hero direction.\n` +
      `Preserve product identity, shape, proportions, color, visible material appearance, pattern, logo/text, structure, count, accessories and visible hardware.\n` +
      `Do not invent unseen back/interior/accessories/functions or unsupported factual claims. Do not force a predefined scene, style or person taxonomy.\n` +
      `Freely choose scene, camera, environment, lighting, spatial treatment and mood. Prioritize commercial usefulness, believable photography and low AI-looking output.${creativeIntent}`;
    return this.requestStructured({
      input,
      operation: 'vision.hero-planning',
      user: planningInstruction,
      content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.asset.buffer.toString('base64')}` } }],
      schema: HeroRuntimePlanSchema,
      responseFormat: supportsStrictJsonSchema(this.config.model)
        ? { type: 'json_schema', json_schema: { name: 'hero_runtime_plan', strict: true, schema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'], additionalProperties: false } } }
        : { type: 'json_object' },
    });
  }

  async planHeroV2(input: HeroPlanV2Input) {
    return this.requestStructured({
      input,
      operation: 'vision.hero-plan-v2',
      user: planHeroV2Instruction(input),
      content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.asset.buffer.toString('base64')}` } }],
      schema: HeroPlanV2Schema,
      responseFormat: supportsStrictJsonSchema(this.config.model)
        ? strictResponseFormat('hero_plan_v2', HeroPlanV2Schema)
        : { type: 'json_object' },
    });
  }

  async reviewHero(input: HeroReviewInput) {
    return this.requestStructured({
      input,
      operation: 'vision.hero-review',
      user: reviewHeroInstruction(input),
      content: [
        { type: 'text', text: 'Image 1: original product photo.' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.source.buffer.toString('base64')}` } },
        { type: 'text', text: 'Image 2: generated atmosphere hero.' },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.generated.buffer.toString('base64')}` } },
      ],
      schema: HeroReviewSchema,
      responseFormat: supportsStrictJsonSchema(this.config.model)
        ? strictResponseFormat('hero_review', HeroReviewSchema)
        : { type: 'json_object' },
    });
  }

  private async requestStructured<T extends z.ZodType>(options: {
    input: ProductIntelligenceInput | HeroPlanningInput | HeroPlanV2Input | HeroReviewInput;
    operation: 'vision.product-analysis' | 'vision.hero-planning' | 'vision.hero-plan-v2' | 'vision.hero-review';
    system?: string;
    user: string;
    content: Array<Record<string, unknown>>;
    schema: T;
    responseFormat: Record<string, unknown>;
  }): Promise<z.output<T>> {
    const { input } = options;
    const requestId = crypto.randomUUID();
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const assets = 'assets' in input
      ? input.assets
      : 'source' in input
        ? [input.source, input.generated]
        : [input.asset];
    const log = (event: LogDetail) => writeAILog({
      ...event, requestId, operation: options.operation, workspaceId: input.workspaceId,
      profileId: this.config.profileId, driver: this.config.driver, provider: 'aliyun-qwen',
      model: this.config.model, endpoint: this.config.endpoint, apiKey: this.config.apiKey,
      timestamp: startedAt, durationMs: Date.now() - started, assetCount: assets.length,
      assetIds: assets.map((asset) => asset.assetId),
    });
    const content = [...options.content, { type: 'text', text: options.user }];
    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            ...(options.system ? [{ role: 'system', content: options.system }] : []),
            { role: 'user', content },
          ],
          response_format: options.responseFormat,
          enable_thinking: false,
          stream: false,
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      await log({ status: 'failed', failureStage: 'fetch', errorName: error instanceof Error ? error.name : undefined, errorMessage: errorMessage(error) });
      throw providerFetchError(error);
    }
    const responseRaw = await response.text();
    if (!response.ok) {
      await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet: responseRaw });
      console.error(`[ai] ${options.operation} failed requestId=${requestId.slice(0, 8)}`);
      throw providerHttpError(response.status);
    }
    let body: unknown;
    try { body = JSON.parse(responseRaw); }
    catch {
      await log({ status: 'failed', failureStage: 'response-json', httpStatus: response.status, responseSnippet: responseRaw });
      throw invalidProviderResponse(requestId);
    }
    const choices = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
    const raw = responseText(choices?.[0]?.message?.content).trim();
    if (!raw) {
      await log({ status: 'failed', failureStage: 'content-extract', httpStatus: response.status, usage: responseUsage(body) });
      throw invalidProviderResponse(requestId);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch {
      await log({ status: 'failed', failureStage: 'content-json-parse', httpStatus: response.status, usage: responseUsage(body), responseSnippet: raw });
      throw invalidProviderResponse(requestId);
    }
    const normalized = normalizeStructuredPayload(parsed, options.schema);
    if (normalized.success) {
      await log({ status: 'succeeded', httpStatus: response.status, usage: responseUsage(body), normalization: normalized.normalization });
      return normalized.data;
    }
    await log({ status: 'failed', failureStage: 'schema-validate', httpStatus: response.status, usage: responseUsage(body), responseSnippet: raw, zodIssues: zodIssues(normalized.error) });
    throw invalidProviderResponse(requestId);
  }
}
