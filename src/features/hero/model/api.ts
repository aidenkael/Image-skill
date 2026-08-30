'use client';

import type { HeroPlanRecord } from '@/core/hero-workflow';
import { fetchJson } from '@/features/shared/http';

export interface HeroPlanRequest {
  sourceAssetId: string;
  ratio: '1:1' | '3:4' | '4:3';
  creativeMode: 'recommended' | 'custom';
  creativeIntent?: string;
  humanPresence: 'auto' | 'avoid' | 'require';
  creativeLevel: 'conservative' | 'balanced' | 'creative';
}

export async function getHeroPlan(workspaceId: string): Promise<HeroPlanRecord | null> {
  const result = await fetchJson<{ record: HeroPlanRecord | null }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/hero/plan`,
  );
  return result.record;
}

export async function createHeroPlan(
  workspaceId: string,
  request: HeroPlanRequest,
): Promise<HeroPlanRecord> {
  const result = await fetchJson<{ record: HeroPlanRecord }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/hero/plan`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    },
  );
  return result.record;
}
