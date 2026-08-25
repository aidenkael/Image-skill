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

export async function listTasks(workspaceId: string): Promise<TaskRecord[]> {
  const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks`;
  return (await json<{ tasks: TaskRecord[] }>(await fetch(url))).tasks;
}

export async function createTask(
  workspaceId: string,
  request: CreateTaskRequest,
): Promise<TaskRecord> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  return (await json<{ task: TaskRecord }>(res)).task;
}
