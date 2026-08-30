import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HeroPlanV2, HeroReview } from '@/core/hero-workflow';
import type { CreateTaskRequest } from '@/core/tasks';
import type { ProductIntelligenceRecord } from '@/core/intelligence';

/**
 * Hero 任务集成测试：任务入口只负责编排，
 * 策划 / 执行 / 审片经由 src/server/hero-workflow 的 provider 边界完成。
 */

const { generateMock, planHeroV2Mock, reviewHeroMock, assetFileMock, listAssetsMock, intelligenceMock, workspaceMock, previewMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  planHeroV2Mock: vi.fn(),
  reviewHeroMock: vi.fn(),
  assetFileMock: vi.fn(),
  listAssetsMock: vi.fn(),
  intelligenceMock: vi.fn(),
  workspaceMock: vi.fn(),
  previewMock: vi.fn(),
}));
vi.mock('@/server/assets/service', () => ({ assetFile: assetFileMock, listAssets: listAssetsMock }));
vi.mock('@/server/intelligence/service', () => ({ getWorkspaceIntelligence: intelligenceMock }));
vi.mock('@/server/providers/factory', () => ({
  createActiveImageProvider: async () => ({ generate: (...args: unknown[]) => generateMock(...args) }),
  createActiveVisionProvider: async () => ({
    planHeroV2: (...args: unknown[]) => planHeroV2Mock(...args),
    reviewHero: (...args: unknown[]) => reviewHeroMock(...args),
  }),
}));
vi.mock('@/server/image/sharp', async (original) => ({
  ...await original<typeof import('@/server/image/sharp')>(),
  makeVisionPreview: (...args: unknown[]) => previewMock(...args),
}));
vi.mock('@/server/workspaces/service', () => ({ getWorkspace: workspaceMock }));

import { runHeroTask } from './hero';

const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let root = '';
let pngBuffer: Buffer;

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

const reviewPass: HeroReview = { passed: true, score: 82, issues: [], summary: '结构一致，适合电商主图' };
const reviewFail: HeroReview = { passed: false, score: 35, issues: ['杯柄结构错误'], summary: '商品结构失真' };

const asset = { id: ASSET_ID, name: 'cup.png', mimeType: 'image/png' as const, width: 100, height: 100, role: 'front' as const, createdAt: '2026-08-25T00:00:00.000Z' };
const intelligence: ProductIntelligenceRecord = {
  analysis: { category: '杯子', visualSummary: '白色杯身', visibleFacts: [], visibleText: [], unverifiedFacts: [], assetObservations: [] },
  plan: { heroConcepts: [], collage: { titleOptions: [], sellingPoints: [] } },
  schemaVersion: 3,
  analyzedAt: '2026-08-25T00:00:00.000Z',
  assetSnapshot: [{ id: ASSET_ID, role: 'front' }],
};

function request(count = 1, options: Record<string, unknown> = {}): CreateTaskRequest {
  return {
    kind: 'hero',
    assetIds: [ASSET_ID],
    count,
    options: {
      sourceAssetId: ASSET_ID,
      ratio: '1:1',
      creativeMode: 'recommended',
      humanPresence: 'auto',
      creativeLevel: 'balanced',
      ...options,
    },
  } as CreateTaskRequest;
}

function stubSuccessPipeline(reviews: HeroReview[] = [reviewPass]) {
  workspaceMock.mockResolvedValue({ name: '杯子' });
  listAssetsMock.mockResolvedValue([asset]);
  intelligenceMock.mockResolvedValue(null);
  previewMock.mockResolvedValue(Buffer.from('preview'));
  planHeroV2Mock.mockResolvedValue(plan);
  generateMock.mockResolvedValue(reviews.map((_item, index) => ({ url: `https://cdn.example/${index + 1}.png` })));
  reviewHeroMock.mockReset();
  for (const review of reviews) reviewHeroMock.mockResolvedValueOnce(review);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(pngBuffer), { status: 200 })));
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-task-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
  pngBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00ff00' } }).png().toBuffer();
});
afterAll(async () => { delete process.env.RUNTIME_DIR; await fs.rm(root, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Hero 工作流任务集成', () => {
  it('AI 推荐方案模式跑通：策划注入偏好，最终 prompt 来自 HeroPlanV2', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    stubSuccessPipeline();
    const result = await runHeroTask(workspaceId, request(1, { humanPresence: 'avoid', creativeLevel: 'creative' }), cryptoId());
    expect(planHeroV2Mock).toHaveBeenCalledWith(expect.objectContaining({
      workspaceName: '杯子',
      humanPolicy: 'avoid',
      creativeLevel: 'creative',
      creativeIntent: undefined,
    }));
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      imagePath: 'selected.png',
      ratio: '1:1',
      count: 1,
      prompt: expect.stringContaining('A warm morning tabletop hero.'),
    }));
    expect(generateMock.mock.calls[0][0].prompt).toContain('白色杯身');
    expect(reviewHeroMock).toHaveBeenCalledTimes(1);
    expect(result.outputs).toHaveLength(1);
    expect((result.outputs[0] as { kind: 'image'; url: string }).url).toContain('result-01');
    expect(JSON.stringify(result)).not.toContain('.runtime');
  });

  it('自定义想法模式把用户创意原样注入策划', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    stubSuccessPipeline();
    await runHeroTask(workspaceId, request(1, { creativeMode: 'custom', creativeIntent: '雨夜归家的一刻' }), cryptoId());
    expect(planHeroV2Mock).toHaveBeenCalledWith(expect.objectContaining({ creativeIntent: '雨夜归家的一刻' }));
  });

  it('覆盖当前源图的新鲜分析作为商品理解复用，不再触发大分析', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    stubSuccessPipeline();
    intelligenceMock.mockResolvedValue(intelligence);
    await runHeroTask(workspaceId, request(), cryptoId());
    expect(planHeroV2Mock).toHaveBeenCalledWith(expect.objectContaining({ productUnderstanding: '白色杯身' }));
  });

  it('陈旧或未覆盖源图的分析不作为策划上下文', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    stubSuccessPipeline();
    intelligenceMock.mockResolvedValue({
      ...intelligence,
      assetSnapshot: [{ id: ASSET_ID, role: 'detail' }],
    });
    await runHeroTask(workspaceId, request(), cryptoId());
    expect(planHeroV2Mock).toHaveBeenCalledWith(expect.objectContaining({ productUnderstanding: undefined }));
  });

  it('审片全部不通过时任务失败且不产出结果', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    stubSuccessPipeline([reviewFail]);
    await expect(runHeroTask(workspaceId, request(), cryptoId())).rejects.toThrow(/未通过审片/);
  });

  it('部分通过时只保留通过结果', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    stubSuccessPipeline([reviewFail, reviewPass]);
    const result = await runHeroTask(workspaceId, request(2), cryptoId());
    expect(reviewHeroMock).toHaveBeenCalledTimes(2);
    expect(result.outputs).toHaveLength(1);
    expect((result.outputs[0] as { kind: 'image'; url: string }).url).toContain('result-01');
  });

  it('策划失败不会进入生图', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    stubSuccessPipeline();
    planHeroV2Mock.mockRejectedValue(new Error('planning failed'));
    await expect(runHeroTask(workspaceId, request(), cryptoId())).rejects.toThrow('planning failed');
    expect(generateMock).not.toHaveBeenCalled();
    expect(reviewHeroMock).not.toHaveBeenCalled();
  });
});

function cryptoId(): string {
  return `${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}-1111-4111-8111-111111111111`;
}
