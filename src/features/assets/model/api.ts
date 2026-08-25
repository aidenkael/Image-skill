'use client';

import type { AssetRef } from '@/core/assets';

/**
 * 资源 API 客户端。
 */

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败 HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function listAssets(workspaceId: string): Promise<AssetRef[]> {
  const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/assets`;
  return (await json<{ assets: AssetRef[] }>(await fetch(url))).assets;
}

export async function uploadAssets(workspaceId: string, files: File[]): Promise<AssetRef[]> {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/assets`, {
    method: 'POST',
    body: form,
  });
  return (await json<{ assets: AssetRef[] }>(res)).assets;
}

export async function patchAssetRole(
  workspaceId: string,
  id: string,
  role: AssetRef['role'],
): Promise<AssetRef> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/assets/${encodeURIComponent(id)}`,
    {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role }),
    },
  );
  return (await json<{ asset: AssetRef }>(res)).asset;
}
