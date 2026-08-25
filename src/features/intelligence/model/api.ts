'use client';

import type { ProductIntelligenceRecord } from '@/core/intelligence';

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败 HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function getProductIntelligence(
  workspaceId: string,
): Promise<ProductIntelligenceRecord | null> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/intelligence`,
  );
  return (await json<{ intelligence: ProductIntelligenceRecord | null }>(response)).intelligence;
}

export async function analyzeProduct(
  workspaceId: string,
  assetIds: string[],
): Promise<ProductIntelligenceRecord> {
  const response = await fetch(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/intelligence`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetIds }),
    },
  );
  return (await json<{ intelligence: ProductIntelligenceRecord }>(response)).intelligence;
}
