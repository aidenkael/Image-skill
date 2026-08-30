import { describe, expect, it } from 'vitest';
import type { AssetRef } from '@/core/assets';
import type { TaskRecord } from '@/core/tasks';
import type { TemplateDocument } from '@/core/templates';
import { DEFAULT_WORKSPACE_DRAFT, WorkspaceDraftSchema } from '@/core/workspaces';
import {
  heroRunStatePatch,
  removeAssetFromCollageVariants,
  replaceActiveCollageVariantInList,
  resolveExecutableSourceAssetId,
  resolveActiveCollageVariant,
  restoreSelectedAssetIds,
  sanitizeCollageVariants,
  sourceIdAfterRoleChange,
  OrderedDraftWriter,
} from './workbench';

/**
 * runHero 结果状态一致性回归测试（heroRunStatePatch 为 runHero 完成后的唯一状态决策点）：
 * - 无论成功或失败，返回的任务都成为当前最新 Hero 任务（修复失败任务不更新 latest 的问题）；
 * - latestHeroTaskId 与错误提示指向同一任务（草稿持久化随之更新）；
 * - 陈旧异步结果（活动工作区已切换）不产生任何状态更新。
 */

const WS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WS_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function heroTask(
  id: string,
  status: 'succeeded' | 'failed',
  extra?: Partial<TaskRecord>,
): TaskRecord {
  return {
    id,
    workspaceId: WS_A,
    request: {
      kind: 'hero',
      assetIds: ['asset-1'],
      count: 1,
      options: {
        sourceAssetId: 'asset-1',
        ratio: '1:1',
        creativeMode: 'recommended',
        humanPresence: 'auto',
        creativeLevel: 'balanced',
      },
    },
    status,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:01.000Z',
    ...extra,
  };
}

const SUCCEEDED_ID = '11111111-1111-4111-8111-111111111111';
const FAILED_ID = '22222222-2222-4222-8222-222222222222';
const SOURCE_ID = '33333333-3333-4333-8333-333333333333';

function asset(role: AssetRef['role']): AssetRef {
  return {
    id: SOURCE_ID,
    name: 'source.png',
    mimeType: 'image/png',
    width: 100,
    height: 100,
    role,
    createdAt: '2026-08-25T00:00:00.000Z',
  };
}

function collageAsset(id: string, role: AssetRef['role']): AssetRef {
  return { ...asset(role), id, name: `${id}.png` };
}

function collageDoc(name: string, assetId: string | null): TemplateDocument {
  return {
    id: 'four-grid',
    name,
    width: 800,
    height: 800,
    layers: [
      {
        type: 'image', id: `${name}-image`, x: 0, y: 0, width: 400, height: 400,
        fit: 'cover', slotIndex: 0, assetId,
        ...(assetId ? { contentTransform: { left: 1, top: 2, scaleX: 1.1, scaleY: 1.2 } } : {}),
      },
      {
        type: 'text', id: `${name}-text`, x: 0, y: 420, width: 400,
        text: `${name} 用户文案`, fontSize: 32,
      },
    ],
  };
}

