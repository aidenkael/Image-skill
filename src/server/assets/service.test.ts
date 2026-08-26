import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  deleteAsset,
  ensurePrimaryAsset,
  listAssets,
  saveAsset,
  setAssetRole,
} from './service';
import { createWorkspace, workspaceRuntimePath } from '@/server/workspaces/service';

const previousRuntime = process.env.RUNTIME_DIR;
let root = '';
let image: Buffer;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-service-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
  image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } }).png().toBuffer();
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
afterAll(() => {
  if (previousRuntime === undefined) delete process.env.RUNTIME_DIR;
  else process.env.RUNTIME_DIR = previousRuntime;
});

describe('商品素材删除与角色一致性', () => {
  it('设置新主图会降级旧主图，始终只有一个 primary', async () => {
    const workspace = await createWorkspace('商品');
    const first = await saveAsset(workspace.id, { buffer: image, name: 'first.png', mimeType: 'image/png' });
    const second = await saveAsset(workspace.id, { buffer: image, name: 'second.png', mimeType: 'image/png' });
    await setAssetRole(workspace.id, first.id, 'primary');
    const assets = await setAssetRole(workspace.id, second.id, 'primary');
    expect(assets?.filter((asset) => asset.role === 'primary')).toHaveLength(1);
    expect(assets?.find((asset) => asset.id === second.id)?.role).toBe('primary');
    expect(assets?.find((asset) => asset.id === first.id)?.role).toBe('unknown');
  });

  it('旧数据存在多个 primary 时归一化为单一主图', async () => {
    const workspace = await createWorkspace('历史商品');
    const first = await saveAsset(workspace.id, { buffer: image, name: 'first.png', mimeType: 'image/png' });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const second = await saveAsset(workspace.id, { buffer: image, name: 'second.png', mimeType: 'image/png' });
    const firstRaw = { ...first, role: 'primary' as const };
    const secondRaw = { ...second, role: 'primary' as const };
    const { writeJson } = await import('@/server/storage/fs-store');
    await writeJson(workspaceRuntimePath(workspace.id, 'assets', first.id, 'asset.json'), firstRaw);
    await writeJson(workspaceRuntimePath(workspace.id, 'assets', second.id, 'asset.json'), secondRaw);
    await ensurePrimaryAsset(workspace.id);
    const assets = await listAssets(workspace.id);
    expect(assets.filter((asset) => asset.role === 'primary')).toHaveLength(1);
    expect(assets.find((asset) => asset.id === first.id)?.role).toBe('primary');
  });

  it('删除只移除目标资源目录，删除主图后为剩余素材补主图', async () => {
    const workspace = await createWorkspace('商品');
    const otherWorkspace = await createWorkspace('其他商品');
    const first = await saveAsset(workspace.id, { buffer: image, name: 'first.png', mimeType: 'image/png' });
    const second = await saveAsset(workspace.id, { buffer: image, name: 'second.png', mimeType: 'image/png' });
    const other = await saveAsset(otherWorkspace.id, { buffer: image, name: 'other.png', mimeType: 'image/png' });
    await setAssetRole(workspace.id, second.id, 'primary');
    const remaining = await deleteAsset(workspace.id, second.id);
    expect(remaining).toHaveLength(1);
    expect(remaining?.[0]).toMatchObject({ id: first.id, role: 'primary' });
    await expect(fs.access(workspaceRuntimePath(workspace.id, 'assets', second.id))).rejects.toThrow();
    await expect(fs.access(workspaceRuntimePath(otherWorkspace.id, 'assets', other.id))).resolves.toBeUndefined();
  });

  it('首次上传后 ensurePrimaryAsset 返回权威主图角色', async () => {
    const workspace = await createWorkspace('商品');
    const created = await saveAsset(workspace.id, { buffer: image, name: 'first.png', mimeType: 'image/png' });
    expect(created.role).toBe('unknown');
    await ensurePrimaryAsset(workspace.id);
    await expect(listAssets(workspace.id)).resolves.toEqual([
      expect.objectContaining({ id: created.id, role: 'primary' }),
    ]);
  });
});
