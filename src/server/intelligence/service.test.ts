import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { analyzeMock } = vi.hoisted(() => ({ analyzeMock: vi.fn() }));
vi.mock('@/server/providers/factory', () => ({
  createActiveVisionProvider: async () => ({ analyze: (...args: unknown[]) => analyzeMock(...args), planHero: vi.fn() }),
}));

import { saveAsset, setAssetRole } from '@/server/assets/service';
import { createWorkspace, workspaceRuntimePath } from '@/server/workspaces/service';
import {
  analyzeWorkspace,
  getWorkspaceIntelligence,
  getWorkspaceIntelligenceRun,
  IntelligenceConflictError,
} from './service';
import {
  isIntelligenceFresh,
  ProductIntelligenceRecordSchema,
  PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
} from '@/core/intelligence';
import type { AssetRef } from '@/core/assets';
import { readJson, writeJson } from '@/server/storage/fs-store';

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
      heroConcepts: [{
        id: 'hero-1',
        title: '晨间故事',
        recommendedSourceAssetId: assetId,
        creativeBrief: '用晨间使用瞬间建立温暖氛围',
        prompt: 'A warm morning ritual with commercial storytelling.',
        reason: '突出商品日常吸引力',
      }],
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
  return { workspace, asset: { ...asset, role: 'primary' as const } };
}

