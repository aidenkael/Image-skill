import path from 'node:path';
import { CreateTaskRequest, HeroTaskOptions } from '@/core/tasks';
import { TaskResult, taskOutputUrl } from '@/core/results';
import { assetFile, listAssets } from '@/server/assets/service';
import { runHeroWorkflow } from '@/server/hero-workflow';
import { getWorkspaceIntelligence } from '@/server/intelligence/service';
import { ensureDir } from '@/server/storage/fs-store';
import { makeVisionPreview } from '@/server/image/sharp';
import { getWorkspace } from '@/server/workspaces/service';

/**
 * 氛围主图（hero）任务执行入口。
 * 只负责读取输入、调用通用氛围主图工作流、写任务输出；
 * 策划 / 执行 / 审片逻辑在 src/server/hero-workflow。
 */
export async function runHeroTask(
  workspaceId: string,
  request: CreateTaskRequest,
  taskId: string,
): Promise<TaskResult> {
  const opts = request.options as HeroTaskOptions;
  const source = await assetFile(workspaceId, opts.sourceAssetId, 'original');
  if (!source) throw new Error('源商品图片不存在或已被删除');

  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new Error('商品工作区不存在');
  const assets = await listAssets(workspaceId);
  const sourceAsset = assets.find((asset) => asset.id === opts.sourceAssetId);
  if (!sourceAsset) throw new Error('源商品图片不存在或已被删除');
  const intelligence = await getWorkspaceIntelligence(workspaceId);

  const outDir = await ensureDir('workspaces', workspaceId, 'outputs', taskId);
  const outcome = await runHeroWorkflow(
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
    { intelligence, assets },
    outDir,
  );

  const outputs: TaskResult['outputs'] = outcome.candidates.map((candidate) => ({
    kind: 'image',
    url: taskOutputUrl(workspaceId, taskId, path.basename(candidate.localPath)),
  }));
  return { outputs };
}
