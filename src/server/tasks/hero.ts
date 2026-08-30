import path from 'node:path';
import type { CreateTaskRequest, HeroTaskOptions } from '@/core/tasks';
import type { TaskResult } from '@/core/results';
import { taskOutputUrl } from '@/core/results';
import { assetFile, listAssets } from '@/server/assets/service';
import { createHeroBrief, runHeroWorkflow } from '@/server/hero-workflow';
import type { HeroWorkflowInput } from '@/server/hero-workflow';
import { ensureDir } from '@/server/storage/fs-store';
import { makeVisionPreview } from '@/server/image/sharp';
import { getWorkspace } from '@/server/workspaces/service';

/**
 * 氛围主图（hero）任务执行入口（一键自包含）：
 * 加载源图 → Director 策划 HeroBrief → 生成 → 批量 QA → 至多一次反馈补生 → 输出。
 * 不依赖任何全局持久化方案；brief 由本任务自己持有。
 */
export async function runHeroTask(
  workspaceId: string,
  request: CreateTaskRequest,
  taskId: string,
): Promise<TaskResult> {
  const opts = request.options as HeroTaskOptions;

  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new Error('商品工作区不存在');

  const assets = await listAssets(workspaceId);
  const sourceAsset = assets.find((asset) => asset.id === opts.sourceAssetId);
  if (!sourceAsset) throw new Error('源商品图片不存在或已被删除');
  if (sourceAsset.role === 'reference') {
    throw new Error('参考图不能作为氛围主图商品源图');
  }

  const source = await assetFile(workspaceId, opts.sourceAssetId, 'original');
  if (!source) throw new Error('源商品图片不存在或已被删除');

  const outDir = await ensureDir('workspaces', workspaceId, 'outputs', taskId);
  const input: HeroWorkflowInput = {
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
    creativeIntent: opts.creativeIntent?.trim() || undefined,
  };

  const brief = await createHeroBrief(input);
  const outcome = await runHeroWorkflow(input, brief, outDir);

  const outputs: TaskResult['outputs'] = outcome.candidates.map((candidate) => ({
    kind: 'image',
    url: taskOutputUrl(workspaceId, taskId, path.basename(candidate.localPath)),
  }));
  return { outputs };
}
