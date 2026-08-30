import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssetRef } from '@/core/assets';
import { writeJson } from '@/server/storage/fs-store';
import { createWorkspace, workspaceRuntimePath } from '@/server/workspaces/service';

const { runHeroMock } = vi.hoisted(() => ({ runHeroMock: vi.fn() }));
vi.mock('./hero', () => ({ runHeroTask: runHeroMock }));

import {
  createTask,
  getTask,
  listTasks,
  TaskConflictError,
  TaskValidationError,
} from './service';

const previousRuntimeDir = process.env.RUNTIME_DIR;
let temporaryRoot = '';

beforeEach(async () => {
  temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-task-owner-'));
  process.env.RUNTIME_DIR = path.join(temporaryRoot, '.runtime');
  runHeroMock.mockReset();
});

afterEach(async () => {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
});

afterAll(() => {
  if (previousRuntimeDir === undefined) delete process.env.RUNTIME_DIR;
  else process.env.RUNTIME_DIR = previousRuntimeDir;
});

describe('Workspace 任务素材归属校验', () => {
  it('Hero、Collage 与 Optimize 均拒绝外部或不存在的素材，且校验失败不落盘任务 JSON', async () => {
    const workspaceA = await createWorkspace('商品 A');
    const workspaceB = await createWorkspace('商品 B');
    const foreignAssetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const missingAssetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const foreignAsset: AssetRef = {
      id: foreignAssetId,
      name: 'foreign.png',
      mimeType: 'image/png',
      width: 100,
      height: 100,
      role: 'primary',
      createdAt: '2026-08-25T00:00:00.000Z',
    };
    await writeJson(
      workspaceRuntimePath(workspaceB.id, 'assets', foreignAssetId, 'asset.json'),
      foreignAsset,
    );

    await expect(
      createTask(workspaceA.id, {
        kind: 'hero',
        assetIds: [foreignAssetId],
        count: 1,
        options: {
          sourceAssetId: foreignAssetId,
          ratio: '1:1',
          creativeMode: 'recommended',
          humanPresence: 'auto',
          planId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        },
      }),
    ).rejects.toThrow(TaskValidationError);

    await expect(
      createTask(workspaceA.id, {
        kind: 'collage',
        assetIds: [missingAssetId],
        count: 1,
        options: {
          templateId: 'left-hero-right-three',
          includeTitle: true,
          title: '',
          includeSellingPoints: true,
          sellingPoints: ['', '', ''],
        },
      }),
    ).rejects.toThrow(`任务引用了不属于当前商品的图片: ${missingAssetId}`);

    await expect(
      createTask(workspaceA.id, {
        kind: 'optimize',
        assetIds: [missingAssetId],
        count: 1,
        options: {
          sourceAssetId: missingAssetId,
          ratio: 'original',
          fit: 'contain',
          background: 'white',
          maxEdge: 1600,
          quality: 90,
          format: 'jpg',
        },
      }),
    ).rejects.toThrow(`任务引用了不属于当前商品的图片: ${missingAssetId}`);

    const taskFiles = await fs
      .readdir(workspaceRuntimePath(workspaceA.id, 'tasks'))
      .catch(() => []);
    expect(taskFiles).toEqual([]);
  });

  it('Hero、Collage 与 Optimize 均在任务落盘前拒绝 reference 素材', async () => {
    const workspace = await createWorkspace('参考图边界');
    const referenceAssetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const referenceAsset: AssetRef = {
      id: referenceAssetId,
      name: 'reference.png',
      mimeType: 'image/png',
      width: 100,
      height: 100,
      role: 'reference',
      createdAt: '2026-08-25T00:00:00.000Z',
    };
    await writeJson(
      workspaceRuntimePath(workspace.id, 'assets', referenceAssetId, 'asset.json'),
      referenceAsset,
    );

    const requests = [
      {
        kind: 'hero',
        assetIds: [referenceAssetId],
        count: 1,
        options: {
          sourceAssetId: referenceAssetId,
          ratio: '1:1',
          creativeMode: 'recommended',
          humanPresence: 'auto',
          planId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        },
      },
      {
        kind: 'collage',
        assetIds: [referenceAssetId],
        count: 1,
        options: {
          templateId: 'left-hero-right-three',
          includeTitle: false,
          includeSellingPoints: false,
        },
      },
      {
        kind: 'optimize',
        assetIds: [referenceAssetId],
        count: 1,
        options: {
          sourceAssetId: referenceAssetId,
          ratio: 'original',
          fit: 'contain',
          background: 'white',
          maxEdge: 1600,
          quality: 90,
          format: 'jpg',
        },
      },
    ];

    for (const request of requests) {
      await expect(createTask(workspace.id, request)).rejects.toThrow(
        `参考图仅用于视觉参考，不能作为任务商品素材: ${referenceAssetId}`,
      );
    }
    const taskFiles = await fs
      .readdir(workspaceRuntimePath(workspace.id, 'tasks'))
      .catch(() => []);
    expect(taskFiles).toEqual([]);
  });
});

describe('Hero 运行连续性与重复提交保护', () => {
  async function fixture() {
    const workspace = await createWorkspace('Hero 商品');
    const assetId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const asset: AssetRef = {
      id: assetId,
      name: 'product.png',
      mimeType: 'image/png',
      width: 100,
      height: 100,
      role: 'primary',
      createdAt: new Date().toISOString(),
    };
    await writeJson(workspaceRuntimePath(workspace.id, 'assets', assetId, 'asset.json'), asset);
    const request = {
      kind: 'hero',
      assetIds: [assetId],
      count: 1,
      options: {
        sourceAssetId: assetId,
        ratio: '1:1',
        creativeMode: 'recommended',
        humanPresence: 'auto',
        planId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      },
    };
    return { workspace, assetId, request };
  }

  it('同进程快速重复提交只执行一次 Hero', async () => {
    const { workspace, request } = await fixture();
    let release!: () => void;
    runHeroMock.mockReturnValue(new Promise((resolve) => {
      release = () => resolve({ outputs: [{ kind: 'image', url: '/api/result.png' }] });
    }));
    const first = createTask(workspace.id, request);
    await vi.waitFor(() => expect(runHeroMock).toHaveBeenCalledTimes(1));
    await expect(createTask(workspace.id, request)).rejects.toThrow(TaskConflictError);
    release();
    await expect(first).resolves.toMatchObject({ status: 'succeeded' });
    expect(runHeroMock).toHaveBeenCalledTimes(1);
  });

  it('十五分钟前的 running Hero 在 get/list 中恢复失败，随后允许新建', async () => {
    const { workspace, request } = await fixture();
    const taskId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const old = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    await writeJson(workspaceRuntimePath(workspace.id, 'tasks', `${taskId}.json`), {
      id: taskId,
      workspaceId: workspace.id,
      request,
      status: 'running',
      createdAt: old,
      updatedAt: old,
    });
    await expect(getTask(workspace.id, taskId)).resolves.toMatchObject({
      status: 'failed', error: '上次生成任务已中断，请重新生成',
    });
    await expect(listTasks(workspace.id)).resolves.toEqual([
      expect.objectContaining({ id: taskId, status: 'failed' }),
    ]);
    runHeroMock.mockResolvedValue({ outputs: [{ kind: 'image', url: '/api/result.png' }] });
    await expect(createTask(workspace.id, request)).resolves.toMatchObject({ status: 'succeeded' });
  });
});
