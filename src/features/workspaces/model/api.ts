'use client';

import type { Workspace, WorkspaceDraft } from '@/core/workspaces';
import { fetchJson } from '@/features/shared/http';

export async function listWorkspaces(): Promise<Workspace[]> {
  return (await fetchJson<{ workspaces: Workspace[] }>('/api/workspaces')).workspaces;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  return (await fetchJson<{ workspace: Workspace }>('/api/workspaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })).workspace;
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await fetchJson<{ deleted: true }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}`,
    { method: 'DELETE' },
  );
}

export async function getWorkspaceDraft(workspaceId: string): Promise<WorkspaceDraft> {
  return (await fetchJson<{ draft: WorkspaceDraft }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/draft`,
  )).draft;
}

export async function saveWorkspaceDraft(
  workspaceId: string,
  draft: WorkspaceDraft,
): Promise<WorkspaceDraft> {
  return (await fetchJson<{ draft: WorkspaceDraft }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(draft),
    },
  )).draft;
}
