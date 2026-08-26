'use client';

import type { CreateTaskRequest, TaskRecord } from '@/core/tasks';
import { fetchJson } from '@/features/shared/http';

/**
 * 工作台级任务 API 客户端（hero / collage 共用）。
 */

export async function listTasks(workspaceId: string): Promise<TaskRecord[]> {
  const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks`;
  return (await fetchJson<{ tasks: TaskRecord[] }>(url)).tasks;
}

export async function getTask(workspaceId: string, taskId: string): Promise<TaskRecord> {
  const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks/${encodeURIComponent(taskId)}`;
  return (await fetchJson<{ task: TaskRecord }>(url)).task;
}

export async function createTask(
  workspaceId: string,
  request: CreateTaskRequest,
): Promise<TaskRecord> {
  return (await fetchJson<{ task: TaskRecord }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    },
  )).task;
}
