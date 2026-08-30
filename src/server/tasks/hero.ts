import path from 'node:path';
import type { CreateTaskRequest, HeroTaskOptions } from '@/core/tasks';
import type { TaskResult } from '@/core/results';
import { taskOutputUrl } from '@/core/results';
import { assetFile, listAssets } from '@/server/assets/service';
import { getHeroPlanRecord, isHeroPlanRecordFresh, runPlannedHeroWorkflow } from '@/server/hero-workflow';
import { ensureDir } from '@/server/storage/fs-store';
import { makeVisionPreview } from '@/server/image/sharp';
import { getWorkspace } from '@/server/workspaces/service';

/**
 * 氛围主图（hero）任务执行入口。
 * 只负责读取输入、加载已策划方案、执行生成与审片、写任务输出。
 * 正式生成阶段禁止再次调用 planHeroV2()。
 */
export async function runHeroTask(
  workspaceId: string,
  request: CreateTaskRequest,
  taskId: string,
): Promise<TaskResult> {
  const opts = request.options as HeroTaskOptions;

  // ── 校验 planId ──
  if (!opts.planId) {
    throw new Error('氛围主图生成需要先获取 AI 方案，请先生成方案');
  }

  const record = await getHeroPlanRecord(workspaceId);
  if (!record) {
    throw new Error('AI 推荐方案已失效，请重新生成方案');
  }
  if (record.id !== opts.planId) {
    throw new Error('AI 推荐方案已失效，请重新生成方案');
  }

  const source = await assetFile(workspaceId, opts.sourceAssetId, 'original');
  if (!source) throw new Error('源商品图片不存在或已被删除');

  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new Error('商品工作区不存在');
  const assets = await listAssets(workspaceId);
  const sourceAsset = assets.find((asset) => asset.id === opts.sourceAssetId);
  if (!sourceAsset) throw new Error('源商品图片不存在或已被删除');

  // ── 再次验证 record fresh ──
  const fresh = isHeroPlanRecordFresh(record, {
    sourceAssetId: opts.sourceAssetId,
    sourceAssetRole: sourceAsset.role,
    ratio: opts.ratio,
    creativeMode: opts.creativeMode,
    creativeIntent: opts.creativeMode === 'custom' ? opts.creativeIntent?.trim() : undefined,
    humanPolicy: opts.humanPresence,
    creativeLevel: opts.creativeLevel,
  }, assets);
  if (!fresh) {
    throw new Error('AI 推荐方案已失效，请重新生成方案');
  }

  const outDir = await ensureDir('workspaces', workspaceId, 'outputs', taskId);
  const outcome = await runPlannedHeroWorkflow(
    {
      workspaceId,
      workspaceName: workspace.name,
      taskId,
      sourceImagePath: source.filePath,
      sourcePreview: await makeVisionPreview(source.buffer),
      sourceAssetId: sourceAsset.id,
      sourceAssetRole: sourceAsset.role,
      ratio: opts.ratio,
      count: request.count,
      humanPolicy: opts.humanPresence,
      creativeLevel: opts.creativeLevel,
      creativeIntent: opts.creativeMode === 'custom' ? opts.creativeIntent!.trim() : undefined,
    },
    record.plan,
    outDir,
  );

  const outputs: TaskResult['outputs'] = outcome.candidates.map((candidate) => ({
    kind: 'image',
    url: taskOutputUrl(workspaceId, taskId, path.basename(candidate.localPath)),
  }));
  return { outputs };
}
