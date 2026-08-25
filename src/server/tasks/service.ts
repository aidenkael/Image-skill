import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  CreateTaskRequest,
  TaskRecord,
  TaskRecordSchema,
  TaskValidationError,
  validateCreateTaskRequest,
} from '@/core/tasks';
import { TaskResult, TaskResultSchema } from '@/core/results';
import { COLLAGE_TEMPLATE_IDS } from '@/core/templates';
import { runHeroTask } from './hero';
import { runCollageTask } from './collage';
import { runOptimizeTask } from './optimize';
import { readJson, UUID_RE, writeJson } from '@/server/storage/fs-store';
import { workspaceRuntimePath } from '@/server/workspaces/service';
import { getAsset } from '@/server/assets/service';

/**
 * 任务服务：单条任务的通用入口（未来批量调用方复用同一契约）。
 * V1 同步执行，无队列。
 */

function taskFile(workspaceId: string, id: string): string {
  if (!UUID_RE.test(id)) throw new TaskValidationError(`非法任务 id: ${id}`);
  return workspaceRuntimePath(workspaceId, 'tasks', `${id}.json`);
}

/** 读取历史任务时按当前客户端结果契约清洗，避免旧 localPath 透传到 API。 */
function clientSafeTaskRecord(record: TaskRecord): TaskRecord {
  if (!record.result) return record;
  const result = TaskResultSchema.safeParse(record.result);
  return { ...record, result: result.success ? result.data : undefined };
}

export async function createTask(workspaceId: string, raw: unknown): Promise<TaskRecord> {
  const request = validateCreateTaskRequest(raw, {
    availableCollageTemplates: COLLAGE_TEMPLATE_IDS,
  });

  for (const assetId of request.assetIds) {
    const asset = await getAsset(workspaceId, assetId);
    if (!asset) {
      throw new TaskValidationError(`任务引用了不属于当前商品的图片: ${assetId}`);
    }
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const record: TaskRecord = {
    id,
    workspaceId,
    request,
    status: 'running',
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(taskFile(workspaceId, id), record);

  try {
    let result: TaskResult;
    switch (request.kind) {
      case 'hero':
        result = await runHeroTask(workspaceId, request, id);
        break;
      case 'collage':
        result = await runCollageTask(request);
        break;
      case 'optimize':
        result = await runOptimizeTask(workspaceId, request, id);
        break;
      default:
        throw new TaskValidationError('当前任务类型不可执行');
    }
    record.status = 'succeeded';
    record.result = result;
  } catch (err) {
    record.status = 'failed';
    record.error = err instanceof Error ? err.message : String(err);
  }
  record.updatedAt = new Date().toISOString();
  await writeJson(taskFile(workspaceId, id), record);
  return record;
}

export async function getTask(workspaceId: string, id: string): Promise<TaskRecord | null> {
  const parsed = TaskRecordSchema.safeParse(await readJson<unknown>(taskFile(workspaceId, id)));
  return parsed.success ? clientSafeTaskRecord(parsed.data) : null;
}

export async function listTasks(workspaceId: string): Promise<TaskRecord[]> {
  const dir = workspaceRuntimePath(workspaceId, 'tasks');
  const names = await fs.readdir(dir).catch(() => []);
  const tasks: TaskRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const parsed = TaskRecordSchema.safeParse(
      await readJson<unknown>(workspaceRuntimePath(workspaceId, 'tasks', name)),
    );
    if (parsed.success && parsed.data.workspaceId === workspaceId) {
      tasks.push(clientSafeTaskRecord(parsed.data));
    }
  }
  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export { TaskValidationError };
