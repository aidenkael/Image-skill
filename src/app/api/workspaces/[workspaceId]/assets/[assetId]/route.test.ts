import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensurePrimaryAsset, saveAsset } from '@/server/assets/service';
import { createWorkspace, workspaceRuntimePath } from '@/server/workspaces/service';
import { writeJson } from '@/server/storage/fs-store';
import { DELETE, PATCH } from './route';

const previousRuntime = process.env.RUNTIME_DIR;
let root = '';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'asset-route-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
afterAll(() => {
  if (previousRuntime === undefined) delete process.env.RUNTIME_DIR;
  else process.env.RUNTIME_DIR = previousRuntime;
});

describe('活动 AI 资源锁', () => {
  it('分析正在使用的图片不能删除或改角色', async () => {
    const workspace = await createWorkspace('商品');
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
    const asset = await saveAsset(workspace.id, { buffer: image, name: 'product.png', mimeType: 'image/png' });
    await ensurePrimaryAsset(workspace.id);
    const now = new Date().toISOString();
    await writeJson(workspaceRuntimePath(workspace.id, 'intelligence-run.json'), {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workspaceId: workspace.id,
      assetIds: [asset.id],
      status: 'running',
      startedAt: now,
      updatedAt: now,
    });
    const context = { params: Promise.resolve({ workspaceId: workspace.id, assetId: asset.id }) };
    const deleted = await DELETE(new Request('http://localhost', { method: 'DELETE' }), context);
    expect(deleted.status).toBe(409);
    const patched = await PATCH(new Request('http://localhost', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'detail' }),
    }), context);
    expect(patched.status).toBe(409);
  });
});
