import fs from 'node:fs/promises';
import path from 'node:path';
import type { HeroPlanV2 } from '@/core/hero-workflow';
import type { HeroWorkflowContext, HeroWorkflowInput, HeroWorkflowOutcome } from './contracts';
import { executeHeroWorkflow } from './executor';
import { reviewHeroCandidates } from './reviewer';
import type { ExecutedHeroImage } from './executor';
import type { ReviewedHeroImage } from './reviewer';

/**
 * 通用氛围主图工作流编排（执行已策划方案）。
 * 输入为一个已确定的 HeroPlanV2，不再重新策划。
 *
 * 数量不变量：成功任务必须恰好交付 request.count 张通过审片的图片。
 * 最多两轮生成（initial + one refill），不无限重试。
 */
export async function runPlannedHeroWorkflow(
  input: HeroWorkflowInput,
  plan: HeroPlanV2,
  outDir: string,
): Promise<HeroWorkflowOutcome> {
  const targetCount = input.count;

  // ── 第一轮：生成 N 张并审片 ──
  const initialImages = await executeHeroWorkflow(input, plan, outDir, {
    count: targetCount,
    startIndex: 0,
    variant: 'primary',
    attempt: 1,
  });
  const initialReviewed = await reviewHeroCandidates(input, plan, initialImages);
  let allPassed = initialReviewed.filter((item) => item.passed);
  let allFailed = initialReviewed.filter((item) => !item.passed);

  // ── 若通过不足，仅补生成一次 ──
  if (allPassed.length < targetCount) {
    const missing = targetCount - allPassed.length;
    const refillVariant = plan.altPrompt ? 'alt' : 'primary';
    const refillImages = await executeHeroWorkflow(input, plan, outDir, {
      count: missing,
      startIndex: initialImages.length,
      variant: refillVariant,
      attempt: 2,
    });
    const refillReviewed = await reviewHeroCandidates(input, plan, refillImages);
    allPassed = [...allPassed, ...refillReviewed.filter((item) => item.passed)];
    allFailed = [...allFailed, ...refillReviewed.filter((item) => !item.passed)];
  }

  // ── 仍不足则清理所有临时文件并失败 ──
  if (allPassed.length < targetCount) {
    const allImages = [...initialImages, ...(allPassed.length > 0 ? [] : [])];
    for (const item of [...initialImages, ...allFailed.flatMap((item) => [item.image])]) {
      await fs.rm(item.localPath, { force: true }).catch(() => undefined);
    }
    for (const item of allPassed) {
      await fs.rm(item.image.localPath, { force: true }).catch(() => undefined);
    }
    throw new Error(
      `氛围主图审片后仅有 ${allPassed.length}/${targetCount} 张合格，请调整方案后重试`,
    );
  }

  // ── 按 score 降序取前 N 张 ──
  allPassed.sort((a, b) => b.review.score - a.review.score);
  const selected = allPassed.slice(0, targetCount);
  const notSelected = allPassed.slice(targetCount);

  // ── 清理未通过和未选中的候选 ──
  for (const item of allFailed) {
    await fs.rm(item.image.localPath, { force: true }).catch(() => undefined);
  }
  for (const item of notSelected) {
    await fs.rm(item.image.localPath, { force: true }).catch(() => undefined);
  }

  // ── 按 score 降序重命名为 result-01.ext ... ──
  const candidates: HeroWorkflowOutcome['candidates'] = [];
  let idx = 0;
  for (const item of selected) {
    idx += 1;
    const fileName = `result-${String(idx).padStart(2, '0')}.${item.image.extension}`;
    const localPath = path.join(outDir, fileName);
    await fs.rename(item.image.localPath, localPath);
    candidates.push({ url: item.image.url, localPath, review: item.review });
  }

  return { plan, candidates };
}

export type {
  HeroWorkflowCandidate,
  HeroWorkflowContext,
  HeroWorkflowInput,
  HeroWorkflowOutcome,
} from './contracts';
export { buildHeroWorkflowPrompt } from './prompt-builder';
export { planHeroWorkflow, productUnderstandingForSource } from './planner';
export { executeHeroWorkflow } from './executor';
export { isHeroReviewPassed, reviewHeroCandidates } from './reviewer';
export { getHeroPlanRecord, createHeroPlanRecord, isHeroPlanRecordFresh } from './plan-store';
export type { CreateHeroPlanRecordInput } from './plan-store';
