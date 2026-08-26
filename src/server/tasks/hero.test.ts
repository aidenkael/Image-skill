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
vi.mock('@/server/providers/factory', () => ({
  createActiveImageProvider: async () => ({ generate: (...args: unknown[]) => generateMock(...args) }),
}));

import { buildHeroPrompt, heroSizeForRatio, runHeroTask } from './hero';

const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RECOMMENDED_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
let root = '';
let pngBuffer: Buffer;

const concept: ProductIntelligenceRecord['plan']['heroConcepts'][number] = {
  id: 'hero-1',
  title: '晨间故事',
  recommendedSourceAssetId: RECOMMENDED_ID,
  creativeBrief: '以清晨使用瞬间建立温暖故事感',
  prompt: 'A warm morning ritual with expressive commercial storytelling.',
  reason: '能突出商品的日常吸引力',
};
const intelligence: ProductIntelligenceRecord = {
  analysis: { category: '杯子', visualSummary: '白色杯身', visibleFacts: [], visibleText: [], unverifiedFacts: [], assetObservations: [] },
  plan: { heroConcepts: [concept], collage: { titleOptions: [], sellingPoints: [] } },
  schemaVersion: 3,
  analyzedAt: '2026-08-25T00:00:00.000Z',
  assetSnapshot: [{ id: ASSET_ID, role: 'front' }],
};
const asset = { id: ASSET_ID, name: 'cup.png', mimeType: 'image/png' as const, width: 100, height: 100, role: 'front' as const, createdAt: '2026-08-25T00:00:00.000Z' };

function request(count = 1, options: Record<string, unknown> = {}): CreateTaskRequest {
  return {
    kind: 'hero',
    assetIds: [ASSET_ID],
    count,
    options: {
      sourceAssetId: ASSET_ID,
      ratio: '1:1',
      creativeMode: 'free',
      humanPresence: 'auto',
      ...options,
    },
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

describe('Hero 分层 prompt', () => {
  it('free 模式开放创作且 auto 人物不追加限制', () => {
    const prompt = buildHeroPrompt(request());
    expect(prompt).toContain('Freely decide the creative concept');
    expect(prompt).toContain('Preserve the referenced product exactly');
    expect(prompt).not.toMatch(/Do not show any person|Include meaningful/);
    expect(prompt).not.toMatch(/Composition:|Lighting:|Scene:/);
  });

  it('concept 直接消费开放 prompt，人物显式覆盖最后追加', () => {
    const prompt = buildHeroPrompt(request(1, {
      creativeMode: 'concept', conceptId: concept.id, humanPresence: 'none',
    }), concept);
    expect(prompt).toContain(concept.prompt);
    expect(prompt.endsWith('Do not show any person, hand, body part, silhouette or human figure anywhere in the image.')).toBe(true);
  });

  it('custom 扩展开放意图，involved 不固定手部或全身形式', () => {
    const prompt = buildHeroPrompt(request(1, {
      creativeMode: 'custom', creativeIntent: '雨夜归家的一刻', humanPresence: 'involved',
    }));
    expect(prompt).toContain('雨夜归家的一刻');
    expect(prompt).toContain('meaningful, natural human presence');
    expect(prompt).toContain('Choose the most appropriate');
    expect(prompt).not.toContain('fully visible');
  });

  it('比例映射保持不变', () => {
    expect(heroSizeForRatio('1:1')).toBe('1024*1024');
    expect(heroSizeForRatio('3:4')).toBe('768*1344');
    expect(heroSizeForRatio('4:3')).toBe('1344*768');
  });
});

describe('Hero 执行与新鲜分析要求', () => {
  it('只有 concept 模式要求已有且新鲜的 v3 商品分析', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    intelligenceMock.mockResolvedValue(null);
    await expect(runHeroTask(workspaceId, request(1, {
      creativeMode: 'concept', conceptId: concept.id,
    }), 'task-missing')).rejects.toThrow(/先分析商品/);
    intelligenceMock.mockResolvedValue(intelligence);
    listAssetsMock.mockResolvedValue([{ ...asset, role: 'detail' }]);
    await expect(runHeroTask(workspaceId, request(1, {
      creativeMode: 'concept', conceptId: concept.id,
    }), 'task-stale')).rejects.toThrow(/重新分析/);
  });

  it.each([
    ['free', {}],
    ['custom', { creativeMode: 'custom', creativeIntent: '极简但有张力' }],
  ])('%s 模式不读取商品分析', async (_label, options) => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }]);
    stubDownload();
    await runHeroTask(workspaceId, request(1, options), cryptoId());
    expect(intelligenceMock).not.toHaveBeenCalled();
  });

  it('concept 推荐源不会覆盖用户实际选择的源图', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    intelligenceMock.mockResolvedValue(intelligence);
    listAssetsMock.mockResolvedValue([asset]);
    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }]);
    stubDownload();
    await runHeroTask(workspaceId, request(1, {
      creativeMode: 'concept', conceptId: concept.id,
    }), cryptoId());
    expect(assetFileMock).toHaveBeenCalledWith(workspaceId, ASSET_ID, 'original');
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({ imagePath: 'selected.png', ratio: '1:1' }));
  });

  it('完整结果只返回安全 URL，数量不足时整体失败', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'selected.png' });
    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }, { url: 'https://cdn.example/2.png' }]);
    stubDownload();
    const result = await runHeroTask(workspaceId, request(2), cryptoId());
    expect(result.outputs).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain('.runtime');
    expect(JSON.stringify(result)).not.toContain('localPath');

    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }]);
    await expect(runHeroTask(workspaceId, request(2), cryptoId())).rejects.toThrow(/要求 2 张，实际 1 张/);
  });
});

function cryptoId(): string {
  return `${Math.random().toString(16).slice(2, 10).padEnd(8, '0')}-1111-4111-8111-111111111111`;
}
