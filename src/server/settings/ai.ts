import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { z } from 'zod';
import {
  ActiveAIProfilesInputSchema,
  AIProfileInputSchema,
  AIProfilePublicSchema,
  AISettingsPublicSchema,
  ImageCompatibilitySchema,
  LEGACY_ALIYUN_IMAGE_ENDPOINT,
  VisionCompatibilitySchema,
  VisionCapabilitySchema,
  ImageCapabilitySchema,
  ALIYUN_VISION_ENDPOINT,
  type AIProfileInput,
  type AIProfilePublic,
  type AISettingsPublic,
  type ImageCapability,
  type VisionCapability,
  type AIProfilePreset,
} from '@/core/system';
import { readJson, runtimePath, writeJson } from '@/server/storage/fs-store';

/* ── v2 persisted schemas ── */

const PersistedAIProfileV2Schema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  preset: z.enum(['aliyun-qwen', 'volcengine-ark', 'custom']),
  apiKey: z.string().trim().min(8).max(500),
  vision: VisionCapabilitySchema,
  image: ImageCapabilitySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
const PersistedAISettingsV2Schema = z.object({
  schemaVersion: z.literal(2),
  profiles: z.array(PersistedAIProfileV2Schema),
  activeVisionProfileId: z.string().uuid().nullable(),
  activeImageProfileId: z.string().uuid().nullable(),
});

/* ── v1 persisted schemas (for migration) ── */

const LegacyVisionCapabilitySchema = z.object({
  enabled: z.boolean(),
  driver: z.enum(['openai-compatible-vision']),
  endpoint: z.string().trim().url(),
  model: z.string().trim().min(1).max(120),
});
const LegacyImageDriverSchema = z.enum(['dashscope-qwen-image', 'volcengine-ark-image', 'dashscope-image']);
const LegacyImageCapabilitySchema = z.object({
  enabled: z.boolean(),
  driver: LegacyImageDriverSchema,
  endpoint: z.string().trim().url(),
  model: z.string().trim().min(1).max(120),
});
const PersistedAIProfileV1Schema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  preset: z.enum(['aliyun-qwen', 'volcengine-ark', 'custom']),
  apiKey: z.string().trim().min(8).max(500),
  vision: LegacyVisionCapabilitySchema,
  image: LegacyImageCapabilitySchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
const PersistedAISettingsV1Schema = z.object({
  schemaVersion: z.literal(1),
  profiles: z.array(PersistedAIProfileV1Schema),
  activeVisionProfileId: z.string().uuid().nullable(),
  activeImageProfileId: z.string().uuid().nullable(),
});
const LegacyAISettingsSchema = z.object({ apiKey: z.string().trim().min(8).max(500) });

type PersistedAIProfile = z.infer<typeof PersistedAIProfileV2Schema>;
type PersistedAISettings = z.infer<typeof PersistedAISettingsV2Schema>;

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

/* ── v1 → v2 migration ── */

function defaultVisionCompatibility(): z.infer<typeof VisionCompatibilitySchema> {
  return { imageInput: true, structuredOutput: 'auto' };
}

function defaultImageCompatibilityForDriver(
  driver: string,
  preset: AIProfilePreset,
): z.infer<typeof ImageCompatibilitySchema> {
  if (driver === 'volcengine-ark-image') {
    return {
      referenceImage: true, batchMode: 'single', sizeMode: 'mapped',
      sizeByRatio: { '1:1': '2048x2048', '3:4': '1536x2048', '4:3': '2048x1536' },
      promptEnhancement: 'off',
    };
  }
  // dashscope-image (migrated from dashscope-qwen-image)
  return {
    referenceImage: true, batchMode: 'native', sizeMode: 'mapped',
    sizeByRatio: { '1:1': '1024*1024', '3:4': '768*1344', '4:3': '1344*768' },
    promptEnhancement: 'auto',
  };
}

function migrateV1Profile(profile: z.infer<typeof PersistedAIProfileV1Schema>): PersistedAIProfile {
  const imageDriver = profile.image.driver === 'dashscope-qwen-image'
    ? 'dashscope-image'
    : profile.image.driver;
  return {
    id: profile.id,
    name: profile.name,
    preset: profile.preset,
    apiKey: profile.apiKey,
    vision: {
      ...profile.vision,
      compatibility: defaultVisionCompatibility(),
    },
    image: {
      ...profile.image,
      driver: imageDriver as 'dashscope-image' | 'volcengine-ark-image',
      compatibility: defaultImageCompatibilityForDriver(imageDriver, profile.preset),
    },
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function migrateV1ToV2(v1: z.infer<typeof PersistedAISettingsV1Schema>): PersistedAISettings {
  return {
    schemaVersion: 2,
    profiles: v1.profiles.map(migrateV1Profile),
    activeVisionProfileId: v1.activeVisionProfileId,
    activeImageProfileId: v1.activeImageProfileId,
  };
}

/* ── bootstrap ── */

async function bootstrapStore(): Promise<PersistedAISettings> {
  const storePath = profileSettingsFile();
  if (await fileExists(storePath)) {
    const raw = await readJson<unknown>(storePath);

    // Try v2 first
    const v2 = PersistedAISettingsV2Schema.safeParse(raw);
    if (v2.success) return v2.data;

    // Try v1 → migrate
    const v1 = PersistedAISettingsV1Schema.safeParse(raw);
    if (v1.success) {
      const migrated = migrateV1ToV2(v1.data);
      await writeJson(storePath, migrated);
      return migrated;
    }

    throw new AISettingsValidationError('AI 配置文件损坏或格式不合法');
  }

  const legacy = LegacyAISettingsSchema.safeParse(await readJson<unknown>(legacySettingsFile()));
  const apiKey = legacy.success ? legacy.data.apiKey : process.env.DASHSCOPE_API_KEY?.trim();
  let store: PersistedAISettings = {
    schemaVersion: 2,
    profiles: [],
    activeVisionProfileId: null,
    activeImageProfileId: null,
  };
  if (apiKey) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const imageDriver = 'dashscope-image' as const;
    store = {
      schemaVersion: 2,
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
          compatibility: defaultVisionCompatibility(),
        },
        image: {
          enabled: true,
          driver: imageDriver,
          endpoint: process.env.DASHSCOPE_API_URL?.trim() || LEGACY_ALIYUN_IMAGE_ENDPOINT,
          model: 'qwen-image-3.0-pro',
          compatibility: defaultImageCompatibilityForDriver(imageDriver, 'aliyun-qwen'),
        },
        createdAt: now,
        updatedAt: now,
      }],
      activeVisionProfileId: id,
      activeImageProfileId: id,
    };
  }
  const parsed = PersistedAISettingsV2Schema.safeParse(store);
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
    const profile = PersistedAIProfileV2Schema.parse({ ...input, id, createdAt: now, updatedAt: now });
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
    const updated = PersistedAIProfileV2Schema.parse({
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
