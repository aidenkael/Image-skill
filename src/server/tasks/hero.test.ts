import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CreateTaskRequest } from '@/core/tasks';
import type { ProductIntelligenceRecord } from '@/core/intelligence';

const { generateMock, assetFileMock, listAssetsMock, intelligenceMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  assetFileMock: vi.fn(),
  listAssetsMock: vi.fn(),
  intelligenceMock: vi.fn(),
}));
vi.mock('@/server/assets/service', () => ({ assetFile: assetFileMock, listAssets: listAssetsMock }));
vi.mock('@/server/intelligence/service', () => ({ getWorkspaceIntelligence: intelligenceMock }));
vi.mock('@/server/providers/aliyun-qwen-image', () => ({
  AliyunQwenImageProvider: class { generate(...args: unknown[]) { return generateMock(...args); } },
}));

import { buildHeroPrompt, heroSizeForRatio, runHeroTask } from './hero';

const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let root = '';
let pngBuffer: Buffer;

const direction: ProductIntelligenceRecord['plan']['heroDirections'][number] = {
  id: 'hero-1', title: '晨间桌面', sourceAssetId: ASSET_ID, scene: '明亮桌面',
  composition: '居中近景', lighting: '柔和侧光', person: 'hand',
  prompt: 'Bright morning tabletop commercial photography.', reason: '突出主体',
};
const intelligence = {
  analysis: { category: '杯子', visualSummary: '白色杯身', visibleFacts: [], visibleText: [], unverifiedFacts: [], assetObservations: [] },
  plan: { heroDirections: [direction], collage: { titleOptions: [], sellingPoints: [] } },
  analyzedAt: '2026-08-25T00:00:00.000Z',
  assetSnapshot: [{ id: ASSET_ID, role: 'front' }],
} as ProductIntelligenceRecord;
const asset = { id: ASSET_ID, name: 'cup.png', mimeType: 'image/png' as const, width: 100, height: 100, role: 'front' as const, createdAt: '2026-08-25T00:00:00.000Z' };

function request(count = 1, options: Record<string, unknown> = {}): CreateTaskRequest {
  return {
    kind: 'hero', assetIds: [ASSET_ID], count,
    options: { sourceAssetId: ASSET_ID, ratio: '1:1', person: 'auto', sceneMode: 'auto', ...options },
  } as CreateTaskRequest;
}

function stubDownload() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(pngBuffer), { status: 200 })));
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-task-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
  pngBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00ff00' } }).png().toBuffer();
});
afterAll(async () => { delete process.env.RUNTIME_DIR; await fs.rm(root, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Hero Visual Plan prompt', () => {
  it('自动模式消费方向 prompt/构图/光线，不再使用旧通用场景句', () => {
    const prompt = buildHeroPrompt(request(), direction);
    expect(prompt).toContain(direction.prompt);
    expect(prompt).toContain(direction.composition);
    expect(prompt).toContain(direction.lighting);
    expect(prompt).not.toContain('Choose a realistic lifestyle scene');
  });

  it('自定义场景无需方向，商品保真指令保持不变', () => {
    const prompt = buildHeroPrompt(request(1, { sceneMode: 'prompt', scenePrompt: '北欧风客厅' }));
    expect(prompt).toContain('Scene: 北欧风客厅');
    expect(prompt).toContain('shape, color, material, pattern');
  });

  it('person=auto 使用方向建议，显式人物设置优先', () => {
    expect(buildHeroPrompt(request(), direction)).toContain('human hand');
    const explicit = buildHeroPrompt(request(1, { person: 'none' }), direction);
    expect(explicit).toContain('Do not include any person');
    expect(explicit).not.toContain('human hand');
  });

  it('比例映射保持不变', () => {
    expect(heroSizeForRatio('1:1')).toBe('1024*1024');
    expect(heroSizeForRatio('3:4')).toBe('768*1344');
    expect(heroSizeForRatio('4:3')).toBe('1344*768');
  });
});

describe('Hero 执行与新鲜分析要求', () => {
  beforeAll(() => undefined);

  it('自动模式要求已有且新鲜的商品分析', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'x.png' });
    intelligenceMock.mockResolvedValue(null);
    await expect(runHeroTask(workspaceId, request(), 'task-missing')).rejects.toThrow(/先分析商品/);
    intelligenceMock.mockResolvedValue(intelligence);
    listAssetsMock.mockResolvedValue([{ ...asset, role: 'detail' }]);
    await expect(runHeroTask(workspaceId, request(), 'task-stale')).rejects.toThrow(/重新分析/);
  });

  it('缺少 directionId 时回退首个方向，并把推荐人物写入生成 prompt', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'x.png' });
    intelligenceMock.mockResolvedValue(intelligence);
    listAssetsMock.mockResolvedValue([asset]);
    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }]);
    stubDownload();
    await runHeroTask(workspaceId, request(), '11111111-1111-4111-8111-111111111111');
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining(direction.prompt),
      count: 1,
    }));
  });

  it('显式自定义场景不读取商品分析，完整结果只返回安全 URL', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'x.png' });
    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }, { url: 'https://cdn.example/2.png' }]);
    stubDownload();
    const taskId = '22222222-2222-4222-8222-222222222222';
    const result = await runHeroTask(workspaceId, request(2, { sceneMode: 'prompt', scenePrompt: '纯白摄影棚', person: 'none' }), taskId);
    expect(intelligenceMock).not.toHaveBeenCalled();
    expect(result.outputs).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('.runtime');
    expect(JSON.stringify(result)).not.toContain('localPath');
  });

  it('模型返回数量不足时整体失败', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'x.png' });
    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }]);
    stubDownload();
    await expect(runHeroTask(workspaceId, request(2, { sceneMode: 'prompt', scenePrompt: '桌面' }), 'task-incomplete')).rejects.toThrow(/要求 2 张，实际 1 张/);
  });
});
