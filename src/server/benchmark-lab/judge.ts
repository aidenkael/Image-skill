import fs from 'node:fs/promises';
import {
  candidateStatusFor,
  validateJudgeCoverage,
  type BenchmarkJudgeResult,
  type BenchmarkScenario,
} from '@/core/benchmark-lab';
import { makeVisionPreview } from '@/server/image/sharp';
import type { VisionProvider } from '@/server/providers/vision-provider';
import { scenarioGoal } from './scenarios';

/**
 * Benchmark judge：Vision 对候选做确定性 PASS/FAIL 判定（硬性失败项）。
 * 不使用美学评分；允许柔性部件在重力/使用下的自然状态变化。
 */

export interface JudgeBenchmarkRunOptions {
  visionProvider: VisionProvider;
  runId: string;
  scenario: BenchmarkScenario;
  sourceImagePath: string;
  cropPaths: string[];
  candidatePaths: string[];
}

export interface JudgedCandidate {
  candidateIndex: number;
  status: 'pass' | 'fail';
  hardFailures: BenchmarkJudgeResult['hardFailures'];
  notes: BenchmarkJudgeResult['notes'];
}

export async function judgeBenchmarkRun(options: JudgeBenchmarkRunOptions): Promise<JudgedCandidate[]> {
  const [sourceBuffer, ...rest] = await Promise.all([
    fs.readFile(options.sourceImagePath),
    ...options.cropPaths.map((filePath) => fs.readFile(filePath)),
    ...options.candidatePaths.map((filePath) => fs.readFile(filePath)),
  ]);
  const cropBuffers = rest.slice(0, options.cropPaths.length);
  const candidateBuffers = rest.slice(options.cropPaths.length);
  if (candidateBuffers.length !== options.candidatePaths.length) {
    throw new Error('候选图读取不完整，无法判定');
  }

  // Vision 输入统一压缩为 jpeg 预览，控制请求体积
  const previews = await Promise.all([
    makeVisionPreview(sourceBuffer),
    ...cropBuffers.map((buffer) => makeVisionPreview(buffer)),
    ...candidateBuffers.map((buffer) => makeVisionPreview(buffer)),
  ]);
  const [sourcePreview] = previews;
  const cropPreviews = previews.slice(1, 1 + cropBuffers.length);
  const candidatePreviews = previews.slice(1 + cropBuffers.length);

  const results = await options.visionProvider.judgeBenchmarkCandidates({
    runId: options.runId,
    scenario: options.scenario,
    scenarioGoal: scenarioGoal(options.scenario),
    sourceBuffer: sourcePreview,
    cropBuffers: cropPreviews,
    candidateBuffers: candidatePreviews,
  });

  // 覆盖校验：每个候选恰好一次，越界/重复/缺失都拒绝
  validateJudgeCoverage(results, options.candidatePaths.length);

  return results
    .slice()
    .sort((a, b) => a.candidateIndex - b.candidateIndex)
    .map((result) => ({
      candidateIndex: result.candidateIndex,
      status: candidateStatusFor(result.hardFailures) as 'pass' | 'fail',
      hardFailures: result.hardFailures,
      notes: result.notes,
    }));
}
