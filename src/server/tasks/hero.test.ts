import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HeroPlanV2, HeroPlanRecord, HeroReview } from '@/core/hero-workflow';
import type { CreateTaskRequest } from '@/core/tasks';

/**
 * Hero 任务集成测试：任务入口加载已策划方案并执行生成与审片，
 * 正式生成阶段不再调用 planHeroV2。
 */

const { generateMock, reviewHeroMock, assetFileMock, listAssetsMock, workspaceMock, previewMock, getHeroPlanRecordMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  reviewHeroMock: vi.fn(),
  assetFileMock: vi.fn(),
  listAssetsMock: vi.fn(),
  workspaceMock: vi.fn(),
  previewMock: vi.fn(),
  getHeroPlanRecordMock: vi.fn(),
}));
vi.mock('@/server/assets/service', () => ({ assetFile: assetFileMock, listAssets: listAssetsMock }));
vi.mock('@/server/providers/factory', () => ({
  createActiveImageProvider: async () => ({ generate: (...args: unknown[]) => generateMock(...args) }),
  createActiveVisionProvider: async () => ({
    reviewHero: (...args: unknown[]) => reviewHeroMock(...args),
  }),
}));
vi.mock('@/server/image/sharp', async (original) => ({
  ...await original<typeof import('@/server/image/sharp')>(),
  makeVisionPreview: (...args: unknown[]) => previewMock(...args),
}));
vi.mock('@/server/workspaces/service', () => ({ getWorkspace: workspaceMock }));
vi.mock('@/server/hero-workflow/plan-store', () => ({
  getHeroPlanRecord: (...args: unknown[]) => getHeroPlanRecordMock(...args),
  isHeroPlanRecordFresh: () => true,
}));

import { runHeroTask } from './hero';

const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
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

const planRecord: HeroPlanRecord = {
  id: PLAN_ID,
  workspaceId,
  sourceAssetId: ASSET_ID,
  sourceAssetRole: 'front',
  ratio: '1:1',
  creativeMode: 'recommended',
  humanPolicy: 'auto',
  creativeLevel: 'balanced',
  createdAt: '2026-08-25T00:00:00.000Z',
  plan,
};

const reviewPass: HeroReview = { passed: true, score: 82, issues: [], summary: '结构一致，适合电商主图' };
const reviewFail: HeroReview = { passed: false, score: 35, issues: ['杯柄结构错误'], summary: '商品结构失真' };

const asset = { id: ASSET_ID, name: 'cup.png', mimeType: 'image/png' as const, width: 100, height: 100, role: 'front' as const, createdAt: '2026-08-25T00:00:00.000Z' };

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
      planId: PLAN_ID,
      ...options,
    },
  } as CreateTaskRequest;
}

function stubSuccessPipeline(reviews: HeroReview[] = [reviewPass]) {
  workspaceMock.mockResolvedValue({ name: '杯子' });
  listAssetsMock.mockResolvedValue([asset]);
  getHeroPlanRecordMock.mockResolvedValue(planRecord);
  previewMock.mockResolvedValue(Buffer.from('preview'));
  generateMock.mockResolvedValue(reviews.map((_item, index) => ({ url: `https://cdn.example/${index + 1}.png` })));
  reviewHeroMock.mockReset();
  for (const review of reviews) reviewHeroMock.mockResolvedValueOnce(review);
  reviewHeroMock.mockResolvedValue(reviews[reviews.length - 1]);
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
  it('使用已策划方案执行生成与审片，不再调用 planHeroV2', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    stubSuccessPipeline();
    const result = await runHeroTask(workspaceId, request(1, { humanPresence: 'avoid', creativeLevel: 'creative' }), cryptoId());
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

  it('无 planId 时立即失败', async () => {
    await expect(runHeroTask(workspaceId, request(1, { planId: undefined }), cryptoId())).rejects.toThrow(/先获取 AI 方案/);
  });

  it('planId 不匹配时失败', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    getHeroPlanRecordMock.mockResolvedValue(planRecord);
    await expect(runHeroTask(workspaceId, request(1, { planId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }), cryptoId())).rejects.toThrow(/方案已失效/);
  });

  it('无 plan record 时失败', async () => {
    getHeroPlanRecordMock.mockResolvedValue(null);
    await expect(runHeroTask(workspaceId, request(), cryptoId())).rejects.toThrow(/方案已失效/);
  });

  it('审片全部不通过时任务失败', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    stubSuccessPipeline([reviewFail]);
    await expect(runHeroTask(workspaceId, request(), cryptoId())).rejects.toThrow(/审片后仅有/);
  });

  it('部分通过时补生成直到满足数量', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    workspaceMock.mockResolvedValue({ name: '杯子' });
    listAssetsMock.mockResolvedValue([asset]);
    getHeroPlanRecordMock.mockResolvedValue(planRecord);
    previewMock.mockResolvedValue(Buffer.from('preview'));
    generateMock
      .mockResolvedValueOnce([{ url: 'https://cdn.example/1.png' }, { url: 'https://cdn.example/2.png' }])
      .mockResolvedValueOnce([{ url: 'https://cdn.example/3.png' }]);
    reviewHeroMock.mockReset();
    reviewHeroMock.mockResolvedValueOnce(reviewFail).mockResolvedValueOnce(reviewPass);
    reviewHeroMock.mockResolvedValueOnce(reviewPass);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(pngBuffer), { status: 200 })));
    const result = await runHeroTask(workspaceId, request(2), cryptoId());
    expect(result.outputs).toHaveLength(2);
    expect(generateMock).toHaveBeenCalledTimes(2);
  });
});

function cryptoId(): string {
  return `${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}-1111-4111-8111-111111111111`;
}
