import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { z } from 'zod';
import {
  ActiveAIProfilesInputSchema,
  AIProfileInputSchema,
  AIProfilePublicSchema,
  AISettingsPublicSchema,
  ImageCapabilitySchema,
  LEGACY_ALIYUN_IMAGE_ENDPOINT,
  VisionCapabilitySchema,
  ALIYUN_VISION_ENDPOINT,
  type AIProfileInput,
  type AIProfilePublic,
  type AISettingsPublic,
  type ImageCapability,
  type VisionCapability,
} from '@/core/system';
import { readJson, runtimePath, writeJson } from '@/server/storage/fs-store';

const PersistedAIProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  preset: z.enum(['aliyun-qwen', 'volcengine-ark', 'custom']),
  apiKey: z.string().trim().min(8).max(500),
  vision: VisionCapabilitySchema,
  image: ImageCapabilitySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
const PersistedAISettingsSchema = z.object({
  schemaVersion: z.literal(1),
  profiles: z.array(PersistedAIProfileSchema),
  activeVisionProfileId: z.string().uuid().nullable(),
  activeImageProfileId: z.string().uuid().nullable(),
});
const LegacyAISettingsSchema = z.object({ apiKey: z.string().trim().min(8).max(500) });

type PersistedAIProfile = z.infer<typeof PersistedAIProfileSchema>;
type PersistedAISettings = z.infer<typeof PersistedAISettingsSchema>;

const profileSettingsFile = () => runtimePath('settings', 'ai-profiles.json');
const legacySettingsFile = () => runtimePath('settings', 'ai.json');
let settingsQueue: Promise<unknown> = Promise.resolve();

export class AISettingsValidationError extends Error {}
export class AIProfileNotFoundError extends Error {}

export interface ResolvedVisionConfig extends VisionCapability { profileId: string; apiKey: string }
export interface ResolvedImageConfig extends ImageCapability { profileId: string; apiKey: string }

function validationMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? '配置名称、接口地址或模型不合法';
}

async function fileExists(filePath: string): Promise<boolean> {
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function bootstrapStore(): Promise<PersistedAISettings> {
  const storePath = profileSettingsFile();
  if (await fileExists(storePath)) {
    const parsed = PersistedAISettingsSchema.safeParse(await readJson<unknown>(storePath));
    if (!parsed.success) throw new AISettingsValidationError('AI 配置文件损坏或格式不合法');
    return parsed.data;
  }

  const legacy = LegacyAISettingsSchema.safeParse(await readJson<unknown>(legacySettingsFile()));
  const apiKey = legacy.success ? legacy.data.apiKey : process.env.DASHSCOPE_API_KEY?.trim();
  let store: PersistedAISettings = {
    schemaVersion: 1,
    profiles: [],
    activeVisionProfileId: null,
    activeImageProfileId: null,
  };
  if (apiKey) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    store = {
      schemaVersion: 1,
      profiles: [{
        id,
        name: '现有百炼配置',
        preset: 'aliyun-qwen',
        apiKey,
        vision: {
          enabled: true,
          driver: 'openai-compatible-vision',
          endpoint: process.env.DASHSCOPE_VISION_API_URL?.trim() || ALIYUN_VISION_ENDPOINT,
          model: 'qwen3.7-plus',
        },
        image: {
          enabled: true,
          driver: 'dashscope-qwen-image',
          endpoint: process.env.DASHSCOPE_API_URL?.trim() || LEGACY_ALIYUN_IMAGE_ENDPOINT,
          model: 'qwen-image-3.0-pro',
        },
        createdAt: now,
        updatedAt: now,
      }],
      activeVisionProfileId: id,
      activeImageProfileId: id,
    };
  }
  const parsed = PersistedAISettingsSchema.safeParse(store);
  if (!parsed.success) throw new AISettingsValidationError(validationMessage(parsed.error));
  await writeJson(storePath, parsed.data);
  if (legacy.success) await fs.rm(legacySettingsFile(), { force: true });
  return parsed.data;
}

function serial<T>(operation: () => Promise<T>): Promise<T> {
  const next = settingsQueue.then(operation, operation);
  settingsQueue = next.then(() => undefined, () => undefined);
  return next;
}

function publicProfile(profile: PersistedAIProfile): AIProfilePublic {
  return AIProfilePublicSchema.parse({
    id: profile.id,
    name: profile.name,
    preset: profile.preset,
    maskedKey: maskApiKey(profile.apiKey),
    vision: profile.vision,
    image: profile.image,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  });
}

function publicSettings(store: PersistedAISettings): AISettingsPublic {
  return AISettingsPublicSchema.parse({
    profiles: store.profiles.map(publicProfile),
    activeVisionProfileId: store.activeVisionProfileId,
    activeImageProfileId: store.activeImageProfileId,
  });
}

function parseProfileInput(raw: unknown): AIProfileInput {
  const parsed = AIProfileInputSchema.safeParse(raw);
  if (!parsed.success) throw new AISettingsValidationError(validationMessage(parsed.error));
  return parsed.data;
}

function findProfile(store: PersistedAISettings, profileId: string): PersistedAIProfile {
  const profile = store.profiles.find((item) => item.id === profileId);
  if (!profile) throw new AIProfileNotFoundError('配置不存在');
  return profile;
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return `${apiKey.slice(0, 2)}****${apiKey.slice(-2)}`;
  return `${apiKey.slice(0, 5)}****${apiKey.slice(-4)}`;
}

