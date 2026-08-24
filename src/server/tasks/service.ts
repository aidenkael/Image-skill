import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  CreateTaskRequest,
  TaskRecord,
  TaskValidationError,
  validateCreateTaskRequest,
} from '@/core/tasks';
import { TaskResult } from '@/core/results';
import { COLLAGE_TEMPLATE_IDS } from '@/core/templates';
import { runHeroTask } from './hero';
import { runCollageTask } from './collage';
import { runtimePath, writeJson, readJson } from '@/server/storage/fs-store';

/**
 * 任务服务：单条任务的通用入口（未来批量调用方复用同一契约）。
 * V1 同步执行，无队列。
 */

function taskFile(id: string): string {
  return runtimePath('tasks', `${id}.json`);
}

export async function createTask(raw: unknown): Promise<TaskRecord> {
  const request = validateCreateTaskRequest(raw, {
    availableCollageTemplates: COLLAGE_TEMPLATE_IDS,
  });

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const record: TaskRecord = { id, request, status: 'running', createdAt: now, updatedAt: now };
  await writeJson(taskFile(id), record);

  try {
    const result: TaskResult =
      request.kind === 'hero'
        ? await runHeroTask(request, id)
        : await runCollageTask(request);
    record.status = 'succeeded';
    record.result = result;
  } catch (err) {
    record.status = 'failed';
    record.error = err instanceof Error ? err.message : String(err);
  }
  record.updatedAt = new Date().toISOString();
  await writeJson(taskFile(id), record);
  return record;
}

export async function getTask(id: string): Promise<TaskRecord | null> {
  return readJson<TaskRecord>(taskFile(id));
}

export async function listTasks(): Promise<TaskRecord[]> {
  const dir = runtimePath('tasks');
  const names = await fs.readdir(dir).catch(() => []);
  const tasks: TaskRecord[] = [];
  for (const name of names) {
    if (!name.endsWith('.json')) continue;
    const task = await readJson<TaskRecord>(runtimePath('tasks', name));
    if (task) tasks.push(task);
  }
  return tasks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export { TaskValidationError };
