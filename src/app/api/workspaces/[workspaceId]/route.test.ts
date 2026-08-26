import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace, getWorkspace, workspaceRuntimePath } from '@/server/workspaces/service';
import { writeJson } from '@/server/storage/fs-store';
import { DELETE } from './route';

const previousRuntime = process.env.RUNTIME_DIR;
let root = '';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-route-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
afterAll(() => {
  if (previousRuntime === undefined) delete process.env.RUNTIME_DIR;
  else process.env.RUNTIME_DIR = previousRuntime;
});

describe('Workspace DELETE', () => {
  it('活动商品分析存在时返回 409 且不删除 Workspace', async () => {
    const workspace = await createWorkspace('商品');
    const now = new Date().toISOString();
    await writeJson(workspaceRuntimePath(workspace.id, 'intelligence-run.json'), {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      workspaceId: workspace.id,
      assetIds: ['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'],
      status: 'running',
      startedAt: now,
      updatedAt: now,
    });
    const response = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ workspaceId: workspace.id }),
    });
    expect(response.status).toBe(409);
    await expect(getWorkspace(workspace.id)).resolves.toMatchObject({ id: workspace.id });
  });
});
