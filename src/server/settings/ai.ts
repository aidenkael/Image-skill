import fs from 'node:fs/promises';
import { z } from 'zod';
import {
  AI_CONFIG_PROVIDER,
  AI_IMAGE_MODEL,
  AI_VISION_MODEL,
  AISettingsStatusSchema,
  type AISettingsStatus,
} from '@/core/system';
import { readJson, runtimePath, writeJson } from '@/server/storage/fs-store';

const RuntimeAISettingsSchema = z.object({
  apiKey: z.string().trim().min(8).max(500),
});

const settingsFile = () => runtimePath('settings', 'ai.json');

export class AISettingsValidationError extends Error {}

export interface ResolvedAICredential {
  apiKey: string;
  source: 'runtime' | 'environment';
}

export async function resolveAICredential(): Promise<ResolvedAICredential | null> {
  const runtime = RuntimeAISettingsSchema.safeParse(
    await readJson<unknown>(settingsFile()),
  );
  if (runtime.success) return { apiKey: runtime.data.apiKey, source: 'runtime' };
  const environment = process.env.DASHSCOPE_API_KEY?.trim();
  return environment ? { apiKey: environment, source: 'environment' } : null;
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}****${apiKey.slice(-2)}`;
  return `${apiKey.slice(0, 5)}****${apiKey.slice(-4)}`;
}

export async function getAISettingsStatus(): Promise<AISettingsStatus> {
  const credential = await resolveAICredential();
  return AISettingsStatusSchema.parse({
    configured: Boolean(credential),
    source: credential?.source ?? 'none',
    maskedKey: credential ? maskApiKey(credential.apiKey) : null,
    provider: AI_CONFIG_PROVIDER,
    visionModel: AI_VISION_MODEL,
    imageModel: AI_IMAGE_MODEL,
  });
}

export async function saveRuntimeAIKey(rawKey: unknown): Promise<AISettingsStatus> {
  const parsed = RuntimeAISettingsSchema.safeParse({ apiKey: rawKey });
  if (!parsed.success) throw new AISettingsValidationError('请输入有效的 DashScope API Key');
  await writeJson(settingsFile(), parsed.data);
  return getAISettingsStatus();
}

export async function clearRuntimeAIKey(): Promise<AISettingsStatus> {
  await fs.rm(settingsFile(), { force: true });
  return getAISettingsStatus();
}
