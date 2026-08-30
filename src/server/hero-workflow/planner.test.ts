import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HeroPlanV2 } from '@/core/hero-workflow';
import type { ProductIntelligenceRecord } from '@/core/intelligence';
import type { HeroWorkflowInput } from './contracts';

const { planHeroV2Mock } = vi.hoisted(() => ({ planHeroV2Mock: vi.fn() }));
vi.mock('@/server/providers/factory', () => ({
  createActiveVisionProvider: async () => ({ planHeroV2: (...args: unknown[]) => planHeroV2Mock(...args) }),
}));

import { planHeroWorkflow, productUnderstandingForSource } from './planner';

const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let root = '';

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

const asset = { id: ASSET_ID, name: 'cup.png', mimeType: 'image/png' as const, width: 100, height: 100, role: 'front' as const, createdAt: '2026-08-25T00:00:00.000Z' };
const intelligence: ProductIntelligenceRecord = {
  analysis: { category: '杯子', visualSummary: '白色杯身', visibleFacts: [], visibleText: [], unverifiedFacts: [], assetObservations: [] },
  plan: { heroConcepts: [], collage: { titleOptions: [], sellingPoints: [] } },
  schemaVersion: 3,
  analyzedAt: '2026-08-25T00:00:00.000Z',
  assetSnapshot: [{ id: ASSET_ID, role: 'front' }],
};

function input(overrides: Partial<HeroWorkflowInput> = {}): HeroWorkflowInput {
  return {
    workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    workspaceName: '杯子',
    taskId: 'task-1',
    sourceImagePath: 'selected.png',
    sourcePreview: Buffer.from('preview'),
    sourceAssetId: ASSET_ID,
    sourceAssetRole: 'front',
    ratio: '1:1',
    count: 1,
    humanPolicy: 'auto',
    creativeLevel: 'balanced',
    ...overrides,
  };
}

beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-planner-')); process.env.RUNTIME_DIR = path.join(root, '.runtime'); });
afterAll(async () => { delete process.env.RUNTIME_DIR; await fs.rm(root, { recursive: true, force: true }); });
afterEach(() => vi.clearAllMocks());

describe('productUnderstandingForSource', () => {
  it('新鲜且覆盖源图的分析可复用商品理解', () => {
    expect(productUnderstandingForSource(intelligence, [asset], ASSET_ID)).toBe('白色杯身');
  });

  it('无分析、素材变化或未覆盖源图时不复用', () => {
    expect(productUnderstandingForSource(null, [asset], ASSET_ID)).toBeUndefined();
    expect(productUnderstandingForSource(
      { ...intelligence, assetSnapshot: [{ id: ASSET_ID, role: 'detail' }] },
      [asset],
      ASSET_ID,
    )).toBeUndefined();
    expect(productUnderstandingForSource(intelligence, [asset], OTHER_ID)).toBeUndefined();
  });
});

describe('planHeroWorkflow', () => {
  it('planner 产出 HeroPlanV2 并注入人物偏好与创意程度', async () => {
    planHeroV2Mock.mockResolvedValue(plan);
    const result = await planHeroWorkflow(
      input({ humanPolicy: 'require', creativeLevel: 'creative', creativeIntent: '雨夜归家' }),
      { intelligence: null, assets: [asset] },
    );
    expect(result).toEqual(plan);
    expect(planHeroV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      humanPolicy: 'require',
      creativeLevel: 'creative',
      creativeIntent: '雨夜归家',
      productUnderstanding: undefined,
      asset: expect.objectContaining({ assetId: ASSET_ID, mimeType: 'image/jpeg' }),
    }));
  });

  it('存在覆盖源图的新鲜分析时把商品理解注入策划（不重复做大分析）', async () => {
    planHeroV2Mock.mockResolvedValue(plan);
    await planHeroWorkflow(input(), { intelligence, assets: [asset] });
    expect(planHeroV2Mock).toHaveBeenCalledWith(expect.objectContaining({ productUnderstanding: '白色杯身' }));
  });

  it('策划失败原样抛出，不会吞错', async () => {
    planHeroV2Mock.mockRejectedValue(new Error('planning failed'));
    await expect(planHeroWorkflow(input(), { intelligence: null, assets: [asset] }))
      .rejects.toThrow('planning failed');
  });
});
