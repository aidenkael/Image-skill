'use client';

import type { CreateTaskRequest, TaskRecord } from '@/core/tasks';

/**
 * 工作台级任务 API 客户端（hero / collage 共用）。
 */

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败 HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listTasks(): Promise<TaskRecord[]> {
  return (await json<{ tasks: TaskRecord[] }>(await fetch('/api/tasks'))).tasks;
}

export async function createTask(request: CreateTaskRequest): Promise<TaskRecord> {
  const res = await fetch('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return (await json<{ task: TaskRecord }>(res)).task;
}
