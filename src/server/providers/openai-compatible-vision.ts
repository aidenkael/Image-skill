import crypto from 'node:crypto';
import { z } from 'zod';
import { HeroBatchReviewSchema, heroBriefSchemaForHumanPolicy } from '@/core/hero-workflow';
import { ProductIntelligencePayloadSchema } from '@/core/intelligence';
import { writeAIRequestLog, type AIRequestLog } from '@/server/logging/ai-log';
import type { ResolvedVisionConfig } from '@/server/settings/ai';
import type {
  HeroBatchReviewInput,
  HeroDirectorInput,
  ProductIntelligenceInput,
  VisionProvider,
} from './vision-provider';
import { invalidProviderResponse, providerFetchError, providerHttpError } from './provider-errors';
import {
  downgradeMode,
  extractTextContent,
  extractResponseUsage,
  isStructuredOutputUnsupported,
  normalizeStructuredPayload,
  parseRawJson,
  resolveStructuredMode,
  sanitizeJsonSchema,
  zodIssues,
} from './structured-output';

export const SYSTEM_PROMPT = `You are an ecommerce product photographer and visual merchandising planner.
Return exactly one object matching the supplied JSON Schema, with no markdown.
Output every required field. Use [] when a required list has no supported facts.
All user-facing analysis/copy text must be Simplified Chinese.
Treat all factual product claims as evidence-bound. Only describe facts directly visible in supplied product images.
Never invent material, exact dimensions, weight, capacity, model, compatibility, electrical properties,
waterproof, food-safe, hypoallergenic, certification, performance or durability claims. Put uncertain items in unverifiedFacts.
assetObservations must contain exactly one observation for every supplied asset.
Every returned assetId and evidenceAssetIds value must use an exact supplied asset ID.
Reference assets may guide visual direction only. They must never appear in factual evidenceAssetIds.
visibleFacts, visibleText and collage text must be evidence-bound.`;

type JsonSchema = Record<string, unknown>;

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

/** Director 指令：紧凑、强决策导向，不做品类分类学（模型从可见商品自行推理）。 */
function directHeroInstruction(input: HeroDirectorInput): string {
  const parts: string[] = [
    'You are the ecommerce photography director.',
    'Inspect the visible product before choosing presentation.',
    'Choose the one strongest commercial presentation for THIS product. Do not produce multiple directions.',
    'The central planning question: what visible presentation state lets a buyer understand the product, trust it, find it attractive, understand scale/use when relevant, and want to own it as quickly as possible? Do NOT frame the question as "is a person necessary?".',
    'Identify fixed product identity separately from movable physical parts.',
    'For movable straps/chains/handles/fabric components, preserve topology, attachment, quantity and approximate length/proportion, but allow natural gravity/use/pose changes. Do not freeze an articulated part into the exact 2D pose of the source image.',
    'For a rigid product with no meaningful movable part, return movableParts as an empty array.',
    'Lock product identity: overall shape/proportion, major structure/topology, quantity, major color/material appearance, visible pattern/logo/text, zippers/openings/hardware, attachment points, visible accessories.',
    'Prefer believable commercial photography over decorative AI aesthetics.',
    'Favor natural light integration, believable physical contact, credible scale, realistic gravity, natural depth of field, background detail consistent with lens/focus; the product must remain visually dominant.',
    'Avoid excessive bokeh, abrupt foreground/background blur transitions, unmotivated cinematic blur, over-smooth materials, over-perfect cutout edges, implausible prop scale, and random decorative objects that compete with the product.',
    'Do not invent product functions, accessories, materials, text, logos or claims.',
    `Workspace product: ${input.workspaceName}`,
  ];
  if (input.humanPolicy === 'require') {
    parts.push('Human policy is a hard input constraint: require. presentation.mode MUST be human-interaction and interaction MUST describe meaningful holding/wearing/carrying/using/partial-body interaction.');
  } else if (input.humanPolicy === 'avoid') {
    parts.push('Human policy is a hard input constraint: avoid. presentation.mode MUST be scene-staging, interaction MUST be null, and no person/hand/body part may appear.');
  } else {
    parts.push('Human policy: auto. Choose human interaction when it materially improves wearing state, carrying state, hand-held use, human-product physical relationship or scale understanding; otherwise choose the strongest scene-staging presentation (placement, size reference, home/decor context, use location). Decide by buyer-information value, never because still-life is easier to generate.');
  }
  if (input.creativeIntent) {
    parts.push(`User creative intent (soft direction; it must never override product identity or physical constraints): ${input.creativeIntent}`);
  }
  parts.push('All descriptive fields (title, reason, interaction, scene, camera, lighting, depthOfField, scaleCue, summary, fixedTraits, forbiddenChanges and movable part fields) must be Simplified Chinese.');
  return parts.join('\n');
}

