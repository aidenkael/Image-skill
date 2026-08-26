import { ProductIntelligencePayloadSchema } from '@/core/intelligence';
import type {
  ProductIntelligenceInput,
  ProductIntelligenceProvider,
} from './vision-provider';
import {
  invalidProviderResponse,
  providerFetchError,
  providerHttpError,
  ProviderConfigError,
} from './provider-errors';
import { resolveAICredential } from '@/server/settings/ai';

export const QWEN_VISION_MODEL = 'qwen3.7-plus';
export const DEFAULT_VISION_API_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
export const TOKEN_PLAN_VISION_API_URL =
  'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions';

export const SYSTEM_PROMPT = `You are an ecommerce product photographer and visual merchandising planner.
Return exactly one valid JSON object and no markdown.
All user-facing analysis text must be Simplified Chinese.
Hero prompt strings must be English.

Treat all factual product claims as evidence-bound.
Only describe facts directly visible in supplied product images.
Never infer material composition, exact size, weight, capacity, model,
compatibility, electrical properties, waterproof claims, food safety,
hypoallergenic claims, certification, performance or durability.
Put uncertain items in unverifiedFacts.

Images whose role is reference are aesthetic references only.
They must never establish product facts.

Every visibleFacts, visibleText, collage.titleOptions and
collage.sellingPoints item must contain text and one or more exact supplied
asset ids in evidenceAssetIds.

Collage title text must be at most 60 characters.
Collage selling-point text must be at most 40 characters.

Reference-role images are aesthetic references only and must never appear in
evidenceAssetIds for visible facts, visible text, collage titles or collage
selling points.

Hero concepts must preserve product identity, shape, proportion, color, pattern,
logo/text, visible material appearance, structure, count, accessories,
ports/hardware and function.

Return 1 to 3 product-specific open creative Hero concepts.
Do not classify concepts into a predefined scene/style/person taxonomy.
Do not force or forbid people unless the product and concept justify it.
Freely choose the most effective artistic/commercial treatment for this specific product.
Each concept must contain id, title in Simplified Chinese,
recommendedSourceAssetId, creativeBrief in Simplified Chinese,
prompt in English, and reason in Simplified Chinese.
Use only supplied non-reference asset ids for recommendedSourceAssetId.
Use ids hero-1, hero-2, hero-3 in order.`;

function userPrompt(workspaceName: string): string {
  return `Analyze this single ecommerce product from the supplied images.
Workspace product name: ${workspaceName}

Return JSON with:
analysis:
  category
  visualSummary
  visibleFacts[]
  visibleText[]
  unverifiedFacts[]
  assetObservations[]
plan:
  heroConcepts[]
  collage:
    titleOptions[] as { text, evidenceAssetIds[] }
    sellingPoints[] as { text, evidenceAssetIds[] }

Each title and selling point must be directly supported by visible evidence.
Prefer mobile-commerce clarity, truthful visual merchandising,
natural commercial photography and low AI-looking scenes.`;
}

export function resolveVisionApiUrl(apiKey: string): string {
  if (process.env.DASHSCOPE_VISION_API_URL) return process.env.DASHSCOPE_VISION_API_URL;
  if (apiKey.startsWith('sk-sp-')) return TOKEN_PLAN_VISION_API_URL;
  return DEFAULT_VISION_API_URL;
}

function responseText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const text = (item as { text?: unknown }).text;
      return typeof text === 'string' ? [text] : [];
    })
    .join('');
}

export class AliyunQwenVisionProvider implements ProductIntelligenceProvider {
  async analyze(input: ProductIntelligenceInput) {
    const credential = await resolveAICredential();
    if (!credential) {
      throw new ProviderConfigError(
        'AI 尚未配置，请在工作台 AI 设置中保存 Key，或配置 DASHSCOPE_API_KEY。',
      );
    }
    const apiKey = credential.apiKey;

    const content = input.assets.flatMap((asset) => [
      { type: 'text', text: `assetId=${asset.assetId}; role=${asset.role}` },
      {
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${asset.buffer.toString('base64')}`,
        },
      },
    ]);
    content.push({ type: 'text', text: userPrompt(input.workspaceName) });

    let response: Response;
    try {
      response = await fetch(resolveVisionApiUrl(apiKey), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: QWEN_VISION_MODEL,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content },
          ],
          response_format: { type: 'json_object' },
          enable_thinking: false,
          stream: false,
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      throw providerFetchError(error);
    }

    if (!response.ok) {
      console.error('[qwen vision] upstream request failed', { status: response.status });
      throw providerHttpError(response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw invalidProviderResponse();
    }
    const choices = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
    const raw = responseText(choices?.[0]?.message?.content).trim();
    if (!raw) throw invalidProviderResponse();

    try {
      return ProductIntelligencePayloadSchema.parse(JSON.parse(raw));
    } catch {
      throw invalidProviderResponse();
    }
  }
}

export async function testVisionConnection(): Promise<void> {
  const credential = await resolveAICredential();
  if (!credential) {
    throw new ProviderConfigError('AI 尚未配置，请先保存 Key 或配置 DASHSCOPE_API_KEY。');
  }
  let response: Response;
  try {
    response = await fetch(resolveVisionApiUrl(credential.apiKey), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credential.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: QWEN_VISION_MODEL,
        messages: [{ role: 'user', content: 'Reply with OK only.' }],
        enable_thinking: false,
        max_tokens: 4,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw providerFetchError(error);
  }
  if (!response.ok) {
    console.error('[qwen vision test] upstream request failed', { status: response.status });
    throw providerHttpError(response.status);
  }
  try {
    await response.json();
  } catch {
    throw invalidProviderResponse();
  }
}
