import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeroBrief, HeroHardFailure } from '@/core/hero-workflow';
import type { HeroWorkflowInput } from './contracts';
import type { ExecutedHeroImage } from './executor';

const { executeMock, reviewMock } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  reviewMock: vi.fn(),
}));
vi.mock('./executor', () => ({ executeHeroWorkflow: (...args: unknown[]) => executeMock(...args) }));
vi.mock('./reviewer', async (original) => {
  const actual = await original<typeof import('./reviewer')>();
  return {
    ...actual,
    reviewHeroCandidates: (...args: unknown[]) => reviewMock(...args),
  };
});

import { runHeroWorkflow } from './index';
import { selectUsableInPreferredOrder, type HeroBatchReviewOutcome, type ReviewedHeroImage } from './reviewer';

let root = '';
let outDir = '';

const brief: HeroBrief = {
  title: '午后斜挎',
  productIdentity: {
    summary: '白色链条小方包',
    fixedTraits: ['白色包身', '金色五金', '翻盖结构'],
    movableParts: [],
  },
  presentation: {
    mode: 'scene-staging',
    reason: '桌面陈列',
    interaction: null,
    scene: '清晨木桌',
    camera: '50mm',
    lighting: '自然光',
    depthOfField: '轻浅景深',
    scaleCue: null,
  },
  forbiddenChanges: ['包身颜色改变', '五金变银色', '链条数量变化'],
};

const input: HeroWorkflowInput = {
  workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  workspaceName: '包',
  taskId: 'task-1',
  sourceImagePath: 'selected.png',
  sourcePreview: Buffer.from('preview'),
  sourceAssetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sourceAssetRole: 'front',
  ratio: '1:1',
  count: 2,
  humanPolicy: 'auto',
};

async function fakeImage(name: string, content: string): Promise<ExecutedHeroImage> {
  const localPath = path.join(outDir, name);
  await fs.writeFile(localPath, content);
  return { url: `https://cdn.example/${name}`, localPath, buffer: Buffer.from(content), extension: 'png' };
}

function batch(
  images: ExecutedHeroImage[],
  failures: Array<HeroHardFailure[]>,
  preferredOrder: number[],
  repairs: Array<string | null> = [],
): HeroBatchReviewOutcome {
  const reviewed: ReviewedHeroImage[] = images.map((image, index) => ({
    image,
    assessment: {
      candidateIndex: index,
      hardFailures: failures[index],
      softIssues: [],
      repairInstruction: repairs[index] ?? null,
    },
    usable: failures[index].length === 0,
  }));
  return { reviewed, preferredOrder };
}

beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-workflow-')); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(root, 'out-'));
});
afterEach(() => vi.clearAllMocks());

