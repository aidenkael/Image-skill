import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HeroBatchReview, HeroBrief, HeroHardFailure } from '@/core/hero-workflow';
import type { CreateTaskRequest } from '@/core/tasks';

/**
 * 一键 Hero 任务集成测试：
 * 任务入口自动调用 Director → 生成 → 批量 QA → 至多一次反馈补生。
 * 不再依赖任何 planId / 持久化方案。
 */

const { generateMock, directHeroMock, reviewHeroBatchMock, assetFileMock, listAssetsMock, workspaceMock, previewMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  directHeroMock: vi.fn(),
  reviewHeroBatchMock: vi.fn(),
  assetFileMock: vi.fn(),
  listAssetsMock: vi.fn(),
  workspaceMock: vi.fn(),
  previewMock: vi.fn(),
}));
vi.mock('@/server/assets/service', () => ({ assetFile: assetFileMock, listAssets: listAssetsMock }));
vi.mock('@/server/providers/factory', () => ({
  createActiveImageProvider: async () => ({ generate: (...args: unknown[]) => generateMock(...args) }),
  createActiveVisionProvider: async () => ({
    directHero: (...args: unknown[]) => directHeroMock(...args),
    reviewHeroBatch: (...args: unknown[]) => reviewHeroBatchMock(...args),
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

const brief: HeroBrief = {
  title: '晨光桌面',
  productIdentity: {
    summary: '白色陶瓷马克杯',
    fixedTraits: ['白色杯身', '单件', '陶瓷质感'],
    movableParts: [],
  },
  presentation: {
    mode: 'scene-staging',
    reason: '桌面场景传达日常使用感',
    interaction: null,
    scene: '清晨木桌',
    camera: '居中微俯 50mm',
    lighting: '柔和自然窗光',
    depthOfField: '轻浅景深',
    scaleCue: null,
  },
  forbiddenChanges: ['杯柄数量变化', '杯身图案改变', '材质变成金属'],
};

function batchReview(count: number, hardFailures: HeroHardFailure[][] = [], repairs: Array<string | null> = []): HeroBatchReview {
  return {
    assessments: Array.from({ length: count }, (_, index) => ({
      candidateIndex: index,
      hardFailures: hardFailures[index] ?? [],
      softIssues: [],
      repairInstruction: repairs[index] ?? null,
    })),
    preferredOrder: Array.from({ length: count }, (_, index) => index),
  };
}

const asset = { id: ASSET_ID, name: 'cup.png', mimeType: 'image/png' as const, width: 100, height: 100, role: 'front' as const, createdAt: '2026-08-25T00:00:00.000Z' };

function request(count = 1, options: Record<string, unknown> = {}): CreateTaskRequest {
  return {
    kind: 'hero',
    assetIds: [ASSET_ID],
    count,
    options: {
      sourceAssetId: ASSET_ID,
      ratio: '1:1',
      humanPresence: 'auto',
      ...options,
    },
  } as CreateTaskRequest;
}

function stubSuccessPipeline(count: number, review: HeroBatchReview = batchReview(count)) {
  workspaceMock.mockResolvedValue({ name: '杯子' });
  listAssetsMock.mockResolvedValue([asset]);
  assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
  previewMock.mockResolvedValue(Buffer.from('preview'));
  directHeroMock.mockResolvedValue(brief);
  generateMock.mockResolvedValue(Array.from({ length: count }, (_item, index) => ({ url: `https://cdn.example/${index + 1}.png` })));
  reviewHeroBatchMock.mockResolvedValue(review);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(pngBuffer), { status: 200 })));
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-task-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
  pngBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00ff00' } }).png().toBuffer();
});
afterAll(async () => { delete process.env.RUNTIME_DIR; await fs.rm(root, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('一键 Hero 工作流任务', () => {
  it('无需 planId：自动调用一次 Director，确定性 prompt 携带身份约束', async () => {
    stubSuccessPipeline(1);
    const result = await runHeroTask(workspaceId, request(1, { humanPresence: 'avoid' }), cryptoId());
    expect(directHeroMock).toHaveBeenCalledTimes(1);
    expect(directHeroMock).toHaveBeenCalledWith(expect.objectContaining({ humanPolicy: 'avoid' }));
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      imagePath: 'selected.png',
      ratio: '1:1',
      count: 1,
      prompt: expect.stringContaining('白色杯身'),
    }));
    expect(generateMock.mock.calls[0][0].prompt).toContain('do not show any person');
    expect(reviewHeroBatchMock).toHaveBeenCalledTimes(1);
    expect(result.outputs).toHaveLength(1);
    expect((result.outputs[0] as { kind: 'image'; url: string }).url).toContain('result-01');
  });

  it('Director 不接收 Product Intelligence（只依赖源图）', async () => {
    stubSuccessPipeline(1);
    await runHeroTask(workspaceId, request(), cryptoId());
    const directorInput = directHeroMock.mock.calls[0][0];
    expect(directorInput).not.toHaveProperty('intelligence');
    expect(directorInput).not.toHaveProperty('productUnderstanding');
    expect(directorInput.asset).toBeDefined();
  });

  it('批量 QA 一次调用收到全部候选；可用则不补生', async () => {
    stubSuccessPipeline(2);
    const result = await runHeroTask(workspaceId, request(2), cryptoId());
    expect(result.outputs).toHaveLength(2);
    expect(reviewHeroBatchMock).toHaveBeenCalledTimes(1);
    const reviewInput = reviewHeroBatchMock.mock.calls[0][0];
    expect(reviewInput.generated).toHaveLength(2);
    expect(reviewInput.brief).toEqual(brief);
    expect(generateMock).toHaveBeenCalledTimes(1);
  });

  it('部分不合格时仅补生一次，补生 prompt 携带 QA 修复反馈', async () => {
    workspaceMock.mockResolvedValue({ name: '杯子' });
    listAssetsMock.mockResolvedValue([asset]);
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    previewMock.mockResolvedValue(Buffer.from('preview'));
    directHeroMock.mockResolvedValue(brief);
    generateMock
      .mockResolvedValueOnce([{ url: 'https://cdn.example/1.png' }, { url: 'https://cdn.example/2.png' }])
      .mockResolvedValueOnce([{ url: 'https://cdn.example/3.png' }]);
    reviewHeroBatchMock
      .mockResolvedValueOnce(batchReview(2, [[], ['topology_broken']], [null, '保持杯柄为单个']))
      .mockResolvedValueOnce(batchReview(1));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(pngBuffer), { status: 200 })));

    const result = await runHeroTask(workspaceId, request(2), cryptoId());
    expect(result.outputs).toHaveLength(2);
    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(reviewHeroBatchMock).toHaveBeenCalledTimes(2);
    expect(generateMock.mock.calls[1][0].prompt).toContain('Visual QA correction for this retry');
    expect(generateMock.mock.calls[1][0].prompt).toContain('保持杯柄为单个');
  });

  it('补生后仍不足则任务失败并报告通过数量', async () => {
    workspaceMock.mockResolvedValue({ name: '杯子' });
    listAssetsMock.mockResolvedValue([asset]);
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    previewMock.mockResolvedValue(Buffer.from('preview'));
    directHeroMock.mockResolvedValue(brief);
    generateMock
      .mockResolvedValueOnce([{ url: 'https://cdn.example/1.png' }])
      .mockResolvedValueOnce([{ url: 'https://cdn.example/2.png' }]);
    reviewHeroBatchMock
      .mockResolvedValueOnce(batchReview(1, [['product_identity_changed']]))
      .mockResolvedValueOnce(batchReview(1, [['topology_broken']]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(pngBuffer), { status: 200 })));

    await expect(runHeroTask(workspaceId, request(1), cryptoId())).rejects.toThrow(/0\/1/);
  });

  it('参考图不能作为源图', async () => {
    workspaceMock.mockResolvedValue({ name: '杯子' });
    listAssetsMock.mockResolvedValue([{ ...asset, role: 'reference' }]);
    await expect(runHeroTask(workspaceId, request(), cryptoId())).rejects.toThrow(/参考图/);
    expect(directHeroMock).not.toHaveBeenCalled();
  });

  it('旧请求携带 planId/creativeMode/creativeLevel 仍被接受并丢弃', async () => {
    stubSuccessPipeline(1);
    const legacyRequest = request(1, {
      planId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      creativeMode: 'recommended',
      creativeLevel: 'balanced',
    });
    const result = await runHeroTask(workspaceId, legacyRequest, cryptoId());
    expect(result.outputs).toHaveLength(1);
  });
});

function cryptoId(): string {
  return `${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}-1111-4111-8111-111111111111`;
}
