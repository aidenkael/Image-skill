import { describe, expect, it } from 'vitest';
import {
  BenchmarkJudgeResultSchema,
  BenchmarkLaneSchema,
  BenchmarkScenarioSchema,
  ReferencePackPlanSchema,
  candidateStatusFor,
  countHardFailures,
  validateJudgeCoverage,
} from './benchmark-lab';

describe('Benchmark Lab 领域契约', () => {
  it('场景枚举恰好是三个跨品类场景', () => {
    expect(BenchmarkScenarioSchema.options).toEqual([
      'human-carry', 'tabletop-placement', 'hanging-display',
    ]);
    expect(BenchmarkScenarioSchema.safeParse('bag-category').success).toBe(false);
  });

  it('lane 枚举恰好是五条执行路线', () => {
    expect(BenchmarkLaneSchema.options).toEqual([
      'qwen-single-extend-on', 'qwen-single-extend-off', 'qwen-multi-ref', 'seedream-multi-ref', 'wan-multi-ref',
    ]);
    expect(BenchmarkLaneSchema.safeParse('comfyui-route').success).toBe(false);
  });

  it('ReferencePackPlan 接受 0..3 个裁剪并拒绝越界框', () => {
    const valid = ReferencePackPlanSchema.safeParse({
      summary: '链条与五金是最易被破坏的身份细节',
      crops: [
        { key: 'chain', label: '链条', reason: 'AI 常拆分链条', x: 0.1, y: 0.2, width: 0.3, height: 0.25 },
      ],
    });
    expect(valid.success).toBe(true);

    const empty = ReferencePackPlanSchema.safeParse({ summary: '无高风险区域', crops: [] });
    expect(empty.success).toBe(true);

    const tooMany = ReferencePackPlanSchema.safeParse({
      summary: 'x',
      crops: Array.from({ length: 4 }, (_, i) => ({
        key: `k${i}`, label: 'l', reason: 'r', x: 0.1, y: 0.1, width: 0.2, height: 0.2,
      })),
    });
    expect(tooMany.success).toBe(false);

    const outOfBounds = ReferencePackPlanSchema.safeParse({
      summary: 'x',
      crops: [{ key: 'k', label: 'l', reason: 'r', x: 0.9, y: 0.1, width: 1.2, height: 0.2 }],
    });
    expect(outOfBounds.success).toBe(false);
  });

  it('Judge 结果 schema 支持空硬性失败与可空 notes', () => {
    expect(BenchmarkJudgeResultSchema.parse({ candidateIndex: 0, hardFailures: [], notes: null }))
      .toEqual({ candidateIndex: 0, hardFailures: [], notes: null });
    const failed = BenchmarkJudgeResultSchema.parse({
      candidateIndex: 3, hardFailures: ['topology_broken', 'part_added'], notes: '链条被拆分',
    });
    expect(failed.hardFailures).toHaveLength(2);
  });

  it('PASS 当且仅当没有任何硬性失败', () => {
    expect(candidateStatusFor([])).toBe('pass');
    expect(candidateStatusFor(['topology_broken'])).toBe('fail');
    expect(candidateStatusFor(['part_added'])).toBe('fail');
    expect(candidateStatusFor(['unreasonable_gravity'])).toBe('fail');
  });

  it('硬性失败统计按出现次数汇总', () => {
    const counts = countHardFailures([
      { candidateIndex: 0, hardFailures: ['topology_broken'], notes: null },
      { candidateIndex: 1, hardFailures: ['topology_broken', 'part_added'], notes: null },
      { candidateIndex: 2, hardFailures: [], notes: null },
    ]);
    expect(counts).toEqual({ topology_broken: 2, part_added: 1 });
  });

  it('Judge 覆盖校验拒绝缺失与重复索引', () => {
    const complete = [0, 1, 2, 3].map((candidateIndex) => ({ candidateIndex, hardFailures: [], notes: null }));
    expect(() => validateJudgeCoverage(complete, 4)).not.toThrow();
    expect(() => validateJudgeCoverage(complete.slice(0, 3), 4)).toThrow(/不完整/);
    expect(() => validateJudgeCoverage([...complete.slice(1), complete[1]], 4)).toThrow(/重复/);
    expect(() => validateJudgeCoverage(
      [...complete.slice(0, 3), { candidateIndex: 7, hardFailures: [], notes: null }], 4,
    )).toThrow(/越界/);
  });
});