/** 批量 QA 指令：明确区分「允许的姿态/状态变化」与「身份/拓扑改变」。 */
function reviewHeroBatchInstruction(input: HeroBatchReviewInput): string {
  const { brief } = input;
  const candidateCount = input.generated.length;
  const lastIndex = candidateCount - 1;
  const parts: string[] = [
    `You are the ecommerce visual QA reviewer. Image 1 is the original source product photo. Images 2 to ${candidateCount + 1} are generated hero candidates, indexed 0 to ${lastIndex} in order.`,
    `Planned presentation: ${brief.presentation.mode}. Human policy: ${input.humanPolicy}.`,
    `Product identity that must remain unchanged: ${brief.productIdentity.fixedTraits.join('; ')}.`,
    `Forbidden product changes: ${brief.forbiddenChanges.join('; ')}.`,
  ];
  for (const part of brief.productIdentity.movableParts) {
    parts.push(
      `Movable part "${part.name}": fixed relationships ${part.fixedRelations.join('; ')}; ` +
      `allowed natural motion ${part.allowedMotion.join('; ')}; never ${part.forbiddenChanges.join('; ')}.`,
    );
  }
  parts.push(
    'Distinguish allowed pose/state change from identity/topology change.',
    'A chain/strap that bends or drapes differently is NOT a failure if it remains one continuous chain/strap with correct attachment points and plausible length.',
    'A chain split into multiple decorative pieces is topology_broken. A strap connected to a different place is attachment_wrong.',
    'A hand naturally touching/carrying the item is valid; a hand intersecting the product or impossible load/contact is impossible_human_contact.',
    'Excessive bokeh or unnatural depth of field is a soft issue unless it produces a severe generation artifact.',
    'Compare every candidate against the source image and the brief. Do not reward merely beautiful output if product structure is wrong.',
    'Also check: scene consistent with the plan, credible scale, lighting integration, product visually dominant, details (zippers, hardware, texture, edges, pattern) consistent with the source.',
    `Return exactly one assessment per candidate covering candidateIndex 0 to ${lastIndex}, each index exactly once. preferredOrder ranks candidates with usable ones first.`,
    'repairInstruction: for each rejected candidate, one concrete Simplified-Chinese-compatible repair sentence usable for regeneration; null when the candidate is usable.',
  );
  if (input.humanPolicy === 'avoid') {
    parts.push(
      'Human policy=avoid is a hard delivery requirement. If any person, hand, body part, silhouette or human figure appears, add "human_policy_violated" to hardFailures.',
    );
  } else if (input.humanPolicy === 'require') {
    parts.push(
      'Human policy=require is a hard delivery requirement. If the candidate does not contain meaningful, physically plausible human interaction with the product, add "human_policy_violated" to hardFailures. A decorative/background person who does not meaningfully interact with the product does not satisfy this requirement.',
    );
  }
  return parts.join('\n');
}

