import { z } from 'zod';
import { HeroRatioSchema } from './hero-workflow';

/**
 * Benchmark Lab：独立 R&D 域，用于对比多条图像执行路线在同一商品、
 * 同一场景下的商品保真表现。不是正式工作台 Hero 流程的一部分。
 *
 * 定义：
 * - Reference Pack = 1 张完整源图（隐式）+ 0..3 张自动细节裁剪图
 * - Benchmark run = 1 lane × 1 scenario，固定生成恰好 4 张候选
 * - Judge = 按硬性失败项得出确定性 PASS/FAIL（不使用美学评分）
 */

export const BenchmarkScenarioSchema = z.enum([
  'human-carry',
  'tabletop-placement',
  'hanging-display',
]);
export type BenchmarkScenario = z.infer<typeof BenchmarkScenarioSchema>;

export const BenchmarkLaneSchema = z.enum([
  'qwen-single-extend-on',
  'qwen-single-extend-off',
  'qwen-multi-ref',
  'seedream-multi-ref',
  'wan-multi-ref',
]);
export type BenchmarkLane = z.infer<typeof BenchmarkLaneSchema>;

export const BENCHMARK_SCENARIO_LABELS: Record<BenchmarkScenario, string> = {
  'human-carry': '真人携带',
  'tabletop-placement': '台面摆放',
  'hanging-display': '悬挂展示',
};

export const BENCHMARK_LANE_LABELS: Record<BenchmarkLane, string> = {
  'qwen-single-extend-on': 'DashScope 单图 · 提示词扩写开',
  'qwen-single-extend-off': 'DashScope 单图 · 提示词扩写关',
  'qwen-multi-ref': 'DashScope 多参考图',
  'seedream-multi-ref': '方舟 Seedream 多参考图',
  'wan-multi-ref': 'Wan 多参考图',
};

export const BenchmarkCandidateStatusSchema = z.enum(['pass', 'fail', 'unavailable']);
export type BenchmarkCandidateStatus = z.infer<typeof BenchmarkCandidateStatusSchema>;

/** 单次 run（lane × scenario）的固定候选数量 */
export const BENCHMARK_CANDIDATES_PER_RUN = 4;

export const BenchmarkHardFailureSchema = z.enum([
  'product_identity_changed',
  'part_missing',
  'part_added',
  'topology_broken',
  'attachment_wrong',
  'quantity_changed',
  'proportion_wrong',
  'text_logo_pattern_corrupted',
  'impossible_human_contact',
  'severe_generation_artifact',
  'unreasonable_gravity',
]);
export type BenchmarkHardFailure = z.infer<typeof BenchmarkHardFailureSchema>;

export const ReferenceCropSchema = z.object({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(240),
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().gt(0).max(1),
  height: z.number().gt(0).max(1),
});
export type ReferenceCrop = z.infer<typeof ReferenceCropSchema>;

export const ReferencePackPlanSchema = z.object({
  summary: z.string().trim().min(1).max(240),
  crops: z.array(ReferenceCropSchema).max(3),
});
export type ReferencePackPlan = z.infer<typeof ReferencePackPlanSchema>;

export const BenchmarkJudgeResultSchema = z.object({
  candidateIndex: z.number().int().min(0).max(15),
  hardFailures: z.array(BenchmarkHardFailureSchema).max(10),
  notes: z.string().trim().min(1).max(500).nullable(),
});
export type BenchmarkJudgeResult = z.infer<typeof BenchmarkJudgeResultSchema>;

/* ── 聚合 run / summary 契约 ── */

export const BenchmarkRunStatusSchema = z.enum(['completed', 'unavailable', 'error']);
export type BenchmarkRunStatus = z.infer<typeof BenchmarkRunStatusSchema>;

export const BenchmarkCandidateRecordSchema = z.object({
  candidateIndex: z.number().int().min(0).max(15),
  status: z.enum(['pass', 'fail']),
  hardFailures: z.array(BenchmarkHardFailureSchema).max(10),
  notes: z.string().trim().min(1).max(500).nullable(),
  url: z.string().trim().min(1),
});
export type BenchmarkCandidateRecord = z.infer<typeof BenchmarkCandidateRecordSchema>;

