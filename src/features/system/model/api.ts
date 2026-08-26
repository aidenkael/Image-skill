'use client';

import type {
  AIConnectionCapability,
  AIProfileInput,
  AISettingsPublic,
  ActiveAIProfilesInput,
} from '@/core/system';
import { fetchJson } from '@/features/shared/http';

const SETTINGS_URL = '/api/system/ai-settings';

export function getAISettings(): Promise<AISettingsPublic> {
  return fetchJson<AISettingsPublic>(SETTINGS_URL);
}

export function createAIProfile(input: AIProfileInput): Promise<AISettingsPublic> {
  return fetchJson<AISettingsPublic>(SETTINGS_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

export function updateAIProfile(profileId: string, input: AIProfileInput): Promise<AISettingsPublic> {
  return fetchJson<AISettingsPublic>(`${SETTINGS_URL}/${profileId}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

export function deleteAIProfile(profileId: string): Promise<AISettingsPublic> {
  return fetchJson<AISettingsPublic>(`${SETTINGS_URL}/${profileId}`, { method: 'DELETE' });
}

export function setActiveAIProfiles(input: ActiveAIProfilesInput): Promise<AISettingsPublic> {
  return fetchJson<AISettingsPublic>(SETTINGS_URL, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
}

export function testAIProfile(profileId: string, capability: AIConnectionCapability) {
  return fetchJson<{ ok: true; message: string }>(`${SETTINGS_URL}/${profileId}/test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capability }),
  });
}
