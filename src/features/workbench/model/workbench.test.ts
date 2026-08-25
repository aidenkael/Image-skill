import { describe, expect, it } from 'vitest';
import type { TaskRecord } from '@/core/tasks';
import { DEFAULT_WORKSPACE_DRAFT, WorkspaceDraftSchema } from '@/core/workspaces';
import { heroRunStatePatch } from './workbench';

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
      options: { sourceAssetId: 'asset-1', ratio: '1:1', person: 'auto', sceneMode: 'auto' },
    },
    status,
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:01.000Z',
    ...extra,
  };
}

const SUCCEEDED_ID = '11111111-1111-4111-8111-111111111111';
const FAILED_ID = '22222222-2222-4222-8222-222222222222';

describe('Workspace 三任务草稿契约', () => {
  it('允许尚未选择源图的 Optimize 默认草稿并保留恢复字段', () => {
    expect(DEFAULT_WORKSPACE_DRAFT.heroOptions.directionId).toBeUndefined();
    expect(DEFAULT_WORKSPACE_DRAFT.optimizeOptions).toMatchObject({
      sourceAssetId: '', ratio: 'original', format: 'jpg',
    });
    expect(DEFAULT_WORKSPACE_DRAFT.latestOptimizeTaskId).toBeNull();
    expect(WorkspaceDraftSchema.parse({ ...DEFAULT_WORKSPACE_DRAFT })).toEqual(DEFAULT_WORKSPACE_DRAFT);
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
