import type { ImageProvider } from './image-provider';
import type { VisionProvider } from './vision-provider';
import { DashScopeImageProvider } from './dashscope-image';
import { OpenAICompatibleVisionProvider } from './openai-compatible-vision';
import { VolcengineArkImageProvider } from './volcengine-ark-image';
import { ProviderConfigError } from './provider-errors';
import {
  AISettingsValidationError,
  resolveActiveImageConfig,
  resolveActiveVisionConfig,
  resolveProfileImageConfig,
  resolveProfileVisionConfig,
  type ResolvedImageConfig,
  type ResolvedVisionConfig,
} from '@/server/settings/ai';

export function visionProviderFromConfig(config: ResolvedVisionConfig): VisionProvider {
  if (config.driver === 'openai-compatible-vision') return new OpenAICompatibleVisionProvider(config);
  throw new ProviderConfigError('当前视觉协议不受支持');
}

export function imageProviderFromConfig(config: ResolvedImageConfig): ImageProvider {
  if (config.driver === 'dashscope-image') return new DashScopeImageProvider(config);
  if (config.driver === 'volcengine-ark-image') return new VolcengineArkImageProvider(config);
  throw new ProviderConfigError('当前氛围主图协议不受支持');
}

export async function createActiveVisionProvider(): Promise<VisionProvider> {
  try {
    return visionProviderFromConfig(await resolveActiveVisionConfig());
  } catch (error) {
    if (error instanceof AISettingsValidationError) throw new ProviderConfigError(error.message);
    throw error;
  }
}

export async function createActiveImageProvider(): Promise<ImageProvider> {
  try {
    return imageProviderFromConfig(await resolveActiveImageConfig());
  } catch (error) {
    if (error instanceof AISettingsValidationError) throw new ProviderConfigError(error.message);
    throw error;
  }
}

/** 按指定配置创建 Vision Provider（Benchmark Lab 选择配置用）。 */
export async function createVisionProviderForProfile(profileId: string): Promise<VisionProvider> {
  try {
    return visionProviderFromConfig(await resolveProfileVisionConfig(profileId));
  } catch (error) {
    if (error instanceof AISettingsValidationError) throw new ProviderConfigError(error.message);
    throw error;
  }
}

/** 按指定配置创建生图 Provider（Benchmark Lab lane → 配置映射用）。 */
export async function createImageProviderForProfile(profileId: string): Promise<ImageProvider> {
  try {
    return imageProviderFromConfig(await resolveProfileImageConfig(profileId));
  } catch (error) {
    if (error instanceof AISettingsValidationError) throw new ProviderConfigError(error.message);
    throw error;
  }
}