describe('runHeroWorkflow 编排（生成 → 批量 QA → 至多一次补生）', () => {
  it('全部可用时按偏好顺序重命名，不可用候选被清理', async () => {
    const good = await fakeImage('candidate-01.png', 'good-image');
    const bad = await fakeImage('candidate-02.png', 'bad-image');
    executeMock.mockResolvedValue([good, bad]);
    reviewMock.mockResolvedValue(batch([good, bad], [[], ['topology_broken']], [0, 1]));

    const outcome = await runHeroWorkflow({ ...input, count: 1 }, brief, outDir);

    expect(outcome.brief).toBe(brief);
    expect(outcome.candidates).toHaveLength(1);
    await expect(fs.readFile(path.join(outDir, 'result-01.png'), 'utf8')).resolves.toBe('good-image');
    await expect(fs.access(path.join(outDir, 'candidate-02.png'))).rejects.toThrow();
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(reviewMock).toHaveBeenCalledTimes(1);
  });

  it('可用足够时不补生', async () => {
    const images = await Promise.all([
      fakeImage('candidate-01.png', 'img-1'),
      fakeImage('candidate-02.png', 'img-2'),
    ]);
    executeMock.mockResolvedValue(images);
    reviewMock.mockResolvedValue(batch(images, [[], []], [0, 1]));
    const outcome = await runHeroWorkflow(input, brief, outDir);
    expect(outcome.candidates).toHaveLength(2);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it('缺 K 张时恰好补生一次 K 张，且补生 prompt 携带 QA 修复反馈', async () => {
    const first4 = await Promise.all([
      fakeImage('candidate-01.png', 'pass-1'),
      fakeImage('candidate-02.png', 'pass-2'),
      fakeImage('candidate-03.png', 'fail-1'),
      fakeImage('candidate-04.png', 'fail-2'),
    ]);
    const refill = await Promise.all([
      fakeImage('candidate-05.png', 'refill-1'),
      fakeImage('candidate-06.png', 'refill-2'),
    ]);
    executeMock
      .mockResolvedValueOnce(first4)
      .mockResolvedValueOnce(refill);
    reviewMock
      .mockResolvedValueOnce(batch(
        first4,
        [[], [], ['topology_broken'], ['attachment_wrong']],
        [0, 1, 3, 2],
        [null, null, '保持链条为一条连续链', '挂点复原'],
      ))
      .mockResolvedValueOnce(batch(refill, [[], []], [0, 1]));

    const outcome = await runHeroWorkflow({ ...input, count: 4 }, brief, outDir);

    expect(outcome.candidates).toHaveLength(4);
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock.mock.calls[1][3]).toMatchObject({ count: 2, startIndex: 4 });
    expect(executeMock.mock.calls[1][3].repairInstruction).toContain('保持链条为一条连续链');
    expect(executeMock.mock.calls[1][3].repairInstruction).toContain('挂点复原');
    expect(reviewMock).toHaveBeenCalledTimes(2);
  });

  it('一次补生后仍不足则失败并给出通过数量', async () => {
    const first2 = await Promise.all([
      fakeImage('candidate-01.png', 'pass-1'),
      fakeImage('candidate-02.png', 'fail-1'),
    ]);
    const refill = [await fakeImage('candidate-03.png', 'refill-fail')];
    executeMock.mockResolvedValueOnce(first2).mockResolvedValueOnce(refill);
    reviewMock
      .mockResolvedValueOnce(batch(first2, [[], ['topology_broken']], [0, 1], [null, '修复链条']))
      .mockResolvedValueOnce(batch(refill, [['part_missing']], [0]));
    await expect(runHeroWorkflow(input, brief, outDir)).rejects.toThrow(/1\/2/);
    // 失败时所有候选被清理
    await expect(fs.access(path.join(outDir, 'candidate-01.png'))).rejects.toThrow();
  });

  it('只允许一轮补生（不迭代重试）', async () => {
    const first = [await fakeImage('candidate-01.png', 'fail-1')];
    const refill = [await fakeImage('candidate-02.png', 'fail-2')];
    executeMock.mockResolvedValueOnce(first).mockResolvedValueOnce(refill);
    reviewMock
      .mockResolvedValueOnce(batch(first, [['topology_broken']], [0]))
      .mockResolvedValueOnce(batch(refill, [['topology_broken']], [0]));
    await expect(runHeroWorkflow({ ...input, count: 1 }, brief, outDir)).rejects.toThrow(/0\/1/);
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(reviewMock).toHaveBeenCalledTimes(2);
  });

  it('按偏好顺序交付恰好 N 张（多余可用候选被清理）', async () => {
    const images = await Promise.all([
      fakeImage('candidate-01.png', 'img-1'),
      fakeImage('candidate-02.png', 'img-2'),
      fakeImage('candidate-03.png', 'img-3'),
    ]);
    executeMock.mockResolvedValue(images);
    reviewMock.mockResolvedValue(batch(images, [[], [], []], [2, 0, 1]));
    const outcome = await runHeroWorkflow({ ...input, count: 2 }, brief, outDir);
    expect(outcome.candidates).toHaveLength(2);
    await expect(fs.readFile(path.join(outDir, 'result-01.png'), 'utf8')).resolves.toBe('img-3');
    await expect(fs.access(path.join(outDir, 'candidate-02.png'))).rejects.toThrow();
  });
});

describe('偏好顺序选择边界', () => {
  it('偏好顺序未包含的可用候选仍被补在末尾', async () => {
    const images = await Promise.all([
      fakeImage('candidate-01.png', 'a'),
      fakeImage('candidate-02.png', 'b'),
    ]);
    const outcome = batch(images, [[], []], [1]);
    const selected = selectUsableInPreferredOrder(outcome);
    expect(selected).toHaveLength(2);
    expect(selected[0].image).toBe(images[1]);
    expect(selected[1].image).toBe(images[0]);
  });
});
