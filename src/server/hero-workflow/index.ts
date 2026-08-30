import fs from 'node:fs/promises';
import path from 'node:path';
import type { HeroBrief } from '@/core/hero-workflow';
import type { HeroWorkflowInput, HeroWorkflowOutcome } from './contracts';
import { executeHeroWorkflow } from './executor';
import {
  collectRepairFeedback,
  reviewHeroCandidates,
  selectUsableInPreferredOrder,
  type ReviewedHeroImage,
} from './reviewer';

/**
 * 一键氛围主图工作流编排：
 * 初始生成 N 张 → 一次批量 QA → 足够则直接返回；
 * 不足则用 QA 修复反馈补生一次 → 再一次批量 QA → 合并。
 *
 * 数量不变量：成功任务必须恰好交付 request.count 张；
 * 最多一次补生，不迭代重试、不无限循环。
 */
export async function runHeroWorkflow(
  input: HeroWorkflowInput,
  brief: HeroBrief,
  outDir: string,
): Promise<HeroWorkflowOutcome> {
  const targetCount = input.count;

  // ── 第一轮：生成 N 张并批量 QA ──
  const initialImages = await executeHeroWorkflow(input, brief, outDir, {
    count: targetCount,
    startIndex: 0,
  });
  const initialBatch = await reviewHeroCandidates(input, brief, initialImages);
  let usable = selectUsableInPreferredOrder(initialBatch);
  const allReviewed: ReviewedHeroImage[] = [...initialBatch.reviewed];

  // ── 可用不足：仅补生成一次，携带 QA 修复反馈 ──
  if (usable.length < targetCount) {
    const missing = targetCount - usable.length;
    const refillImages = await executeHeroWorkflow(input, brief, outDir, {
      count: missing,
      startIndex: initialImages.length,
      repairInstruction: collectRepairFeedback(initialBatch.reviewed),
    });
    const refillBatch = await reviewHeroCandidates(input, brief, refillImages);
    usable = [...usable, ...selectUsableInPreferredOrder(refillBatch)];
    allReviewed.push(...refillBatch.reviewed);
  }

  // ── 仍不足则清理全部临时文件并失败 ──
  if (usable.length < targetCount) {
    for (const item of allReviewed) {
      await fs.rm(item.image.localPath, { force: true }).catch(() => undefined);
    }
    throw new Error(
      `氛围主图质检后仅有 ${usable.length}/${targetCount} 张合格，请稍后重试`,
    );
  }

  // ── 按偏好顺序取前 N 张，清理未通过和未选中的候选 ──
  const selected = usable.slice(0, targetCount);
  const selectedPaths = new Set(selected.map((item) => item.image.localPath));
  for (const item of allReviewed) {
    if (!selectedPaths.has(item.image.localPath)) {
      await fs.rm(item.image.localPath, { force: true }).catch(() => undefined);
    }
  }

  // ── 按偏好顺序重命名为 result-01.ext ... ──
  const candidates: HeroWorkflowOutcome['candidates'] = [];
  let idx = 0;
  for (const item of selected) {
    idx += 1;
    const fileName = `result-${String(idx).padStart(2, '0')}.${item.image.extension}`;
    const localPath = path.join(outDir, fileName);
    await fs.rename(item.image.localPath, localPath);
    candidates.push({ url: item.image.url, localPath });
  }

  return { brief, candidates };
}

export type { HeroWorkflowCandidate, HeroWorkflowInput, HeroWorkflowOutcome } from './contracts';
export { buildHeroGenerationPrompt } from './prompt-builder';
export { createHeroBrief } from './director';
export { executeHeroWorkflow } from './executor';
export {
  collectRepairFeedback,
  reviewHeroCandidates,
  selectUsableInPreferredOrder,
  validateHeroBatchReview,
} from './reviewer';
