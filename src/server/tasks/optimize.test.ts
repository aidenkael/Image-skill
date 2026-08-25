import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { validateCreateTaskRequest, type CreateTaskRequest, type OptimizeTaskOptions } from '@/core/tasks';

const { assetFileMock } = vi.hoisted(() => ({ assetFileMock: vi.fn() }));
vi.mock('@/server/assets/service', () => ({ assetFile: assetFileMock }));

import { optimizeDimensions, optimizeImage } from '@/server/image/sharp';
import { runOptimizeTask } from './optimize';

let root = '';
let source: Buffer;
const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const base: OptimizeTaskOptions = {
  sourceAssetId: 'asset-1', ratio: 'original', fit: 'contain', background: 'white',
  maxEdge: 1600, quality: 90, format: 'jpg',
};

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'optimize-task-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
  source = await sharp({ create: { width: 800, height: 400, channels: 3, background: '#ff0000' } }).png().toBuffer();
});
afterAll(async () => { delete process.env.RUNTIME_DIR; await fs.rm(root, { recursive: true, force: true }); });
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Sharp 简单优化', () => {
  it('Optimize 契约可执行且固定单源单输出，Detail 保持拒绝', () => {
    const request = { kind: 'optimize', assetIds: ['asset-1'], count: 1, options: base };
    expect(validateCreateTaskRequest(request).kind).toBe('optimize');
    expect(() => validateCreateTaskRequest({ ...request, count: 2 })).toThrow();
    expect(() => validateCreateTaskRequest({ ...request, assetIds: ['asset-1', 'asset-2'] })).toThrow(/只能提交一张/);
    expect(() => validateCreateTaskRequest({ ...request, kind: 'detail' })).toThrow(/后续阶段/);
  });

  it('原比例不裁切且不放大', async () => {
    const output = await optimizeImage(source, { ...base, maxEdge: 1024 });
    const meta = await sharp(output).metadata();
    expect([meta.width, meta.height]).toEqual([800, 400]);
  });

  it('1:1 contain 输出方形，3:4 与 4:3 尺寸映射正确', async () => {
    const square = await optimizeImage(source, { ...base, ratio: '1:1', maxEdge: 1024 });
    const meta = await sharp(square).metadata();
    expect([meta.width, meta.height]).toEqual([1024, 1024]);
    expect(optimizeDimensions('3:4', 1600)).toEqual({ width: 1200, height: 1600 });
    expect(optimizeDimensions('4:3', 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it('cover 使用固定画布，JPG/PNG/WebP 映射到对应格式', async () => {
    for (const format of ['jpg', 'png', 'webp'] as const) {
      const output = await optimizeImage(source, { ...base, ratio: '3:4', fit: 'cover', format, maxEdge: 1024 });
      const meta = await sharp(output).metadata();
      expect([meta.width, meta.height]).toEqual([768, 1024]);
      expect(meta.format).toBe(format === 'jpg' ? 'jpeg' : format);
    }
  });

  it('任务不调用网络/AI，并返回当前 Workspace 安全 URL', async () => {
    assetFileMock.mockResolvedValue({ buffer: source, mimeType: 'image/png', filePath: 'source.png' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const taskId = '11111111-2222-3333-4444-555555555555';
    const request: CreateTaskRequest = { kind: 'optimize', assetIds: ['asset-1'], count: 1, options: base };
    const result = await runOptimizeTask(workspaceId, request, taskId);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.outputs).toEqual([{ kind: 'image', url: `/api/workspaces/${workspaceId}/tasks/${taskId}/outputs/optimized.jpg` }]);
  });
});
