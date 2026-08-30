import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HeroBatchReview, HeroBrief, HeroHardFailure } from '@/core/hero-workflow';
import type { HeroWorkflowInput } from './contracts';
import type { ExecutedHeroImage } from './executor';

const { reviewHeroBatchMock, previewMock } = vi.hoisted(() => ({
  reviewHeroBatchMock: vi.fn(),
  previewMock: vi.fn(),
}));
vi.mock('@/server/providers/factory', () => ({
  createActiveVisionProvider: async () => ({ reviewHeroBatch: (...args: unknown[]) => reviewHeroBatchMock(...args) }),
}));
vi.mock('@/server/image/sharp', async (original) => ({
  ...await original<typeof import('@/server/image/sharp')>(),
  makeVisionPreview: (...args: unknown[]) => previewMock(...args),
}));

import {
  collectRepairFeedback,
  reviewHeroCandidates,
  selectUsableInPreferredOrder,
  validateHeroBatchReview,
  type ReviewedHeroImage,
} from './reviewer';

const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let root = '';

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
  sourcePreview: Buffer.from('source-preview'),
  sourceAssetId: ASSET_ID,
  sourceAssetRole: 'front',
  ratio: '1:1',
  count: 2,
  humanPolicy: 'auto',
};

function image(name: string): ExecutedHeroImage {
  return { url: `https://cdn.example/${name}`, localPath: path.join(root, name), buffer: Buffer.from(name), extension: 'png' };
}

function review(assessments: HeroBatchReview['assessments'], preferredOrder: number[]): HeroBatchReview {
  return { assessments, preferredOrder };
}

const assessment = (candidateIndex: number, hard: HeroHardFailure[] = [], repairInstruction: string | null = null) => ({
  candidateIndex, hardFailures: hard, softIssues: [], repairInstruction,
});

beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-reviewer-')); process.env.RUNTIME_DIR = path.join(root, '.runtime'); });
afterAll(async () => { delete process.env.RUNTIME_DIR; await fs.rm(root, { recursive: true, force: true }); });
afterEach(() => vi.clearAllMocks());

describe('validateHeroBatchReview（确定性校验）', () => {
  it('每个候选恰好一条评估且索引全覆盖', () => {
    expect(() => validateHeroBatchReview(review([assessment(0), assessment(1)], [0, 1]), 2)).not.toThrow();
  });

  it('重复或缺失候选索引被拒绝', () => {
    expect(() => validateHeroBatchReview(review([assessment(0), assessment(0)], [0]), 2)).toThrow(/重复候选索引/);
    expect(() => validateHeroBatchReview(review([assessment(0)], [0]), 2)).toThrow(/数量不匹配/);
  });

  it('越界候选索引被拒绝', () => {
    expect(() => validateHeroBatchReview(review([assessment(0), assessment(5)], [0]), 2)).toThrow(/非法候选索引/);
  });

  it('preferredOrder 非法或重复索引被拒绝', () => {
    expect(() => validateHeroBatchReview(review([assessment(0), assessment(1)], [0, 0]), 2)).toThrow(/偏好顺序存在重复/);
    expect(() => validateHeroBatchReview(review([assessment(0), assessment(1)], [0, 9]), 2)).toThrow(/偏好顺序包含非法/);
  });
});

describe('reviewHeroCandidates（批量质检）', () => {
  it('一次 Vision 调用收到源图与全部候选图', async () => {
    previewMock.mockResolvedValue(Buffer.from('preview'));
    reviewHeroBatchMock.mockResolvedValue(review([assessment(0), assessment(1)], [0, 1]));
    const outcome = await reviewHeroCandidates(input, brief, [image('c1.png'), image('c2.png')]);
    expect(reviewHeroBatchMock).toHaveBeenCalledTimes(1);
    const arg = reviewHeroBatchMock.mock.calls[0][0];
    expect(arg.source).toMatchObject({ assetId: ASSET_ID });
    expect(arg.generated).toHaveLength(2);
    expect(arg.brief).toBe(brief);
    expect(arg.humanPolicy).toBe('auto');
    expect(outcome.reviewed).toHaveLength(2);
  });

  it('topology_broken / attachment_wrong 判定为不可用', async () => {
    previewMock.mockResolvedValue(Buffer.from('preview'));
    reviewHeroBatchMock.mockResolvedValue(review([
      assessment(0, ['topology_broken'], '保持链条连续'),
      assessment(1, ['attachment_wrong'], '挂点复原'),
    ], [1, 0]));
    const outcome = await reviewHeroCandidates(input, brief, [image('c1.png'), image('c2.png')]);
    expect(outcome.reviewed.every((item) => !item.usable)).toBe(true);
  });

  it('仅 excessive_bokeh 仍可用（软性问题不拒绝）', async () => {
    previewMock.mockResolvedValue(Buffer.from('preview'));
    reviewHeroBatchMock.mockResolvedValue(review([
      { candidateIndex: 0, hardFailures: [], softIssues: ['excessive_bokeh'], repairInstruction: null },
    ], [0]));
    const outcome = await reviewHeroCandidates(input, brief, [image('c1.png')]);
    expect(outcome.reviewed[0].usable).toBe(true);
  });

  it('重复/缺失候选索引的评审响应被拒绝', async () => {
    previewMock.mockResolvedValue(Buffer.from('preview'));
    reviewHeroBatchMock.mockResolvedValue(review([assessment(0), assessment(0)], [0]));
    await expect(reviewHeroCandidates(input, brief, [image('c1.png'), image('c2.png')]))
      .rejects.toThrow(/重复候选索引/);
  });

  it('review provider 异常向上抛出', async () => {
    previewMock.mockResolvedValue(Buffer.from('preview'));
    reviewHeroBatchMock.mockRejectedValue(new Error('review failed'));
    await expect(reviewHeroCandidates(input, brief, [image('c1.png')])).rejects.toThrow('review failed');
  });
});

describe('可用选择与修复反馈', () => {
  it('按偏好顺序选择可用候选，软性问题仅降序', () => {
    const reviewed: ReviewedHeroImage[] = [
      { image: image('c1.png'), assessment: assessment(0), usable: true },
      { image: image('c2.png'), assessment: { ...assessment(1), softIssues: ['excessive_bokeh'] }, usable: true },
      { image: image('c3.png'), assessment: assessment(2, ['topology_broken']), usable: false },
    ];
    const selected = selectUsableInPreferredOrder({ reviewed, preferredOrder: [1, 0, 2] });
    expect(selected.map((item) => item.image.localPath)).toEqual([reviewed[1].image.localPath, reviewed[0].image.localPath]);
  });

  it('合并被拒候选的修复指令并去重', () => {
    const reviewed = [
      { image: image('c1.png'), assessment: assessment(0), usable: true },
      { image: image('c2.png'), assessment: assessment(1, ['topology_broken'], '保持链条为一条连续链'), usable: false },
      { image: image('c3.png'), assessment: assessment(2, ['attachment_wrong'], '保持链条为一条连续链'), usable: false },
      { image: image('c4.png'), assessment: assessment(3, ['quantity_changed'], null), usable: false },
    ];
    expect(collectRepairFeedback(reviewed)).toBe('保持链条为一条连续链');
  });

  it('全部可用时修复反馈为 undefined', () => {
    const reviewed = [{ image: image('c1.png'), assessment: assessment(0), usable: true }];
    expect(collectRepairFeedback(reviewed)).toBeUndefined();
  });
});
