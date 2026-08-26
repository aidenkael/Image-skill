'use client';

import type { AISettingsStatus } from '@/core/system';
import { fetchJson } from '@/features/shared/http';

export async function getSystemStatus(): Promise<AISettingsStatus> {
  return fetchJson<AISettingsStatus>('/api/system/status');
}

export async function saveAIKey(apiKey: string): Promise<AISettingsStatus> {
  return fetchJson<AISettingsStatus>('/api/system/ai-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
  });
}

export async function clearAIKey(): Promise<AISettingsStatus> {
  return fetchJson<AISettingsStatus>('/api/system/ai-settings', { method: 'DELETE' });
}

export async function testAIConnection(): Promise<{ ok: true; message: string }> {
  return fetchJson<{ ok: true; message: string }>('/api/system/ai-settings', { method: 'POST' });
}
