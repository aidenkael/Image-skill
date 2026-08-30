import crypto from 'node:crypto';
import { HERO_REVIEW_PASS_SCORE, type HeroPlanV2, type HeroReview } from '@/core/hero-workflow';
import { writeAILog } from '@/server/logging/ai-log';
import { makeVisionPreview } from '@/server/image/sharp';
import { createActiveVisionProvider } from '@/server/providers/factory';
import type { HeroWorkflowInput } from './contracts';
import type { ExecutedHeroImage } from './executor';

/**
 * Phase D：审片 / 质检。
 * 只做审片与结果标记，不做自动多轮重试。
 * 通过规则（服务端确定性执行）：score >= 70 且 reviewer 未标记严重问题。
 */

export interface ReviewedHeroImage {
  image: ExecutedHeroImage;
  review: HeroReview;
  passed: boolean;
}

export function isHeroReviewPassed(review: HeroReview): boolean {
  return review.passed && review.score >= HERO_REVIEW_PASS_SCORE;
}

export async function reviewHeroCandidates(
  input: HeroWorkflowInput,
  plan: HeroPlanV2,
  images: ExecutedHeroImage[],
): Promise<ReviewedHeroImage[]> {
  const provider = await createActiveVisionProvider();
  const sourcePreview = input.sourcePreview;
  const reviewed: ReviewedHeroImage[] = [];
  for (const image of images) {
    const requestId = crypto.randomUUID();
    const started = Date.now();
    const log = (extra: Record<string, unknown>) => writeAILog({
      requestId,
      operation: 'hero.review',
      workspaceId: input.workspaceId,
      status: 'succeeded',
      durationMs: Date.now() - started,
      displayMode: plan.displayMode,
      humanPolicy: input.humanPolicy,
      creativeLevel: input.creativeLevel,
      ...extra,
    });
    try {
      const review = await provider.reviewHero({
        workspaceId: input.workspaceId,
        source: {
          assetId: input.sourceAssetId,
          role: input.sourceAssetRole,
          mimeType: 'image/jpeg',
          buffer: sourcePreview,
        },
        generated: {
          assetId: input.sourceAssetId,
          role: input.sourceAssetRole,
          mimeType: 'image/jpeg',
          buffer: await makeVisionPreview(image.buffer),
        },
        displayMode: plan.displayMode,
        humanPolicy: plan.humanPolicy,
        preserve: plan.preserve,
        flexible: plan.flexible,
      });
      const passed = isHeroReviewPassed(review);
      await log({ status: 'succeeded', reviewScore: review.score, reviewPassed: passed });
      reviewed.push({ image, review, passed });
    } catch (error) {
      await log({
        status: 'failed',
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  return reviewed;
}