describe('Workspace 三任务草稿契约', () => {
  it('允许尚未选择源图的 Optimize 默认草稿并保留恢复字段', () => {
    expect(DEFAULT_WORKSPACE_DRAFT.heroOptions).toMatchObject({
      creativeMode: 'recommended',
      humanPresence: 'auto',
      creativeLevel: 'balanced',
    });
    expect(DEFAULT_WORKSPACE_DRAFT.heroOptions).not.toHaveProperty('conceptId');
    expect(DEFAULT_WORKSPACE_DRAFT.optimizeOptions).toMatchObject({
      sourceAssetId: '', ratio: 'original', format: 'jpg',
    });
    expect(DEFAULT_WORKSPACE_DRAFT.latestOptimizeTaskId).toBeNull();
    expect(WorkspaceDraftSchema.parse({ ...DEFAULT_WORKSPACE_DRAFT })).toEqual(DEFAULT_WORKSPACE_DRAFT);
  });

  it('Hero 新字段（创意程度 / 人物偏好 / 推荐模式）能保存进草稿并回读', () => {
    const draft = WorkspaceDraftSchema.parse({
      heroOptions: {
        sourceAssetId: '', ratio: '3:4', creativeMode: 'recommended',
        creativeIntent: '', humanPresence: 'require', creativeLevel: 'creative',
      },
    });
    expect(draft.heroOptions).toMatchObject({
      ratio: '3:4', humanPresence: 'require', creativeLevel: 'creative',
    });
    expect(WorkspaceDraftSchema.parse(draft)).toEqual(draft);
  });

  it('恢复时 Hero 与 Optimize 均拒绝 reference 源，但全局分析选择保留 reference', () => {
    const reference = asset('reference');
    expect(resolveExecutableSourceAssetId(SOURCE_ID, [reference])).toBe('');
    expect(resolveExecutableSourceAssetId(SOURCE_ID, [asset('front')])).toBe(SOURCE_ID);
    expect(restoreSelectedAssetIds([SOURCE_ID], [reference])).toEqual([SOURCE_ID]);
  });

  it('当前 Hero/Optimize 源改为 reference 时清空，其他角色或其他素材不影响', () => {
    expect(sourceIdAfterRoleChange(SOURCE_ID, SOURCE_ID, 'reference')).toBe('');
    expect(sourceIdAfterRoleChange(SOURCE_ID, SOURCE_ID, 'detail')).toBe(SOURCE_ID);
    expect(
      sourceIdAfterRoleChange(
        SOURCE_ID,
        '44444444-4444-4444-8444-444444444444',
        'reference',
      ),
    ).toBe(SOURCE_ID);
  });

  it('恢复 Collage 草稿时逐方案清除参考图与缺失图，并保留方案数量和文案', () => {
    const variants = [
      collageDoc('有效方案', 'product'),
      collageDoc('参考图方案', 'reference'),
      collageDoc('缺失图方案', 'missing'),
    ];
    const restored = sanitizeCollageVariants(variants, [
      collageAsset('product', 'front'),
      collageAsset('reference', 'reference'),
    ]);

    expect(restored).toHaveLength(3);
    expect(restored[0]).toBe(variants[0]);
    expect(restored[1].layers[0]).toMatchObject({ assetId: null });
    expect(restored[2].layers[0]).toMatchObject({ assetId: null });
    expect(restored.map((doc) => doc.layers[1])).toEqual(
      variants.map((doc) => doc.layers[1]),
    );
    expect(resolveActiveCollageVariant(2, restored)).toBe(2);
    expect(resolveActiveCollageVariant(9, restored)).toBe(2);
    expect(resolveActiveCollageVariant(9, [])).toBe(0);
  });

  it('资产改为 reference 时从所有 Collage 方案移除，但不影响其他图片或方案数', () => {
    const variants = [
      collageDoc('方案一', 'changed'),
      collageDoc('方案二', 'changed'),
      collageDoc('方案三', 'other'),
    ];
    const next = removeAssetFromCollageVariants(variants, 'changed');

    expect(next).toHaveLength(3);
    expect(next[0].layers[0]).toMatchObject({ assetId: null });
    expect(next[1].layers[0]).toMatchObject({ assetId: null });
    expect(next[2]).toBe(variants[2]);
  });

  it('活动方案写入会再次净化，陈旧 Fabric 文档不能放回 reference', () => {
    const variants = [collageDoc('活动方案', 'product'), collageDoc('其他方案', 'other')];
    const staleFabricDoc = collageDoc('陈旧回调', 'product');
    const next = replaceActiveCollageVariantInList(
      variants,
      0,
      staleFabricDoc,
      [collageAsset('product', 'reference'), collageAsset('other', 'detail')],
    );

    expect(next[0].name).toBe('陈旧回调');
    expect(next[0].layers[0]).toMatchObject({ assetId: null });
    expect(next[0].layers[1]).toEqual(staleFabricDoc.layers[1]);
    expect(next[1]).toBe(variants[1]);
  });
});