/** Starts from the core Zod contract, then narrows image references to this provider request. */
export function buildProductIntelligenceJsonSchema(input: ProductIntelligenceInput): JsonSchema {
  const schema = sanitizeJsonSchema(z.toJSONSchema(ProductIntelligencePayloadSchema));
  const assetIds = [...new Set(input.assets.map((asset) => asset.assetId))];

  restrictAssetIds(property(schema, 'analysis', 'visibleFacts', 'items', 'evidenceAssetIds'), assetIds);
  restrictAssetIds(property(schema, 'analysis', 'visibleText', 'items', 'evidenceAssetIds'), assetIds);
  restrictAssetValue(property(schema, 'analysis', 'assetObservations', 'items', 'assetId'), assetIds);
  restrictAssetIds(property(schema, 'plan', 'collage', 'titleOptions', 'items', 'evidenceAssetIds'), assetIds);
  restrictAssetIds(property(schema, 'plan', 'collage', 'sellingPoints', 'items', 'evidenceAssetIds'), assetIds);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

type StructuredOperation = 'product-intelligence' | 'hero-director' | 'hero-batch-review';

type AttemptLogInput = Pick<AIRequestLog, 'status' | 'httpStatus' | 'durationMs'> &
  Partial<Pick<AIRequestLog, 'failureStage' | 'errorName' | 'errorMessage' | 'requestBody' | 'responseBody' | 'parsedResult'>> &
  { extra?: Record<string, unknown> };

export class OpenAICompatibleVisionProvider implements VisionProvider {
  constructor(private readonly config: ResolvedVisionConfig) {}

  async analyze(input: ProductIntelligenceInput) {
    const jsonSchema = buildProductIntelligenceJsonSchema(input);
    return this.requestStructured({
      input,
      operation: 'product-intelligence',
      system: SYSTEM_PROMPT,
      user: userPrompt(input),
      content: input.assets.flatMap((asset) => [
        { type: 'text', text: `assetId=${asset.assetId}; role=${asset.role}` },
        { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${asset.buffer.toString('base64')}` } },
      ]),
      schema: ProductIntelligencePayloadSchema,
      schemaName: 'product_intelligence',
      jsonSchemaOverride: jsonSchema,
    });
  }

  async directHero(input: HeroDirectorInput) {
    // 人物政策是业务不变量：由本次输入直接决定 Zod Schema，
    // structured output、协议 fallback 与 schema retry 自动遵守同一约束。
    const schema = heroBriefSchemaForHumanPolicy(input.humanPolicy);
    return this.requestStructured({
      input,
      operation: 'hero-director',
      user: directHeroInstruction(input),
      content: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.asset.buffer.toString('base64')}` } }],
      schema,
      schemaName: 'hero_brief',
    });
  }

  async reviewHeroBatch(input: HeroBatchReviewInput) {
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: 'Image 1: source product photo.' },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.source.buffer.toString('base64')}` } },
    ];
    input.generated.forEach((image, index) => {
      content.push({ type: 'text', text: `Candidate ${index}:` });
      content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image.buffer.toString('base64')}` } });
    });
    return this.requestStructured({
      input,
      operation: 'hero-batch-review',
      user: reviewHeroBatchInstruction(input),
      content,
      schema: HeroBatchReviewSchema,
      schemaName: 'hero_batch_review',
    });
  }

  /**
   * 通用结构化输出请求。
   * 每次实际 HTTP 请求一个 requestId 与一个独立日志文件；
   * 同一逻辑操作的协议降级/重试共享一个 traceId。
   */
  private async requestStructured<T extends z.ZodType>(options: {
    input: ProductIntelligenceInput | HeroDirectorInput | HeroBatchReviewInput;
    operation: StructuredOperation;
    system?: string;
    user: string;
    content: Array<Record<string, unknown>>;
    schema: T;
    schemaName: string;
    jsonSchemaOverride?: JsonSchema;
  }): Promise<z.output<T>> {
    const { input, schema, schemaName, jsonSchemaOverride } = options;
    const traceId = crypto.randomUUID();
    const taskId = 'taskId' in input ? input.taskId : undefined;
    const logBase = {
      operation: options.operation,
      workspaceId: input.workspaceId,
      taskId,
      profileId: this.config.profileId,
      driver: this.config.driver,
      model: this.config.model,
      endpoint: this.config.endpoint,
      redact: [this.config.apiKey],
    };

    const structuredMode = this.config.compatibility.structuredOutput;
    let modeResult = resolveStructuredMode(structuredMode, schemaName, options.schema, jsonSchemaOverride);

    // Protocol fallback and schema retry are independent state machines.
    // Protocol fallback: json-schema → json-object → text-json (auto mode only, on HTTP 400/422 unsupported).
    // Schema retry: at most 1 across the entire request, independent of protocol fallback count.
    const maxProtocolFallback = structuredMode === 'auto' ? 2 : 0;
    let protocolFallbackCount = 0;
    let schemaRetryUsed = false;

    while (true) {
      const requestId = crypto.randomUUID();
      const started = Date.now();
      const logAttempt = (event: AttemptLogInput) => writeAIRequestLog({
        timestamp: new Date().toISOString(),
        requestId,
        traceId,
        ...logBase,
        status: event.status,
        httpStatus: event.httpStatus,
        durationMs: event.durationMs,
        ...(event.failureStage ? { failureStage: event.failureStage } : {}),
        ...(event.errorName ? { errorName: event.errorName } : {}),
        ...(event.errorMessage !== undefined ? { errorMessage: event.errorMessage } : {}),
        ...(event.requestBody !== undefined ? { requestBody: event.requestBody } : {}),
        ...(event.responseBody !== undefined ? { responseBody: event.responseBody } : {}),
        ...(event.parsedResult !== undefined ? { parsedResult: event.parsedResult } : {}),
        ...(event.extra ? { extra: event.extra } : {}),
      });

      const systemPrompt = [options.system, modeResult.systemSuffix].filter(Boolean).join('\n');
      const content = [...options.content, { type: 'text', text: options.user }];
      const body = {
        model: this.config.model,
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content },
        ],
        ...(modeResult.responseFormat ? { response_format: modeResult.responseFormat } : {}),
        stream: false,
      };

      let response: Response;
      try {
        response = await fetch(this.config.endpoint, {
          method: 'POST', headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        });
      } catch (error) {
        await logAttempt({
          status: 'failed', durationMs: Date.now() - started,
          failureStage: 'fetch', requestBody: body,
          errorName: error instanceof Error ? error.name : undefined, errorMessage: errorMessage(error),
          extra: { structuredMode: modeResult.mode },
        });
        throw providerFetchError(error);
      }

      const responseRaw = await response.text();

      if (!response.ok) {
        // Protocol fallback: only for auto mode + explicit unsupported error
        if (structuredMode === 'auto' && isStructuredOutputUnsupported(response.status, responseRaw)) {
          const nextMode = downgradeMode(modeResult.mode);
          if (nextMode && protocolFallbackCount < maxProtocolFallback) {
            protocolFallbackCount += 1;
            await logAttempt({
              status: 'failed', durationMs: Date.now() - started,
              failureStage: 'http', httpStatus: response.status, requestBody: body, responseBody: responseRaw,
              extra: { structuredMode: modeResult.mode, structuredFallback: nextMode },
            });
            modeResult = resolveStructuredMode(nextMode, schemaName, options.schema, jsonSchemaOverride);
            continue;
          }
        }
        await logAttempt({
          status: 'failed', durationMs: Date.now() - started,
          failureStage: 'http', httpStatus: response.status, requestBody: body, responseBody: responseRaw,
          extra: { structuredMode: modeResult.mode },
        });
        console.error(`[ai] ${options.operation} failed requestId=${requestId.slice(0, 8)}`);
        throw providerHttpError(response.status);
      }

      // HTTP OK — parse and validate
      let parsedBody: unknown;
      try { parsedBody = JSON.parse(responseRaw); }
      catch {
        await logAttempt({
          status: 'failed', durationMs: Date.now() - started,
          failureStage: 'response-json', httpStatus: response.status, requestBody: body, responseBody: responseRaw,
          extra: { structuredMode: modeResult.mode },
        });
        throw invalidProviderResponse(requestId);
      }
      const choices = (parsedBody as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
      const raw = extractTextContent(choices?.[0]?.message?.content).trim();
      if (!raw) {
        await logAttempt({
          status: 'failed', durationMs: Date.now() - started,
          failureStage: 'content-extract', httpStatus: response.status, requestBody: body, responseBody: parsedBody,
          extra: { structuredMode: modeResult.mode, usage: extractResponseUsage(parsedBody) },
        });
        throw invalidProviderResponse(requestId);
      }

      let parsed: unknown;
      try {
        parsed = modeResult.mode === 'text-json' ? parseRawJson(raw) : JSON.parse(raw);
      } catch {
        await logAttempt({
          status: 'failed', durationMs: Date.now() - started,
          failureStage: 'content-json-parse', httpStatus: response.status, requestBody: body, responseBody: parsedBody,
          extra: { structuredMode: modeResult.mode, usage: extractResponseUsage(parsedBody), responseSnippet: raw.slice(0, 2000) },
        });
        throw invalidProviderResponse(requestId);
      }

      const normalized = normalizeStructuredPayload(parsed, schema);
      if (normalized.success) {
        await logAttempt({
          status: 'succeeded', durationMs: Date.now() - started,
          httpStatus: response.status, requestBody: body, responseBody: parsedBody, parsedResult: normalized.data,
          extra: {
            structuredMode: modeResult.mode,
            usage: extractResponseUsage(parsedBody),
            ...(normalized.normalization ? { normalization: normalized.normalization } : {}),
          },
        });
        return normalized.data;
      }

      // Schema validation failed — one retry allowed across the entire request
      const zodIssueList = zodIssues(normalized.error);
      if (!schemaRetryUsed) {
        schemaRetryUsed = true;
        if (structuredMode === 'auto' && modeResult.mode !== 'text-json') {
          const nextMode = downgradeMode(modeResult.mode);
          if (nextMode) {
            modeResult = resolveStructuredMode(nextMode, schemaName, options.schema, jsonSchemaOverride);
          }
        }
        await logAttempt({
          status: 'failed', durationMs: Date.now() - started,
          failureStage: 'schema-validate', httpStatus: response.status, requestBody: body, responseBody: parsedBody,
          extra: { structuredMode: modeResult.mode, usage: extractResponseUsage(parsedBody), responseSnippet: raw.slice(0, 2000), zodIssues: zodIssueList, structuredFallback: 'schema-retry' },
        });
        continue;
      }

      await logAttempt({
        status: 'failed', durationMs: Date.now() - started,
        failureStage: 'schema-validate', httpStatus: response.status, requestBody: body, responseBody: parsedBody,
        extra: { structuredMode: modeResult.mode, usage: extractResponseUsage(parsedBody), responseSnippet: raw.slice(0, 2000), zodIssues: zodIssueList },
      });
      throw invalidProviderResponse(requestId);
    }

    // Unreachable — while(true) always returns or throws
  }
}
