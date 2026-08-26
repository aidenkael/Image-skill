import { HeroRuntimePlanSchema, ProductIntelligencePayloadSchema } from '@/core/intelligence';
import type { ResolvedVisionConfig } from '@/server/settings/ai';
import type { HeroPlanningInput, ProductIntelligenceInput, ProductIntelligenceProvider } from './vision-provider';
import { invalidProviderResponse, providerFetchError, providerHttpError } from './provider-errors';

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

function responseText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const text = (item as { text?: unknown }).text;
    return typeof text === 'string' ? [text] : [];
  }).join('');
}

export class AliyunQwenVisionProvider implements ProductIntelligenceProvider {
  constructor(private readonly config: ResolvedVisionConfig) {}

  async analyze(input: ProductIntelligenceInput) {
    const content = input.assets.flatMap((asset) => [
      { type: 'text', text: `assetId=${asset.assetId}; role=${asset.role}` },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${asset.buffer.toString('base64')}` } },
    ]);
    content.push({ type: 'text', text: userPrompt(input.workspaceName) });

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content }],
          response_format: { type: 'json_object' },
          enable_thinking: false,
          stream: false,
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) { throw providerFetchError(error); }
    if (!response.ok) {
      console.error('[qwen vision] upstream request failed', { status: response.status });
      throw providerHttpError(response.status);
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw invalidProviderResponse(); }
    const choices = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
    const raw = responseText(choices?.[0]?.message?.content).trim();
    if (!raw) throw invalidProviderResponse();
    try { return ProductIntelligencePayloadSchema.parse(JSON.parse(raw)); }
    catch { throw invalidProviderResponse(); }
  }

  async planHero(input: HeroPlanningInput) {
    const creativeIntent = input.creativeIntent
      ? `\nUser creative intent (preserve it while adapting it to the visible product): ${input.creativeIntent}`
      : '';
    const planningInstruction = `Inspect the visible product in the supplied image before planning.\n` +
      `Return exactly JSON: {"prompt":"..."}. The prompt must be English and propose one strongest product-specific ecommerce Hero direction.\n` +
      `Preserve product identity, shape, proportions, color, visible material appearance, pattern, logo/text, structure, count, accessories and visible hardware.\n` +
      `Do not invent unseen back/interior/accessories/functions or unsupported factual claims. Do not force a predefined scene, style or person taxonomy.\n` +
      `Freely choose scene, camera, environment, lighting, spatial treatment and mood. Prioritize commercial usefulness, believable photography and low AI-looking output.` + creativeIntent;
    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${input.asset.buffer.toString('base64')}` } },
            { type: 'text', text: planningInstruction },
          ] }],
          response_format: { type: 'json_object' },
          enable_thinking: false,
          stream: false,
        }),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) { throw providerFetchError(error); }
    if (!response.ok) {
      console.error('[qwen vision] hero planning request failed', { status: response.status });
      throw providerHttpError(response.status);
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw invalidProviderResponse(); }
    const choices = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices;
    const raw = responseText(choices?.[0]?.message?.content).trim();
    if (!raw) throw invalidProviderResponse();
    try { return HeroRuntimePlanSchema.parse(JSON.parse(raw)); }
    catch { throw invalidProviderResponse(); }
  }
}
