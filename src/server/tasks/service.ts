import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  type CreateTaskRequest,
  type TaskRecord,
  TaskRecordSchema,
  TaskValidationError,
  validateCreateTaskRequest,
} from '@/core/tasks';
import { type TaskResult, TaskResultSchema } from '@/core/results';
import { COLLAGE_TEMPLATE_IDS } from '@/core/templates';
import { runHeroTask } from './hero';
import { runCollageTask } from './collage';
import { runOptimizeTask } from './optimize';
import { readJson, UUID_RE, writeJson } from '@/server/storage/fs-store';
import { workspaceRuntimePath } from '@/server/workspaces/service';
import { getAsset } from '@/server/assets/service';

const STALE_HERO_MS = 15 * 60 * 1000;
const heroInFlightWorkspaces = new Map<string, string[]>();

export class TaskConflictError extends Error {}

export function getInFlightHeroAssetIds(workspaceId: string): readonly string[] {
  return heroInFlightWorkspaces.get(workspaceId) ?? [];
}

function taskFile(workspaceId: string, id: string): string {
  if (!UUID_RE.test(id)) throw new TaskValidationError(`非法任务 id: ${id}`);
  return workspaceRuntimePath(workspaceId, 'tasks', `${id}.json`);
}

function clientSafeTaskRecord(record: TaskRecord): TaskRecord {
  if (!record.result) return record;
  const result = TaskResultSchema.safeParse(record.result);
  return { ...record, result: result.success ? result.data : undefined };
}

async function reconcileTask(record: TaskRecord): Promise<TaskRecord> {
  if (
    record.request.kind === 'hero' &&
    record.status === 'running' &&
    Date.now() - new Date(record.updatedAt).getTime() > STALE_HERO_MS
  ) {
    const recovered = TaskRecordSchema.parse({
      ...record,
      status: 'failed',
      error: '上次生成任务已中断，请重新生成',
      updatedAt: new Date().toISOString(),
    });
    await writeJson(taskFile(record.workspaceId, record.id), recovered);
    return recovered;
  }
  return record;
}

async function executeTask(
  workspaceId: string,
  request: CreateTaskRequest,
  id: string,
): Promise<TaskResult> {
  switch (request.kind) {
    case 'hero':
      return runHeroTask(workspaceId, request, id);
    case 'collage':
      return runCollageTask(request);
    case 'optimize':
      return runOptimizeTask(workspaceId, request, id);
    default:
      throw new TaskValidationError('当前任务类型不可执行');
  }
}

export async function createTask(workspaceId: string, raw: unknown): Promise<TaskRecord> {
  const request = validateCreateTaskRequest(raw, {
    availableCollageTemplates: COLLAGE_TEMPLATE_IDS,
  });
  const isHero = request.kind === 'hero';
  if (isHero) {
    if (heroInFlightWorkspaces.has(workspaceId)) {
      throw new TaskConflictError('当前商品已有氛围主图正在生成，请等待完成');
    }
    heroInFlightWorkspaces.set(workspaceId, request.assetIds);
  }

  try {
    for (const assetId of request.assetIds) {
      const asset = await getAsset(workspaceId, assetId);
      if (!asset) {
        throw new TaskValidationError(`任务引用了不属于当前商品的图片: ${assetId}`);
      }
      if (asset.role === 'reference') {
        throw new TaskValidationError(`参考图仅用于视觉参考，不能作为任务商品素材: ${assetId}`);
      }
    }

    if (isHero) {
      const existing = (await listTasks(workspaceId)).find(
        (task) => task.request.kind === 'hero' && task.status === 'running',
      );
      if (existing) {
        throw new TaskConflictError('当前商品已有氛围主图正在生成，请等待完成');
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
      record.result = await executeTask(workspaceId, request, id);
      record.status = 'succeeded';
    } catch (error) {
      record.status = 'failed';
      record.error = error instanceof Error ? error.message : String(error);
    }
    record.updatedAt = new Date().toISOString();
    await writeJson(taskFile(workspaceId, id), record);
    return clientSafeTaskRecord(record);
  } finally {
    if (isHero) heroInFlightWorkspaces.delete(workspaceId);
  }
}

export async function getTask(workspaceId: string, id: string): Promise<TaskRecord | null> {
  const parsed = TaskRecordSchema.safeParse(await readJson<unknown>(taskFile(workspaceId, id)));
  if (!parsed.success) return null;
  return clientSafeTaskRecord(await reconcileTask(parsed.data));
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
      tasks.push(clientSafeTaskRecord(await reconcileTask(parsed.data)));
    }
  }
  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export { TaskValidationError };
