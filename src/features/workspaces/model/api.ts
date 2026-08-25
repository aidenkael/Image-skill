'use client';

import type { Workspace, WorkspaceDraft } from '@/core/workspaces';

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败 HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const response = await fetch('/api/workspaces');
  return (await json<{ workspaces: Workspace[] }>(response)).workspaces;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const response = await fetch('/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return (await json<{ workspace: Workspace }>(response)).workspace;
}

export async function getWorkspaceDraft(workspaceId: string): Promise<WorkspaceDraft> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/draft`);
  return (await json<{ draft: WorkspaceDraft }>(response)).draft;
}

export async function saveWorkspaceDraft(
  workspaceId: string,
  draft: WorkspaceDraft,
): Promise<WorkspaceDraft> {
  const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
  });
  return (await json<{ draft: WorkspaceDraft }>(response)).draft;
}
