import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { analyzeMock } = vi.hoisted(() => ({ analyzeMock: vi.fn() }));
vi.mock('@/server/providers/aliyun-qwen-vision', () => ({
  AliyunQwenVisionProvider: class {
    analyze(...args: unknown[]) { return analyzeMock(...args); }
  },
}));

import { saveAsset, setAssetRole } from '@/server/assets/service';
import { createWorkspace, workspaceRuntimePath } from '@/server/workspaces/service';
import { analyzeWorkspace, getWorkspaceIntelligence } from './service';
import { isIntelligenceFresh, ProductIntelligenceRecordSchema } from '@/core/intelligence';
import type { AssetRef } from '@/core/assets';

const previousRuntime = process.env.RUNTIME_DIR;
let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'intelligence-service-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
  analyzeMock.mockReset();
});

afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
afterAll(() => {
  if (previousRuntime === undefined) delete process.env.RUNTIME_DIR;
  else process.env.RUNTIME_DIR = previousRuntime;
});

function payload(assetId: string) {
  return {
    analysis: {
      category: '杯子', visualSummary: '白色杯身',
      visibleFacts: [{ text: '白色杯身', evidenceAssetIds: [assetId] }],
      visibleText: [], unverifiedFacts: [],
      assetObservations: [{ assetId, suggestedRole: 'front', quality: 'good', note: '主体清晰' }],
    },
    plan: {
      heroDirections: [{ id: 'hero-1', title: '桌面', sourceAssetId: assetId, scene: '明亮桌面', composition: '居中', lighting: '侧光', person: 'none', prompt: 'Bright tabletop scene.', reason: '主体清晰' }],
      collage: { titleOptions: ['简洁杯身'], sellingPoints: [{ text: '白色杯身', evidenceAssetIds: [assetId] }] },
    },
  };
}

async function fixture() {
  const workspace = await createWorkspace('商品 A');
  const buffer = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const asset = await saveAsset(workspace.id, { buffer, name: 'cup.png', mimeType: 'image/png' });
  await setAssetRole(workspace.id, asset.id, 'front');
  return { workspace, asset: { ...asset, role: 'front' as const } };
}

describe('商品理解服务校验与原子持久化', () => {
  it('一次用户动作只调用一次 Provider，校验成功后按 Workspace 持久化', async () => {
    const { workspace, asset } = await fixture();
    analyzeMock.mockResolvedValue(payload(asset.id));
    const record = await analyzeWorkspace(workspace.id, [asset.id]);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(record.assetSnapshot).toEqual([{ id: asset.id, role: 'front' }]);
    await expect(getWorkspaceIntelligence(workspace.id)).resolves.toEqual(record);
  });

  it('拒绝外部证据 id，失败时不写 intelligence.json', async () => {
    const { workspace, asset } = await fixture();
    analyzeMock.mockResolvedValue(payload('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    await expect(analyzeWorkspace(workspace.id, [asset.id])).rejects.toThrow(/未参与分析/);
    await expect(fs.access(workspaceRuntimePath(workspace.id, 'intelligence.json'))).rejects.toThrow();
  });

  it('参考图不能成为 Hero 源方向', async () => {
    const { workspace, asset } = await fixture();
    await setAssetRole(workspace.id, asset.id, 'reference');
    analyzeMock.mockResolvedValue(payload(asset.id));
    await expect(analyzeWorkspace(workspace.id, [asset.id])).rejects.toThrow(/参考图/);
  });
});

describe('商品理解契约与新鲜度', () => {
  const assetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const record = ProductIntelligenceRecordSchema.parse({
    ...payload(assetId),
    analyzedAt: '2026-08-25T00:00:00.000Z',
    assetSnapshot: [{ id: assetId, role: 'front' }],
  });
  const assetRef = (role: AssetRef['role'] = 'front'): AssetRef => ({
    id: assetId, name: 'a.jpg', mimeType: 'image/jpeg', width: 100, height: 100,
    role, createdAt: '2026-08-25T00:00:00.000Z',
  });

  it('接受完整结构，删除/改角色会失效，新增无关素材不会失效', () => {
    expect(record.plan.heroDirections[0].id).toBe('hero-1');
    expect(isIntelligenceFresh(record, [assetRef()])).toBe(true);
    expect(isIntelligenceFresh(record, [])).toBe(false);
    expect(isIntelligenceFresh(record, [assetRef('detail')])).toBe(false);
    expect(isIntelligenceFresh(record, [assetRef(), { ...assetRef(), id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }])).toBe(true);
  });
});
