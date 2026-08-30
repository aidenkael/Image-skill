import crypto from 'node:crypto';
import type { HeroPlanV2 } from '@/core/hero-workflow';
import { isIntelligenceFresh, type ProductIntelligenceRecord } from '@/core/intelligence';
import type { AssetRef } from '@/core/assets';
import { writeAILog } from '@/server/logging/ai-log';
import { createActiveVisionProvider } from '@/server/providers/factory';
import type { HeroWorkflowContext, HeroWorkflowInput } from './contracts';

/**
 * Phase B：氛围主图策划。
 * 优先复用覆盖当前源图的新鲜 Product Intelligence 的商品理解（不重新做大分析，
 * 也不创建/覆盖 Intelligence 记录），再执行一次轻量 VLM 策划，产出 HeroPlanV2。
 */

/** 只有覆盖当前源图的新鲜分析才能作为策划上下文；否则返回 undefined。 */
export function productUnderstandingForSource(
  intelligence: ProductIntelligenceRecord | null,
  assets: AssetRef[],
  sourceAssetId: string,
): string | undefined {
  if (!intelligence) return undefined;
  if (!isIntelligenceFresh(intelligence, assets)) return undefined;
  if (!intelligence.assetSnapshot.some((asset) => asset.id === sourceAssetId)) return undefined;
  return intelligence.analysis.visualSummary;
}

export async function planHeroWorkflow(
  input: HeroWorkflowInput,
  context: HeroWorkflowContext,
): Promise<HeroPlanV2> {
  const provider = await createActiveVisionProvider();
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const log = (extra: Record<string, unknown>) => writeAILog({
    requestId,
    operation: 'hero.plan',
    workspaceId: input.workspaceId,
    status: 'succeeded',
    durationMs: Date.now() - started,
    humanPolicy: input.humanPolicy,
    creativeLevel: input.creativeLevel,
    assetIds: [input.sourceAssetId],
    ...extra,
  });
  try {
    const plan = await provider.planHeroV2({
      workspaceId: input.workspaceId,
      workspaceName: input.workspaceName,
      asset: {
        assetId: input.sourceAssetId,
        role: input.sourceAssetRole,
        mimeType: 'image/jpeg',
        buffer: input.sourcePreview,
      },
      humanPolicy: input.humanPolicy,
      creativeLevel: input.creativeLevel,
      creativeIntent: input.creativeIntent,
      productUnderstanding: productUnderstandingForSource(
        context.intelligence,
        context.assets,
        input.sourceAssetId,
      ),
    });
    await log({ status: 'succeeded', displayMode: plan.displayMode });
    return plan;
  } catch (error) {
    await log({
      status: 'failed',
      errorName: error instanceof Error ? error.name : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
