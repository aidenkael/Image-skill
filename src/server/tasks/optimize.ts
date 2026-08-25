import fs from 'node:fs/promises';
import path from 'node:path';
import type { CreateTaskRequest, OptimizeTaskOptions } from '@/core/tasks';
import { taskOutputUrl, type TaskResult } from '@/core/results';
import { assetFile } from '@/server/assets/service';
import { optimizeImage } from '@/server/image/sharp';
import { ensureDir } from '@/server/storage/fs-store';

export async function runOptimizeTask(
  workspaceId: string,
  request: CreateTaskRequest,
  taskId: string,
): Promise<TaskResult> {
  const options = request.options as OptimizeTaskOptions;
  const source = await assetFile(workspaceId, options.sourceAssetId, 'original');
  if (!source) throw new Error('源商品图片不存在或已被删除');

  const output = await optimizeImage(source.buffer, options);
  const outputDir = await ensureDir('workspaces', workspaceId, 'outputs', taskId);
  const extension = options.format === 'jpg' ? 'jpg' : options.format;
  const fileName = `optimized.${extension}`;
  await fs.writeFile(path.join(outputDir, fileName), output);
  return {
    outputs: [{ kind: 'image', url: taskOutputUrl(workspaceId, taskId, fileName) }],
  };
}
