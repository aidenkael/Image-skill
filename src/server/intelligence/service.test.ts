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
import {
  isIntelligenceFresh,
  ProductIntelligenceRecordSchema,
  PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
} from '@/core/intelligence';
import type { AssetRef } from '@/core/assets';
import { writeJson } from '@/server/storage/fs-store';

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
      collage: {
        titleOptions: [{ text: '简洁杯身', evidenceAssetIds: [assetId] }],
        sellingPoints: [{ text: '白色杯身', evidenceAssetIds: [assetId] }],
      },
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
    expect(record.schemaVersion).toBe(PRODUCT_INTELLIGENCE_SCHEMA_VERSION);
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

  it('标题引用未参与分析的图片时拒绝', async () => {
    const { workspace, asset } = await fixture();
    const invalid = payload(asset.id);
    invalid.plan.collage.titleOptions[0].evidenceAssetIds = [
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ];
    analyzeMock.mockResolvedValue(invalid);
    await expect(analyzeWorkspace(workspace.id, [asset.id])).rejects.toThrow(/未参与分析/);
  });

  it('标题只由 reference 图片支持时拒绝，但 reference 仍可作为显式分析输入', async () => {
    const { workspace, asset } = await fixture();
    const buffer = await sharp({
      create: { width: 20, height: 10, channels: 3, background: '#eeeeee' },
    }).png().toBuffer();
    const reference = await saveAsset(workspace.id, {
      buffer,
      name: 'reference.png',
      mimeType: 'image/png',
    });
    await setAssetRole(workspace.id, reference.id, 'reference');
    const invalid = payload(asset.id);
    invalid.analysis.assetObservations.push({
      assetId: reference.id,
      suggestedRole: 'reference',
      quality: 'usable',
      note: '仅作为视觉参考',
    });
    invalid.plan.collage.titleOptions[0].evidenceAssetIds = [reference.id];
    analyzeMock.mockResolvedValue(invalid);
    await expect(
      analyzeWorkspace(workspace.id, [asset.id, reference.id]),
    ).rejects.toThrow(/参考图/);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
  });

  it('标题超过 60 字或卖点超过 40 字时拒绝', async () => {
    const { workspace, asset } = await fixture();
    const longTitle = payload(asset.id);
    longTitle.plan.collage.titleOptions[0].text = '题'.repeat(61);
    analyzeMock.mockResolvedValueOnce(longTitle);
    await expect(analyzeWorkspace(workspace.id, [asset.id])).rejects.toThrow(/结构化/);

    const longPoint = payload(asset.id);
    longPoint.plan.collage.sellingPoints[0].text = '卖'.repeat(41);
    analyzeMock.mockResolvedValueOnce(longPoint);
    await expect(analyzeWorkspace(workspace.id, [asset.id])).rejects.toThrow(/结构化/);
  });

  it('旧无版本记录返回 null，标记为 v2 的损坏记录仍报错', async () => {
    const { workspace, asset } = await fixture();
    const file = workspaceRuntimePath(workspace.id, 'intelligence.json');
    await writeJson(file, {
      ...payload(asset.id),
      analyzedAt: '2026-08-25T00:00:00.000Z',
      assetSnapshot: [{ id: asset.id, role: 'front' }],
    });
    await expect(getWorkspaceIntelligence(workspace.id)).resolves.toBeNull();

    await writeJson(file, { schemaVersion: 2, broken: true });
    await expect(getWorkspaceIntelligence(workspace.id)).rejects.toThrow(/损坏/);
  });

  it('失败的重新分析不会覆盖上一份有效 v2 记录', async () => {
    const { workspace, asset } = await fixture();
    analyzeMock.mockResolvedValueOnce(payload(asset.id));
    const previous = await analyzeWorkspace(workspace.id, [asset.id]);

    const invalid = payload(asset.id);
    invalid.plan.collage.titleOptions[0].evidenceAssetIds = [
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ];
    analyzeMock.mockResolvedValueOnce(invalid);
    await expect(analyzeWorkspace(workspace.id, [asset.id])).rejects.toThrow(/未参与分析/);
    await expect(getWorkspaceIntelligence(workspace.id)).resolves.toEqual(previous);
  });
});

describe('商品理解契约与新鲜度', () => {
  const assetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const record = ProductIntelligenceRecordSchema.parse({
    ...payload(assetId),
    schemaVersion: PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
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
