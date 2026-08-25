import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { CreateTaskRequest } from '@/core/tasks';

const { generateMock, assetFileMock } = vi.hoisted(() => ({
  generateMock: vi.fn(),
  assetFileMock: vi.fn(),
}));

vi.mock('@/server/assets/service', () => ({ assetFile: assetFileMock }));
vi.mock('@/server/providers/aliyun-qwen-image', () => ({
  AliyunQwenImageProvider: class {
    generate(...args: unknown[]) {
      return generateMock(...args);
    }
  },
}));

import { buildHeroPrompt, heroSizeForRatio, runHeroTask } from './hero';

/**
 * hero 任务定向测试（不消耗付费额度）：
 * 商品保真/场景 prompt 构造、尺寸映射、返回数量不完整即失败、
 * 结果只暴露客户端 URL（不暴露本地绝对路径）。
 */

let workDir: string;
let pngBuffer: Buffer;
const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function heroRequest(count: number, options?: Partial<CreateTaskRequest['options']>): CreateTaskRequest {
  return {
    kind: 'hero',
    assetIds: ['asset-1'],
    count,
    options: {
      sourceAssetId: 'asset-1',
      ratio: '1:1',
      person: 'auto',
      sceneMode: 'auto',
      ...(options ?? {}),
    } as CreateTaskRequest['options'],
  };
}

function stubDownloadFetch() {
  const fetchMock = vi.fn(async () => new Response(new Uint8Array(pngBuffer), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeAll(async () => {
  workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hero-task-test-'));
  process.env.RUNTIME_DIR = path.join(workDir, '.runtime');
  pngBuffer = await sharp({
    create: { width: 4, height: 4, channels: 3, background: '#00ff00' },
  })
    .png()
    .toBuffer();
});

afterAll(async () => {
  delete process.env.RUNTIME_DIR;
  await fs.rm(workDir, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('hero prompt 构造（商品保真约束恒定）', () => {
  it('始终包含商品保真约束（形状/颜色/材质/图案/logo/结构/数量/配件）', () => {
    const prompt = buildHeroPrompt(heroRequest(1));
    expect(prompt).toContain('shape, color, material, pattern');
    expect(prompt).toContain('logo/text, structure, count and accessories');
  });

  it('自动场景给出现实生活场景指令；手动场景原样注入', () => {
    expect(buildHeroPrompt(heroRequest(1))).toContain('realistic lifestyle scene');
    const manual = buildHeroPrompt(
      heroRequest(1, { sceneMode: 'prompt', scenePrompt: '北欧风客厅，自然光' }),
    );
    expect(manual).toContain('Scene: 北欧风客厅，自然光');
    expect(manual).not.toContain('realistic lifestyle scene');
  });

  it('人物选项映射为人物交互指令；auto 不附加', () => {
    expect(buildHeroPrompt(heroRequest(1, { person: 'none' }))).toContain(
      'Do not include any person',
    );
    expect(buildHeroPrompt(heroRequest(1, { person: 'hand' }))).toContain('human hand');
    expect(buildHeroPrompt(heroRequest(1, { person: 'person' }))).toContain('complete real person');
    expect(buildHeroPrompt(heroRequest(1))).not.toContain('Do not include any person');
  });

  it('ratio → 固定输出尺寸', () => {
    expect(heroSizeForRatio('1:1')).toBe('1024*1024');
    expect(heroSizeForRatio('3:4')).toBe('768*1344');
    expect(heroSizeForRatio('4:3')).toBe('1344*768');
  });
});

describe('runHeroTask 结果数量与客户端契约', () => {
  it('源图不存在时失败', async () => {
    assetFileMock.mockResolvedValue(null);
    await expect(runHeroTask(workspaceId, heroRequest(1), 'task-x')).rejects.toThrow(
      /源商品图片不存在/,
    );
  });

  it('模型返回数量少于请求数量时任务失败（不以部分结果冒充成功）', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'x.png' });
    generateMock.mockResolvedValue([
      { url: 'https://cdn.example/1.png' },
      { url: 'https://cdn.example/2.png' },
    ]);
    stubDownloadFetch();
    await expect(runHeroTask(workspaceId, heroRequest(3), 'task-incomplete')).rejects.toThrow(
      /要求 3 张，实际 2 张/,
    );
  });

  it('返回数量完整时成功，且结果只暴露相对 URL，无本地绝对路径', async () => {
    assetFileMock.mockResolvedValue({ buffer: pngBuffer, mimeType: 'image/png', filePath: 'x.png' });
    generateMock.mockResolvedValue([
      { url: 'https://cdn.example/1.png' },
      { url: 'https://cdn.example/2.png' },
    ]);
    stubDownloadFetch();

    const taskId = '11111111-2222-3333-4444-555555555555';
    const result = await runHeroTask(workspaceId, heroRequest(2), taskId);

    expect(result.outputs).toHaveLength(2);
    for (const [i, output] of result.outputs.entries()) {
      expect(output).toEqual({
        kind: 'image',
        url: `/api/workspaces/${workspaceId}/tasks/${taskId}/outputs/result-0${i + 1}.png`,
      });
    }
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('localPath');
    expect(serialized).not.toContain(workDir);
    expect(serialized).not.toContain('.runtime');
    // 落盘文件确实位于当前商品工作区的 outputs/<taskId>/ 下
    const files = await fs.readdir(
      path.join(workDir, '.runtime', 'workspaces', workspaceId, 'outputs', taskId),
    );
    expect(files.sort()).toEqual(['result-01.png', 'result-02.png']);
  });
});
