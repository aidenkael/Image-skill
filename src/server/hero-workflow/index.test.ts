import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeroPlanV2, HeroReview } from '@/core/hero-workflow';
import type { HeroWorkflowContext, HeroWorkflowInput } from './contracts';
import type { ExecutedHeroImage } from './executor';
import type { ReviewedHeroImage } from './reviewer';

const { planMock, executeMock, reviewMock } = vi.hoisted(() => ({
  planMock: vi.fn(),
  executeMock: vi.fn(),
  reviewMock: vi.fn(),
}));
vi.mock('./planner', () => ({ planHeroWorkflow: (...args: unknown[]) => planMock(...args) }));
vi.mock('./executor', () => ({ executeHeroWorkflow: (...args: unknown[]) => executeMock(...args) }));
vi.mock('./reviewer', () => ({ reviewHeroCandidates: (...args: unknown[]) => reviewMock(...args) }));

import { runHeroWorkflow } from './index';

let root = '';
let outDir = '';

const plan: HeroPlanV2 = {
  title: '晨光桌面',
  displayMode: 'scene-staging',
  humanPolicy: 'auto',
  coreSellingAngle: '日常陪伴感',
  preserve: ['白色杯身', '单件', '陶瓷质感'],
  flexible: ['光线氛围'],
  scene: '清晨木桌',
  composition: '居中微俯',
  lighting: '柔和自然光',
  riskChecks: ['杯柄结构', '数量变化'],
  prompt: 'A warm morning tabletop hero.',
};

const input: HeroWorkflowInput = {
  workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  workspaceName: '杯子',
  taskId: 'task-1',
  sourceImagePath: 'selected.png',
  sourcePreview: Buffer.from('preview'),
  sourceAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sourceAssetRole: 'front',
  ratio: '1:1',
  count: 2,
  humanPolicy: 'auto',
  creativeLevel: 'balanced',
};

const context: HeroWorkflowContext = { intelligence: null, assets: [] };

function review(score: number, passed = score >= 70): HeroReview {
  return { passed, score, issues: passed ? [] : ['商品结构错误'], summary: passed ? '结构一致' : '结构失真' };
}

async function fakeImage(name: string, content: string): Promise<ExecutedHeroImage> {
  const localPath = path.join(outDir, name);
  await fs.writeFile(localPath, content);
  return { url: `https://cdn.example/${name}`, localPath, buffer: Buffer.from(content), extension: 'png' };
}

beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-workflow-')); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(root, 'out-'));
});
afterEach(() => vi.clearAllMocks());

describe('runHeroWorkflow 编排', () => {
  it('通过结果按 score 降序重命名，未通过结果被清理', async () => {
    const low = await fakeImage('candidate-01.png', 'low-score-image');
    const high = await fakeImage('candidate-02.png', 'high-score-image');
    const failed = await fakeImage('candidate-03.png', 'failed-image');
    planMock.mockResolvedValue(plan);
    executeMock.mockResolvedValue([low, high, failed]);
    const reviewed: ReviewedHeroImage[] = [
      { image: low, review: review(72), passed: true },
      { image: high, review: review(91), passed: true },
      { image: failed, review: review(40, false), passed: false },
    ];
    reviewMock.mockResolvedValue(reviewed);

    const outcome = await runHeroWorkflow(input, context, outDir);

    expect(outcome.plan).toBe(plan);
    expect(outcome.candidates.map((item) => item.review.score)).toEqual([91, 72]);
    await expect(fs.readFile(path.join(outDir, 'result-01.png'), 'utf8')).resolves.toBe('high-score-image');
    await expect(fs.readFile(path.join(outDir, 'result-02.png'), 'utf8')).resolves.toBe('low-score-image');
    await expect(fs.access(path.join(outDir, 'candidate-03.png'))).rejects.toThrow();
  });

  it('所有输出都不通过审片时整体失败并给出简明中文错误', async () => {
    const only = await fakeImage('candidate-01.png', 'failed-image');
    planMock.mockResolvedValue(plan);
    executeMock.mockResolvedValue([only]);
    reviewMock.mockResolvedValue([{ image: only, review: review(35, false), passed: false }]);

    await expect(runHeroWorkflow(input, context, outDir)).rejects.toThrow(/氛围主图未通过审片/);
  });
});