export const BenchmarkRunRecordSchema = z.object({
  scenario: BenchmarkScenarioSchema,
  lane: BenchmarkLaneSchema,
  status: BenchmarkRunStatusSchema,
  /** unavailable/error 时的明确原因；completed 时为 null */
  statusReason: z.string().trim().min(1).max(500).nullable(),
  /** 当前 lane 配置下 edit regions 是否真实启用（不支持时必须为 false） */
  usedEditRegions: z.boolean(),
  /** 实际传给 provider 的额外参考图数量 */
  usedReferenceCount: z.number().int().min(0),
  passCount: z.number().int().min(0).max(BENCHMARK_CANDIDATES_PER_RUN),
  failCount: z.number().int().min(0).max(BENCHMARK_CANDIDATES_PER_RUN),
  candidates: z.array(BenchmarkCandidateRecordSchema).max(BENCHMARK_CANDIDATES_PER_RUN),
  hardFailureCounts: z.record(z.string(), z.number().int().min(0)),
});
export type BenchmarkRunRecord = z.infer<typeof BenchmarkRunRecordSchema>;

export const BenchmarkReferencePackRecordSchema = z.object({
  summary: z.string().trim().min(1).max(240),
  sourceUrl: z.string().trim().min(1),
  crops: z.array(ReferenceCropSchema.extend({ url: z.string().trim().min(1) })).max(3),
});
export type BenchmarkReferencePackRecord = z.infer<typeof BenchmarkReferencePackRecordSchema>;

export const BenchmarkFailureRankSchema = z.object({
  reason: BenchmarkHardFailureSchema,
  count: z.number().int().min(1),
});
export type BenchmarkFailureRank = z.infer<typeof BenchmarkFailureRankSchema>;

export const BenchmarkRunSummarySchema = z.object({
  runId: z.string().uuid(),
  createdAt: z.string(),
  referencePack: BenchmarkReferencePackRecordSchema,
  runs: z.array(BenchmarkRunRecordSchema),
  /** 总通过数最高的 lane（可能并列） */
  bestLanes: z.array(BenchmarkLaneSchema),
  /** 全局最常见的硬性失败原因排序 */
  topFailureReasons: z.array(BenchmarkFailureRankSchema).max(11),
  totalPass: z.number().int().min(0),
  totalFail: z.number().int().min(0),
});
export type BenchmarkRunSummary = z.infer<typeof BenchmarkRunSummarySchema>;

/* ── Lab 运行请求输入 ── */

export const BenchmarkRunRequestSchema = z.object({
  scenarios: z.array(BenchmarkScenarioSchema).min(1).max(3),
  lanes: z.array(BenchmarkLaneSchema).min(1).max(5),
  ratio: HeroRatioSchema.default('3:4'),
  note: z.string().trim().max(500).optional(),
  visionProfileId: z.string().uuid().nullable().optional(),
  /** lane → 指定生图配置；缺省时按 lane 驱动目标自动解析 */
  laneProfileIds: z.record(BenchmarkLaneSchema, z.string().uuid()).optional(),
});
export type BenchmarkRunRequest = z.infer<typeof BenchmarkRunRequestSchema>;

/* ── 纯函数规则 ── */

/** PASS = 没有任何硬性失败；否则 FAIL。不使用美学评分。 */
export function candidateStatusFor(hardFailures: BenchmarkHardFailure[]): BenchmarkCandidateStatus {
  return hardFailures.length === 0 ? 'pass' : 'fail';
}

/** 统计一组候选的硬性失败分布（按出现次数降序）。 */
export function countHardFailures(results: BenchmarkJudgeResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const failure of result.hardFailures) {
      counts[failure] = (counts[failure] ?? 0) + 1;
    }
  }
  return counts;
}

/** Judge 结果覆盖校验：candidateIndex 必须恰好覆盖 0..count-1 各一次。 */
export function validateJudgeCoverage(results: BenchmarkJudgeResult[], candidateCount: number): void {
  const seen = new Set<number>();
  for (const result of results) {
    if (result.candidateIndex < 0 || result.candidateIndex >= candidateCount) {
      throw new Error(`Judge 返回了越界的候选索引 ${result.candidateIndex}（候选共 ${candidateCount} 张）`);
    }
    if (seen.has(result.candidateIndex)) {
      throw new Error(`Judge 返回了重复的候选索引 ${result.candidateIndex}`);
    }
    seen.add(result.candidateIndex);
  }
  if (seen.size !== candidateCount) {
    throw new Error(`Judge 结果数量不完整：要求 ${candidateCount} 张，实际 ${seen.size} 张`);
  }
}
