import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HeroPlanV2, HeroReview } from '@/core/hero-workflow';
import type { HeroWorkflowInput } from './contracts';
import type { ExecutedHeroImage } from './executor';

const { reviewHeroMock, previewMock } = vi.hoisted(() => ({
  reviewHeroMock: vi.fn(),
  previewMock: vi.fn(),
}));
vi.mock('@/server/providers/factory', () => ({
  createActiveVisionProvider: async () => ({ reviewHero: (...args: unknown[]) => reviewHeroMock(...args) }),
}));
vi.mock('@/server/image/sharp', async (original) => ({
  ...await original<typeof import('@/server/image/sharp')>(),
  makeVisionPreview: (...args: unknown[]) => previewMock(...args),
}));

import { isHeroReviewPassed, reviewHeroCandidates } from './reviewer';

const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let root = '';

function plan(displayMode: HeroPlanV2['displayMode']): HeroPlanV2 {
  return {
    title: '晨光桌面',
    displayMode,
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
}

const input: HeroWorkflowInput = {
  workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  workspaceName: '杯子',
  taskId: 'task-1',
  sourceImagePath: 'selected.png',
  sourcePreview: Buffer.from('source-preview'),
  sourceAssetId: ASSET_ID,
  sourceAssetRole: 'front',
  ratio: '1:1',
  count: 1,
  humanPolicy: 'auto',
  creativeLevel: 'balanced',
};

function image(localPath: string): ExecutedHeroImage {
  return { url: 'https://cdn.example/1.png', localPath, buffer: Buffer.from('generated'), extension: 'png' };
}

const reviewPass: HeroReview = { passed: true, score: 82, issues: [], summary: '结构一致' };

beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-reviewer-')); process.env.RUNTIME_DIR = path.join(root, '.runtime'); });
afterAll(async () => { delete process.env.RUNTIME_DIR; await fs.rm(root, { recursive: true, force: true }); });
afterEach(() => vi.clearAllMocks());

describe('isHeroReviewPassed', () => {
  it('score 达标且无严重问题时通过', () => {
    expect(isHeroReviewPassed(reviewPass)).toBe(true);
  });

  it('严重结构/身份错误（reviewer 标记不通过）或分数不足时不通过', () => {
    expect(isHeroReviewPassed({ ...reviewPass, passed: false, score: 90 })).toBe(false);
    expect(isHeroReviewPassed({ ...reviewPass, score: 69 })).toBe(false);
  });
});

describe('reviewHeroCandidates', () => {
  it('逐张提交原图与生成图，输入包含 preserve / flexible / displayMode / humanPolicy', async () => {
    previewMock.mockResolvedValue(Buffer.from('generated-preview'));
    reviewHeroMock.mockResolvedValue(reviewPass);
    const reviewed = await reviewHeroCandidates(input, plan('scene-staging'), [image('candidate-01.png')]);
    expect(reviewed[0]).toMatchObject({ passed: true, review: reviewPass });
    expect(reviewHeroMock).toHaveBeenCalledWith(expect.objectContaining({
      displayMode: 'scene-staging',
      humanPolicy: 'auto',
      preserve: ['白色杯身', '单件', '陶瓷质感'],
      flexible: ['光线氛围'],
      source: expect.objectContaining({ assetId: ASSET_ID }),
      generated: expect.objectContaining({ assetId: ASSET_ID }),
    }));
    expect(previewMock).toHaveBeenCalledTimes(1);
  });

  it('human-interaction 审查携带人物互动展示方式，供 provider 检查人与商品关系', async () => {
    previewMock.mockResolvedValue(Buffer.from('generated-preview'));
    reviewHeroMock.mockResolvedValue(reviewPass);
    await reviewHeroCandidates(input, plan('human-interaction'), [image('candidate-01.png')]);
    expect(reviewHeroMock).toHaveBeenCalledWith(expect.objectContaining({ displayMode: 'human-interaction' }));
  });

  it('严重结构错误时标记不通过', async () => {
    previewMock.mockResolvedValue(Buffer.from('generated-preview'));
    reviewHeroMock.mockResolvedValue({ passed: false, score: 30, issues: ['商品结构错误'], summary: '结构失真' });
    const reviewed = await reviewHeroCandidates(input, plan('scene-staging'), [image('candidate-01.png')]);
    expect(reviewed[0].passed).toBe(false);
  });

  it('review provider 异常时向上抛出，不静默吞掉', async () => {
    previewMock.mockResolvedValue(Buffer.from('generated-preview'));
    reviewHeroMock.mockRejectedValue(new Error('review failed'));
    await expect(reviewHeroCandidates(input, plan('scene-staging'), [image('candidate-01.png')]))
      .rejects.toThrow('review failed');
  });
});