describe('商品理解服务校验与原子持久化', () => {
  it('一次用户动作只调用一次 Provider，校验成功后按 Workspace 持久化', async () => {
    const { workspace, asset } = await fixture();
    analyzeMock.mockResolvedValue(payload(asset.id));
    const result = await analyzeWorkspace(workspace.id, [asset.id]);
    expect(analyzeMock).toHaveBeenCalledTimes(1);
    expect(result.intelligence.schemaVersion).toBe(PRODUCT_INTELLIGENCE_SCHEMA_VERSION);
    expect(result.intelligence.assetSnapshot).toEqual([{ id: asset.id, role: 'primary' }]);
    expect(result.run.status).toBe('succeeded');
    await expect(getWorkspaceIntelligence(workspace.id)).resolves.toEqual(result.intelligence);
    await expect(getWorkspaceIntelligenceRun(workspace.id)).resolves.toEqual(result.run);
  });

  it('拒绝外部证据 id，失败时不写 intelligence.json', async () => {
    const { workspace, asset } = await fixture();
    analyzeMock.mockResolvedValue(payload('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    await expect(analyzeWorkspace(workspace.id, [asset.id])).rejects.toThrow(/未参与分析/);
    await expect(fs.access(workspaceRuntimePath(workspace.id, 'intelligence.json'))).rejects.toThrow();
  });

  it('参考图不能成为 Hero 源方向', async () => {
    const { workspace, asset } = await fixture();
    const primary = await saveAsset(workspace.id, {
      buffer: await sharp({ create: { width: 10, height: 10, channels: 3, background: '#dddddd' } }).png().toBuffer(),
      name: 'primary.png',
      mimeType: 'image/png',
    });
    await setAssetRole(workspace.id, primary.id, 'primary');
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

  it('旧无版本与 v2 记录均返回 null，必须重新分析', async () => {
    const { workspace, asset } = await fixture();
    const file = workspaceRuntimePath(workspace.id, 'intelligence.json');
    await writeJson(file, {
      ...payload(asset.id),
      analyzedAt: '2026-08-25T00:00:00.000Z',
      assetSnapshot: [{ id: asset.id, role: 'front' }],
    });
    await expect(getWorkspaceIntelligence(workspace.id)).resolves.toBeNull();

    await writeJson(file, { schemaVersion: 2, broken: true });
    await expect(getWorkspaceIntelligence(workspace.id)).resolves.toBeNull();
  });

  it('失败的重新分析不会覆盖上一份有效 v3 记录，运行状态记为失败', async () => {
    const { workspace, asset } = await fixture();
    analyzeMock.mockResolvedValueOnce(payload(asset.id));
    const previous = await analyzeWorkspace(workspace.id, [asset.id]);

    const invalid = payload(asset.id);
    invalid.plan.collage.titleOptions[0].evidenceAssetIds = [
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ];
    analyzeMock.mockResolvedValueOnce(invalid);
    await expect(analyzeWorkspace(workspace.id, [asset.id])).rejects.toThrow(/未参与分析/);
    await expect(getWorkspaceIntelligence(workspace.id)).resolves.toEqual(previous.intelligence);
    await expect(getWorkspaceIntelligenceRun(workspace.id)).resolves.toMatchObject({
      status: 'failed',
      error: expect.stringMatching(/未参与分析/),
    });
  });

  it('先写 running 再调用 Provider，并拒绝同 Workspace 重复分析', async () => {
    const { workspace, asset } = await fixture();
    let resolveProvider!: (value: ReturnType<typeof payload>) => void;
    const providerResult = new Promise<ReturnType<typeof payload>>((resolve) => {
      resolveProvider = resolve;
    });
    analyzeMock.mockImplementation(async () => {
      const persisted = await readJson<{ status: string }>(
        workspaceRuntimePath(workspace.id, 'intelligence-run.json'),
      );
      expect(persisted?.status).toBe('running');
      return providerResult;
    });
    const first = analyzeWorkspace(workspace.id, [asset.id]);
    await vi.waitFor(() => expect(analyzeMock).toHaveBeenCalledTimes(1));
    await expect(analyzeWorkspace(workspace.id, [asset.id])).rejects.toThrow(
      IntelligenceConflictError,
    );
    resolveProvider(payload(asset.id));
    await expect(first).resolves.toMatchObject({ run: { status: 'succeeded' } });
    expect(analyzeMock).toHaveBeenCalledTimes(1);
  });

  it('分析期间素材角色变化会拒绝持久化无效结果', async () => {
    const { workspace, asset } = await fixture();
    let resolveProvider!: (value: ReturnType<typeof payload>) => void;
    analyzeMock.mockReturnValue(new Promise((resolve) => { resolveProvider = resolve; }));
    const pending = analyzeWorkspace(workspace.id, [asset.id]);
    await vi.waitFor(() => expect(analyzeMock).toHaveBeenCalledTimes(1));
    const replacement = await saveAsset(workspace.id, {
      buffer: await sharp({ create: { width: 10, height: 10, channels: 3, background: '#cccccc' } }).png().toBuffer(),
      name: 'replacement.png',
      mimeType: 'image/png',
    });
    await setAssetRole(workspace.id, replacement.id, 'primary');
    await setAssetRole(workspace.id, asset.id, 'detail');
    resolveProvider(payload(asset.id));
    await expect(pending).rejects.toThrow(/分析期间商品素材已变化/);
    await expect(getWorkspaceIntelligence(workspace.id)).resolves.toBeNull();
  });

  it('超过五分钟的 running 分析恢复为失败', async () => {
    const { workspace, asset } = await fixture();
    const old = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    await writeJson(workspaceRuntimePath(workspace.id, 'intelligence-run.json'), {
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      workspaceId: workspace.id,
      assetIds: [asset.id],
      status: 'running',
      startedAt: old,
      updatedAt: old,
    });
    await expect(getWorkspaceIntelligenceRun(workspace.id)).resolves.toMatchObject({
      status: 'failed',
      error: '上次商品分析已中断，请重新分析',
    });
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
    expect(record.plan.heroConcepts[0].id).toBe('hero-1');
    expect(isIntelligenceFresh(record, [assetRef()])).toBe(true);
    expect(isIntelligenceFresh(record, [])).toBe(false);
    expect(isIntelligenceFresh(record, [assetRef('detail')])).toBe(false);
    expect(isIntelligenceFresh(record, [assetRef(), { ...assetRef(), id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }])).toBe(true);
  });
});
