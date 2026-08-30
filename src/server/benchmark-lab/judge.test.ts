import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { BenchmarkJudgeResult } from '@/core/benchmark-lab';
import type { BenchmarkJudgeInput, VisionProvider } from '@/server/providers/vision-provider';
import { judgeBenchmarkRun } from './judge';

let root = '';
let sourcePath = '';
let cropPath = '';
const candidatePaths: string[] = [];

function fakeVision(results: BenchmarkJudgeResult[]) {
  return {
    judgeBenchmarkCandidates: vi.fn(async (_input: BenchmarkJudgeInput) => results),
    planBenchmarkReferencePack: vi.fn(async () => { throw new Error('测试中不应调用规划'); }),
    analyze: vi.fn(async () => { throw new Error('测试中不应调用分析'); }) as VisionProvider['analyze'],
    directHero: vi.fn(async () => { throw new Error('测试中不应调用 Director'); }) as VisionProvider['directHero'],
    reviewHeroBatch: vi.fn(async () => { throw new Error('测试中不应调用批量审片'); }) as VisionProvider['reviewHeroBatch'],
  };
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'benchmark-judge-'));
  const makeImage = (name: string, color: { r: number; g: number; b: number }) =>
    sharp({ create: { width: 64, height: 80, channels: 3, background: color } }).png().toFile(path.join(root, name));
  await makeImage('source.png', { r: 200, g: 40, b: 40 });
  await makeImage('crop.png', { r: 40, g: 200, b: 40 });
  for (let index = 0; index < 4; index += 1) {
    await makeImage(`candidate-${index + 1}.png`, { r: 40, g: 40, b: 40 + index * 40 });
  }
  sourcePath = path.join(root, 'source.png');
  cropPath = path.join(root, 'crop.png');
  for (let index = 0; index < 4; index += 1) candidatePaths.push(path.join(root, `candidate-${index + 1}.png`));
});
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

function judgeWith(results: BenchmarkJudgeResult[]) {
  return judgeBenchmarkRun({
    visionProvider: fakeVision(results),
    runId: 'run-judge',
    scenario: 'tabletop-placement',
    sourceImagePath: sourcePath,
    cropPaths: [cropPath],
    candidatePaths,
  });
}

describe('Benchmark Judge（确定性 PASS/FAIL）', () => {
  it('hardFailures=[] => PASS', async () => {
    const results = await judgeWith([0, 1, 2, 3].map((candidateIndex) => ({ candidateIndex, hardFailures: [], notes: null })));
    expect(results.every((item) => item.status === 'pass')).toBe(true);
  });

  it('topology_broken / part_added / unreasonable_gravity 均 => FAIL', async () => {
    const results = await judgeWith([
      { candidateIndex: 0, hardFailures: ['topology_broken'], notes: '链条被拆分' },
      { candidateIndex: 1, hardFailures: ['part_added'], notes: '多出一条肩带' },
      { candidateIndex: 2, hardFailures: ['unreasonable_gravity'], notes: '链条悬浮' },
      { candidateIndex: 3, hardFailures: [], notes: null },
    ]);
    expect(results.map((item) => item.status)).toEqual(['fail', 'fail', 'fail', 'pass']);
    expect(results[0].hardFailures).toEqual(['topology_broken']);
  });

  it('Vision 输入包含源图、裁剪与全部候选', async () => {
    const vision = fakeVision([0, 1, 2, 3].map((candidateIndex) => ({ candidateIndex, hardFailures: [], notes: null })));
    await judgeBenchmarkRun({
      visionProvider: vision,
      runId: 'run-judge-2',
      scenario: 'human-carry',
      sourceImagePath: sourcePath,
      cropPaths: [cropPath],
      candidatePaths,
    });
    expect(vision.judgeBenchmarkCandidates).toHaveBeenCalledTimes(1);
    const input = vision.judgeBenchmarkCandidates.mock.calls[0][0];
    expect(input.candidateBuffers).toHaveLength(4);
    expect(input.cropBuffers).toHaveLength(1);
    expect(input.scenario).toBe('human-carry');
  });

  it('缺失候选索引的判定被拒绝', async () => {
    await expect(judgeWith([
      { candidateIndex: 0, hardFailures: [], notes: null },
      { candidateIndex: 1, hardFailures: [], notes: null },
      { candidateIndex: 2, hardFailures: [], notes: null },
    ])).rejects.toThrow(/不完整/);
  });

  it('重复候选索引的判定被拒绝', async () => {
    await expect(judgeWith([
      { candidateIndex: 0, hardFailures: [], notes: null },
      { candidateIndex: 1, hardFailures: [], notes: null },
      { candidateIndex: 1, hardFailures: [], notes: null },
      { candidateIndex: 3, hardFailures: [], notes: null },
    ])).rejects.toThrow(/重复/);
  });
});
