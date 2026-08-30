import fs from 'node:fs/promises';
import path from 'node:path';
import type { HeroWorkflowContext, HeroWorkflowInput, HeroWorkflowOutcome } from './contracts';
import { executeHeroWorkflow } from './executor';
import { planHeroWorkflow } from './planner';
import { reviewHeroCandidates } from './reviewer';

/**
 * 通用氛围主图工作流编排：
 * 商品理解（复用新鲜 Product Intelligence）→ 策划 → 执行 → 审片 → 结果标记。
 * 全部输出不通过审片时整体失败；有通过结果时保留并按 score 降序。
 */
export async function runHeroWorkflow(
  input: HeroWorkflowInput,
  context: HeroWorkflowContext,
  outDir: string,
): Promise<HeroWorkflowOutcome> {
  const plan = await planHeroWorkflow(input, context);
  const images = await executeHeroWorkflow(input, plan, outDir);
  const reviewed = await reviewHeroCandidates(input, plan, images);

  const passed = reviewed
    .filter((item) => item.passed)
    .sort((a, b) => b.review.score - a.review.score);
  if (passed.length === 0) {
    const issues = reviewed.flatMap((item) => item.review.issues).slice(0, 3);
    const detail = issues.length > 0 ? `：${issues.join('；')}` : '';
    throw new Error(`氛围主图未通过审片，本次没有可交付结果${detail}`);
  }

  const candidates: HeroWorkflowOutcome['candidates'] = [];
  let idx = 0;
  for (const item of passed) {
    idx += 1;
    const fileName = `result-${String(idx).padStart(2, '0')}.${item.image.extension}`;
    const localPath = path.join(outDir, fileName);
    await fs.rename(item.image.localPath, localPath);
    candidates.push({ url: item.image.url, localPath, review: item.review });
  }
  for (const item of reviewed) {
    if (!item.passed) await fs.rm(item.image.localPath, { force: true });
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