describe('OrderedDraftWriter', () => {
  it('切换前 flush 保存最后一版，且同 Workspace 异步写入保持顺序', async () => {
    const completed: string[] = [];
    let releaseFirst: () => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const writer = new OrderedDraftWriter(async (draft) => {
      const intent = draft.heroOptions.creativeIntent;
      if (intent === '旧') {
        markStarted();
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      }
      completed.push(intent);
    }, () => undefined, 10_000);
    writer.schedule(WorkspaceDraftSchema.parse({ heroOptions: {
      sourceAssetId: '', ratio: '1:1', creativeMode: 'recommended', creativeIntent: '旧', humanPresence: 'auto', creativeLevel: 'balanced',
    } }));
    const first = writer.flush();
    writer.schedule(WorkspaceDraftSchema.parse({ heroOptions: {
      sourceAssetId: '', ratio: '1:1', creativeMode: 'recommended', creativeIntent: '新', humanPresence: 'auto', creativeLevel: 'balanced',
    } }));
    const second = writer.flush();
    await started;
    releaseFirst();
    await Promise.all([first, second]);
    expect(completed).toEqual(['旧', '新']);
  });
});

describe('heroRunStatePatch：最新 Hero 任务状态一致性', () => {
  it('已有成功任务在状态中时，新的失败任务仍成为最新任务，且错误来自该任务', () => {
    const previousSuccess = heroTask(SUCCEEDED_ID, 'succeeded', {
      result: { outputs: [{ kind: 'image', url: '/api/x/result-01.png' }] },
    });
    const failed = heroTask(FAILED_ID, 'failed', { error: '未配置 DASHSCOPE_API_KEY' });

    // 模拟 runHero 完成：当前最新任务仍是上一次的成功任务，本次返回失败任务
    const patch = heroRunStatePatch(WS_A, WS_A, failed, [failed, previousSuccess]);

    expect(patch).not.toBeNull();
    expect(patch!.latestHeroTask).toBe(failed);
    expect(patch!.latestHeroTaskId).toBe(FAILED_ID);
    expect(patch!.error).toBe('未配置 DASHSCOPE_API_KEY');
    expect(patch!.notice).toBeUndefined();
    expect(patch!.tasks).toEqual([failed, previousSuccess]);
  });

  it('失败任务缺少错误信息时使用默认文案', () => {
    const failed = heroTask(FAILED_ID, 'failed');
    const patch = heroRunStatePatch(WS_A, WS_A, failed, [failed]);
    expect(patch!.latestHeroTaskId).toBe(FAILED_ID);
    expect(patch!.error).toBe('生成失败');
  });

  it('成功任务成为最新任务并给出数量提示，不产生错误', () => {
    const succeeded = heroTask(SUCCEEDED_ID, 'succeeded', {
      result: {
        outputs: [
          { kind: 'image', url: '/api/x/result-01.png' },
          { kind: 'image', url: '/api/x/result-02.png' },
        ],
      },
    });
    const patch = heroRunStatePatch(WS_A, WS_A, succeeded, [succeeded]);
    expect(patch!.latestHeroTask).toBe(succeeded);
    expect(patch!.latestHeroTaskId).toBe(SUCCEEDED_ID);
    expect(patch!.notice).toBe('氛围主图生成完成，共 2 张');
    expect(patch!.error).toBeUndefined();
  });

  it('陈旧异步结果（活动工作区已切换）不产生任何状态更新', () => {
    const failed = heroTask(FAILED_ID, 'failed', { error: 'boom' });
    expect(heroRunStatePatch(WS_B, WS_A, failed, [failed])).toBeNull();
    expect(heroRunStatePatch(null, WS_A, failed, [failed])).toBeNull();
  });
});
