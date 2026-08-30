import type { ImageProvider } from './image-provider';
import type { ProductIntelligenceProvider } from './vision-provider';
import { DashScopeImageProvider } from './dashscope-image';
import { OpenAICompatibleVisionProvider } from './openai-compatible-vision';
import { VolcengineArkImageProvider } from './volcengine-ark-image';
import { ProviderConfigError } from './provider-errors';
import {
  AISettingsValidationError,
  resolveActiveImageConfig,
  resolveActiveVisionConfig,
} from '@/server/settings/ai';

export async function createActiveVisionProvider(): Promise<ProductIntelligenceProvider> {
  try {
    const config = await resolveActiveVisionConfig();
    if (config.driver === 'openai-compatible-vision') return new OpenAICompatibleVisionProvider(config);
    throw new ProviderConfigError('当前商品分析协议不受支持');
  } catch (error) {
    if (error instanceof AISettingsValidationError) throw new ProviderConfigError(error.message);
    throw error;
  }
}

export async function createActiveImageProvider(): Promise<ImageProvider> {
  try {
    const config = await resolveActiveImageConfig();
    if (config.driver === 'dashscope-image') return new DashScopeImageProvider(config);
    if (config.driver === 'volcengine-ark-image') return new VolcengineArkImageProvider(config);
    throw new ProviderConfigError('当前氛围主图协议不受支持');
  } catch (error) {
    if (error instanceof AISettingsValidationError) throw new ProviderConfigError(error.message);
    throw error;
  }
}
