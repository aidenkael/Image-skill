import { ProductIntelligencePayloadSchema } from '@/core/intelligence';
import type {
  ProductIntelligenceInput,
  ProductIntelligenceProvider,
} from './vision-provider';
import { ProviderConfigError, ProviderRequestError } from './provider-errors';

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

Every visibleFacts / visibleText / sellingPoints item must cite one or more
exact supplied asset ids in evidenceAssetIds.

Hero directions may alter scene, lighting, composition and human interaction
only. They must preserve product identity, shape, proportion, color, pattern,
logo/text, visible material appearance, structure, count, accessories,
ports/hardware and function.

Return 1 to 3 commercially distinct Hero directions.
Use only supplied asset ids for sourceAssetId.
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
  heroDirections[]
  collage:
    titleOptions[]
    sellingPoints[]

Each selling point must be directly supported by visible evidence.
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
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new ProviderConfigError(
        '未配置 DASHSCOPE_API_KEY：请在项目 .env 中配置后重新启动工作台',
      );
    }

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

    const response = await fetch(resolveVisionApiUrl(apiKey), {
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

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new ProviderRequestError(`商品分析请求失败 HTTP ${response.status}: ${detail}`);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderRequestError('商品分析响应不是有效 JSON');
    }
    const choices = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
    const raw = responseText(choices?.[0]?.message?.content).trim();
    if (!raw) throw new ProviderRequestError('商品分析响应内容为空');

    try {
      return ProductIntelligencePayloadSchema.parse(JSON.parse(raw));
    } catch {
      throw new ProviderRequestError('商品分析响应不符合结构化数据要求');
    }
  }
}
