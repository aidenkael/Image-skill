import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeroPlanV2 } from '@/core/hero-workflow';
import type { HeroWorkflowInput } from './contracts';

const { generateMock } = vi.hoisted(() => ({ generateMock: vi.fn() }));
vi.mock('@/server/providers/factory', () => ({
  createActiveImageProvider: async () => ({ generate: (...args: unknown[]) => generateMock(...args) }),
}));

import { executeHeroWorkflow } from './executor';

const ASSET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let root = '';
let outDir = '';
let pngBuffer: Buffer;

function plan(overrides: Partial<HeroPlanV2> = {}): HeroPlanV2 {
  return {
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
    altPrompt: 'A dusk window hero.',
    ...overrides,
  };
}

function input(overrides: Partial<HeroWorkflowInput> = {}): HeroWorkflowInput {
  return {
    workspaceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    workspaceName: '杯子',
    taskId: 'task-1',
    sourceImagePath: 'selected.png',
    sourcePreview: Buffer.from('preview'),
    sourceAssetId: ASSET_ID,
    sourceAssetRole: 'front',
    ratio: '3:4',
    count: 1,
    humanPolicy: 'auto',
    creativeLevel: 'balanced',
    ...overrides,
  };
}

function stubDownload() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(pngBuffer), { status: 200 })));
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-executor-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
  pngBuffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#00ff00' } }).png().toBuffer();
});
afterAll(async () => { delete process.env.RUNTIME_DIR; await fs.rm(root, { recursive: true, force: true }); });
beforeEach(async () => {
  outDir = await fs.mkdtemp(path.join(root, 'out-'));
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Hero 执行分支', () => {
  it('scene-staging 分支调用 image provider，prompt 来自 HeroPlanV2，ratio/count 原语义', async () => {
    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }]);
    stubDownload();
    const images = await executeHeroWorkflow(input(), plan({ displayMode: 'scene-staging' }), outDir);
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({
      imagePath: 'selected.png',
      ratio: '3:4',
      count: 1,
      prompt: expect.stringContaining('still-life merchandising'),
    }));
    expect(generateMock.mock.calls[0][0].prompt).toContain('A warm morning tabletop hero.');
    expect(images).toHaveLength(1);
    expect(images[0].extension).toBe('png');
    await expect(fs.stat(images[0].localPath)).resolves.toBeTruthy();
  });

  it('human-interaction 分支同样调用 image provider，prompt 带人物互动语义', async () => {
    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }]);
    stubDownload();
    await executeHeroWorkflow(input(), plan({ displayMode: 'human-interaction' }), outDir);
    expect(generateMock.mock.calls[0][0].prompt).toContain('natural human interaction');
  });

  it('count>1 且有备选 prompt 时用备选 prompt 额外生成 1 张', async () => {
    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }]);
    stubDownload();
    await executeHeroWorkflow(input({ count: 2 }), plan(), outDir);
    expect(generateMock).toHaveBeenCalledTimes(2);
    expect(generateMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ count: 1, prompt: expect.stringContaining('A warm morning tabletop hero.') }));
    expect(generateMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ count: 1, prompt: expect.stringContaining('A dusk window hero.') }));
  });

  it('无备选 prompt 时保持单次调用与完整 count', async () => {
    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }, { url: 'https://cdn.example/2.png' }]);
    stubDownload();
    await executeHeroWorkflow(input({ count: 2 }), plan({ altPrompt: undefined }), outDir);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledWith(expect.objectContaining({ count: 2 }));
  });

  it('模型返回数量不足时整体失败', async () => {
    generateMock.mockResolvedValue([{ url: 'https://cdn.example/1.png' }]);
    stubDownload();
    await expect(executeHeroWorkflow(input({ count: 2 }), plan({ altPrompt: undefined }), outDir))
      .rejects.toThrow(/要求 2 张，实际 1 张/);
  });
});
