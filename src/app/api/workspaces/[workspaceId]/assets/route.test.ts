import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWorkspace } from '@/server/workspaces/service';
import { POST } from './route';

const previousRuntime = process.env.RUNTIME_DIR;
let root = '';
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'assets-route-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
afterAll(() => {
  if (previousRuntime === undefined) delete process.env.RUNTIME_DIR;
  else process.env.RUNTIME_DIR = previousRuntime;
});

describe('Asset POST', () => {
  it('上传响应立即返回权威主图角色与 createdIds', async () => {
    const workspace = await createWorkspace('商品');
    const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).png().toBuffer();
    const form = new FormData();
    form.append('files', new File([image], 'product.png', { type: 'image/png' }));
    const response = await POST(new Request('http://localhost', { method: 'POST', body: form }), {
      params: Promise.resolve({ workspaceId: workspace.id }),
    });
    const body = await response.json() as { assets: Array<{ id: string; role: string }>; createdIds: string[] };
    expect(response.status).toBe(201);
    expect(body.createdIds).toEqual([body.assets[0].id]);
    expect(body.assets[0].role).toBe('primary');
  });
});
