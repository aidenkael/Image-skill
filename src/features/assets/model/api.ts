'use client';

import type { AssetRef } from '@/core/assets';
import { fetchJson } from '@/features/shared/http';

/**
 * 资源 API 客户端。
 */

export async function listAssets(workspaceId: string): Promise<AssetRef[]> {
  const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/assets`;
  return (await fetchJson<{ assets: AssetRef[] }>(url)).assets;
}

export async function uploadAssets(
  workspaceId: string,
  files: File[],
): Promise<{ assets: AssetRef[]; createdIds: string[] }> {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  return fetchJson<{ assets: AssetRef[]; createdIds: string[] }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/assets`, {
    method: 'POST',
    body: form,
    },
  );
}

export async function patchAssetRole(
  workspaceId: string,
  id: string,
  role: AssetRef['role'],
): Promise<AssetRef[]> {
  return (await fetchJson<{ assets: AssetRef[] }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(id)}`,
    {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
    },
  )).assets;
}

export async function removeAsset(workspaceId: string, id: string): Promise<AssetRef[]> {
  return (await fetchJson<{ assets: AssetRef[] }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )).assets;
}