export async function getAISettingsPublic(): Promise<AISettingsPublic> {
  return publicSettings(await serial(bootstrapStore));
}

export async function createAIProfile(raw: unknown): Promise<AISettingsPublic> {
  return serial(async () => {
    const input = parseProfileInput(raw);
    if (!input.apiKey) throw new AISettingsValidationError('新建配置时必须填写 API Key');
    const store = await bootstrapStore();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const profile = PersistedAIProfileSchema.parse({ ...input, id, createdAt: now, updatedAt: now });
    store.profiles.push(profile);
    if (profile.vision.enabled && store.activeVisionProfileId === null) store.activeVisionProfileId = id;
    if (profile.image.enabled && store.activeImageProfileId === null) store.activeImageProfileId = id;
    await writeJson(profileSettingsFile(), store);
    return publicSettings(store);
  });
}

export async function updateAIProfile(profileId: string, raw: unknown): Promise<AISettingsPublic> {
  return serial(async () => {
    const input = parseProfileInput(raw);
    const store = await bootstrapStore();
    const existing = findProfile(store, profileId);
    const updated = PersistedAIProfileSchema.parse({
      ...existing,
      ...input,
      apiKey: input.apiKey || existing.apiKey,
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    });
    store.profiles[store.profiles.indexOf(existing)] = updated;
    if (!updated.vision.enabled && store.activeVisionProfileId === profileId) store.activeVisionProfileId = null;
    if (!updated.image.enabled && store.activeImageProfileId === profileId) store.activeImageProfileId = null;
    await writeJson(profileSettingsFile(), store);
    return publicSettings(store);
  });
}

export async function deleteAIProfile(profileId: string): Promise<AISettingsPublic> {
  return serial(async () => {
    const store = await bootstrapStore();
    findProfile(store, profileId);
    store.profiles = store.profiles.filter((item) => item.id !== profileId);
    if (store.activeVisionProfileId === profileId) store.activeVisionProfileId = null;
    if (store.activeImageProfileId === profileId) store.activeImageProfileId = null;
    await writeJson(profileSettingsFile(), store);
    return publicSettings(store);
  });
}

export async function setActiveAIProfiles(raw: unknown): Promise<AISettingsPublic> {
  return serial(async () => {
    const parsed = ActiveAIProfilesInputSchema.safeParse(raw);
    if (!parsed.success) throw new AISettingsValidationError('请选择有效的 AI 配置');
    const store = await bootstrapStore();
    if (parsed.data.visionProfileId && !findProfile(store, parsed.data.visionProfileId).vision.enabled) {
      throw new AISettingsValidationError('所选配置未启用商品分析能力');
    }
    if (parsed.data.imageProfileId && !findProfile(store, parsed.data.imageProfileId).image.enabled) {
      throw new AISettingsValidationError('所选配置未启用氛围主图能力');
    }
    store.activeVisionProfileId = parsed.data.visionProfileId;
    store.activeImageProfileId = parsed.data.imageProfileId;
    await writeJson(profileSettingsFile(), store);
    return publicSettings(store);
  });
}

export async function getProfileSecret(profileId: string): Promise<string> {
  return findProfile(await serial(bootstrapStore), profileId).apiKey;
}

export async function resolveProfileVisionConfig(profileId: string): Promise<ResolvedVisionConfig> {
  const profile = findProfile(await serial(bootstrapStore), profileId);
  if (!profile.vision.enabled) throw new AISettingsValidationError('该配置未启用商品分析能力');
  return { ...profile.vision, profileId: profile.id, apiKey: profile.apiKey };
}

export async function resolveProfileImageConfig(profileId: string): Promise<ResolvedImageConfig> {
  const profile = findProfile(await serial(bootstrapStore), profileId);
  if (!profile.image.enabled) throw new AISettingsValidationError('该配置未启用氛围主图能力');
  return { ...profile.image, profileId: profile.id, apiKey: profile.apiKey };
}

export async function resolveActiveVisionConfig(): Promise<ResolvedVisionConfig> {
  const store = await serial(bootstrapStore);
  if (!store.activeVisionProfileId) {
    throw new AISettingsValidationError('未选择商品分析 API 配置，请先在 AI 设置中选择。');
  }
  const profile = findProfile(store, store.activeVisionProfileId);
  if (!profile.vision.enabled) {
    throw new AISettingsValidationError('未选择商品分析 API 配置，请先在 AI 设置中选择。');
  }
  return { ...profile.vision, profileId: profile.id, apiKey: profile.apiKey };
}

export async function resolveActiveImageConfig(): Promise<ResolvedImageConfig> {
  const store = await serial(bootstrapStore);
  if (!store.activeImageProfileId) {
    throw new AISettingsValidationError('未选择氛围主图 API 配置，请先在 AI 设置中选择。');
  }
  const profile = findProfile(store, store.activeImageProfileId);
  if (!profile.image.enabled) {
    throw new AISettingsValidationError('未选择氛围主图 API 配置，请先在 AI 设置中选择。');
  }
  return { ...profile.image, profileId: profile.id, apiKey: profile.apiKey };
}
