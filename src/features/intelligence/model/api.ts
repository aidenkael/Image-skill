'use client';

import type { ProductIntelligenceRecord, ProductIntelligenceRun } from '@/core/intelligence';
import { fetchJson } from '@/features/shared/http';

export interface ProductIntelligenceSnapshot {
  intelligence: ProductIntelligenceRecord | null;
  run: ProductIntelligenceRun | null;
}

export async function getProductIntelligence(
  workspaceId: string,
): Promise<ProductIntelligenceSnapshot> {
  return fetchJson<ProductIntelligenceSnapshot>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/intelligence`,
  );
}

export async function analyzeProduct(
  workspaceId: string,
  assetIds: string[],
): Promise<ProductIntelligenceSnapshot> {
  return fetchJson<ProductIntelligenceSnapshot>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/intelligence`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetIds }),
    },
  );
}
