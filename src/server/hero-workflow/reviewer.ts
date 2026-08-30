import type {
  HeroBatchReview,
  HeroBrief,
  HeroCandidateAssessment,
} from '@/core/hero-workflow';
import { makeVisionPreview } from '@/server/image/sharp';
import { createActiveVisionProvider } from '@/server/providers/factory';
import type { HeroWorkflowInput } from './contracts';
import type { ExecutedHeroImage } from './executor';

/**
 * 批量质检：一次 Vision 调用评审源图 + 全部候选图。
 * 可用性由服务端确定性推导：hardFailures 为空才可用，
 * 不信任模型自报的布尔；无 0–100 分数阈值。
 */

export interface ReviewedHeroImage {
  image: ExecutedHeroImage;
  assessment: HeroCandidateAssessment;
  usable: boolean;
}

export interface HeroBatchReviewOutcome {
  reviewed: ReviewedHeroImage[];
  /** QA 偏好顺序（候选索引），可用者优先 */
  preferredOrder: number[];
}

/**
 * 确定性校验批量 QA 结果：
 * - 每个候选恰好一条评估，索引无重复、全覆盖；
 * - preferredOrder 为合法且唯一的候选索引。
 */
export function validateHeroBatchReview(review: HeroBatchReview, candidateCount: number): void {
  if (review.assessments.length !== candidateCount) {
    throw new Error(`质检结果数量不匹配：候选 ${candidateCount} 张，评估 ${review.assessments.length} 条`);
  }
  const seen = new Set<number>();
  for (const assessment of review.assessments) {
    const index = assessment.candidateIndex;
    if (!Number.isInteger(index) || index < 0 || index >= candidateCount) {
      throw new Error(`质检结果包含非法候选索引：${index}`);
    }
    if (seen.has(index)) {
      throw new Error(`质检结果存在重复候选索引：${index}`);
    }
    seen.add(index);
  }
  if (seen.size !== candidateCount) {
    throw new Error('质检结果未覆盖全部候选图');
  }
  const ordered = new Set<number>();
  for (const index of review.preferredOrder) {
    if (!Number.isInteger(index) || index < 0 || index >= candidateCount) {
      throw new Error(`质检偏好顺序包含非法候选索引：${index}`);
    }
    if (ordered.has(index)) {
      throw new Error(`质检偏好顺序存在重复候选索引：${index}`);
    }
    ordered.add(index);
  }
}

/** 合并被拒候选的非空修复指令，供唯一一次补生使用。 */
export function collectRepairFeedback(reviewed: ReviewedHeroImage[]): string | undefined {
  const parts: string[] = [];
  for (const item of reviewed) {
    if (item.usable) continue;
    const instruction = item.assessment.repairInstruction?.trim();
    if (instruction && !parts.includes(instruction)) parts.push(instruction);
  }
  return parts.length === 0 ? undefined : parts.join(' ');
}

/** 按偏好顺序取出可用候选；偏好顺序未包含的可用候选补在末尾。 */
export function selectUsableInPreferredOrder(outcome: HeroBatchReviewOutcome): ReviewedHeroImage[] {
  const byIndex = new Map(outcome.reviewed.map((item, index) => [index, item]));
  const ordered: ReviewedHeroImage[] = [];
  for (const index of outcome.preferredOrder) {
    const item = byIndex.get(index);
    if (item?.usable) ordered.push(item);
  }
  for (const item of outcome.reviewed) {
    if (item.usable && !ordered.includes(item)) ordered.push(item);
  }
  return ordered;
}

export async function reviewHeroCandidates(
  input: HeroWorkflowInput,
  brief: HeroBrief,
  images: ExecutedHeroImage[],
): Promise<HeroBatchReviewOutcome> {
  const provider = await createActiveVisionProvider();
  const generated = [];
  for (const image of images) {
    generated.push({
      assetId: input.sourceAssetId,
      role: input.sourceAssetRole,
      mimeType: 'image/jpeg' as const,
      buffer: await makeVisionPreview(image.buffer),
    });
  }
  const review = await provider.reviewHeroBatch({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    source: {
      assetId: input.sourceAssetId,
      role: input.sourceAssetRole,
      mimeType: 'image/jpeg',
      buffer: input.sourcePreview,
    },
    generated,
    brief,
    humanPolicy: input.humanPolicy,
  });

  validateHeroBatchReview(review, images.length);
  const byIndex = new Map(review.assessments.map((assessment) => [assessment.candidateIndex, assessment]));
  const reviewed: ReviewedHeroImage[] = images.map((image, index) => {
    const assessment = byIndex.get(index)!;
    return { image, assessment, usable: assessment.hardFailures.length === 0 };
  });
  return { reviewed, preferredOrder: review.preferredOrder };
}
