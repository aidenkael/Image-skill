import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAILog } from '@/server/logging/ai-log';
import type { ResolvedImageConfig } from '@/server/settings/ai';
import type { GeneratedImage, ImageGenerationInput, ImageProvider } from './image-provider';
import { ProviderConfigError, ProviderRequestError, providerFetchError, providerHttpError } from './provider-errors';

type ImageLogFn = (event: Omit<Parameters<typeof writeAILog>[0], 'requestId' | 'operation' | 'profileId' | 'driver' | 'provider' | 'model' | 'endpoint' | 'durationMs' | 'apiKey' | 'count' | 'ratio'> & { batchMode?: string; compatibilityFallback?: string }) => Promise<void>;

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

function resolveSize(config: ResolvedImageConfig, ratio: ImageGenerationInput['ratio']): string | undefined {
  if (config.compatibility.sizeMode === 'provider-default') return undefined;
  const sizeMap = config.compatibility.sizeByRatio;
  const size = sizeMap[ratio as keyof typeof sizeMap];
  return size || undefined;
}

function resolvePromptExtend(config: ResolvedImageConfig): boolean | undefined {
  const mode = config.compatibility.promptEnhancement;
  if (mode === 'on') return true;
  if (mode === 'off') return undefined;
  // auto: send true (recommended for DashScope)
  return true;
}

function isBatchUnsupported(httpStatus: number, body: string): boolean {
  if (httpStatus !== 400 && httpStatus !== 422) return false;
  const lower = body.toLowerCase();
  return /(?:\bn\b|batch|count|number_of_images).*(?:not.*support|invalid|unsupported)|unsupported.*(?:\bn\b|batch|count)/i.test(lower);
}

function isPromptExtendUnsupported(httpStatus: number, body: string): boolean {
  if (httpStatus !== 400 && httpStatus !== 422) return false;
  const lower = body.toLowerCase();
  return /prompt_extend|prompt.*enhance/i.test(lower);
}

export class DashScopeImageProvider implements ImageProvider {
  constructor(private readonly config: ResolvedImageConfig) {}

  async generate(input: ImageGenerationInput): Promise<GeneratedImage[]> {
    if (!this.config.compatibility.referenceImage) {
      throw new ProviderConfigError('当前图片模型不支持参考图输入，不能用于氛围主图。');
    }

    let imageData: Buffer;
    try { imageData = await fs.readFile(input.imagePath); }
    catch { throw new ProviderRequestError('无法读取源商品图片，请重新选择后重试。'); }
    const ext = path.extname(input.imagePath).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'image/png';
    const imageUri = `data:${mime};base64,${imageData.toString('base64')}`;
    const size = resolveSize(this.config, input.ratio);
    const batchMode = this.config.compatibility.batchMode;

    const requestId = crypto.randomUUID();
    const started = Date.now();
    const log = (event: Omit<Parameters<typeof writeAILog>[0], 'requestId' | 'operation' | 'profileId' | 'driver' | 'provider' | 'model' | 'endpoint' | 'durationMs' | 'apiKey' | 'count' | 'ratio'> & { batchMode?: string; compatibilityFallback?: string }) => writeAILog({
      ...event, requestId, operation: 'image.generation', profileId: this.config.profileId,
      driver: this.config.driver, provider: this.config.driver, model: this.config.model,
      endpoint: this.config.endpoint, apiKey: this.config.apiKey, durationMs: Date.now() - started,
      count: input.count, ratio: input.ratio,
    });

    // Decide whether to attempt native batch or single-loop
    const useNativeBatch = batchMode === 'native' || batchMode === 'auto';

    if (useNativeBatch) {
      const result = await this.generateNative(input, imageUri, size, log);
      if (result !== null) return result;
      // Native batch failed with unsupported — fall back to single (only for auto mode)
      if (batchMode === 'auto') {
        return this.generateSingle(input, imageUri, size, log);
      }
      throw new ProviderRequestError('批量生成不支持，请检查图片模型配置。');
    }

    return this.generateSingle(input, imageUri, size, log);
  }

  private async generateNative(
    input: ImageGenerationInput,
    imageUri: string,
    size: string | undefined,
    log: ImageLogFn,
  ): Promise<GeneratedImage[] | null> {
    const promptExtend = resolvePromptExtend(this.config);
    const parameters: Record<string, unknown> = { n: input.count };
    if (promptExtend !== undefined) parameters.prompt_extend = promptExtend;
    if (size) parameters.size = size;

    const payload = {
      model: this.config.model,
      input: { messages: [{ role: 'user', content: [{ image: imageUri }, { text: input.prompt }] }] },
      parameters,
    };

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      await log({ status: 'failed', failureStage: 'fetch', errorName: error instanceof Error ? error.name : undefined, errorMessage: error instanceof Error ? error.message : 'Unknown error', batchMode: 'native' });
      throw providerFetchError(error);
    }

    if (!response.ok) {
      const responseSnippet = await response.text();
      // Check if batch is unsupported (auto mode handles this at caller)
      if (isBatchUnsupported(response.status, responseSnippet)) {
        await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet, batchMode: 'native', compatibilityFallback: 'single' });
        return null; // Signal to caller to try single
      }
      // Check if prompt_extend is unsupported — retry without it
      if (promptExtend !== undefined && isPromptExtendUnsupported(response.status, responseSnippet)) {
        return this.generateNativeRetryWithoutPromptExtend(input, imageUri, size, log);
      }
      await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet, batchMode: 'native' });
      console.error(`[ai] image.generation failed requestId=${(crypto.randomUUID()).slice(0, 8)}`);
      throw providerHttpError(response.status);
    }

    const images = await this.extractImages(response, input.count, log, 'native');
    return images;
  }

  private async generateNativeRetryWithoutPromptExtend(
    input: ImageGenerationInput,
    imageUri: string,
    size: string | undefined,
    log: ImageLogFn,
  ): Promise<GeneratedImage[] | null> {
    const parameters: Record<string, unknown> = { n: input.count };
    if (size) parameters.size = size;

    const payload = {
      model: this.config.model,
      input: { messages: [{ role: 'user', content: [{ image: imageUri }, { text: input.prompt }] }] },
      parameters,
    };

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      await log({ status: 'failed', failureStage: 'fetch', errorName: error instanceof Error ? error.name : undefined, errorMessage: error instanceof Error ? error.message : 'Unknown error', batchMode: 'native' });
      throw providerFetchError(error);
    }

    if (!response.ok) {
      const responseSnippet = await response.text();
      if (isBatchUnsupported(response.status, responseSnippet)) {
        await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet, batchMode: 'native', compatibilityFallback: 'single' });
        return null;
      }
      await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet, batchMode: 'native' });
      throw providerHttpError(response.status);
    }

    return this.extractImages(response, input.count, log, 'native');
  }

  private async generateSingle(
    input: ImageGenerationInput,
    imageUri: string,
    size: string | undefined,
    log: ImageLogFn,
  ): Promise<GeneratedImage[]> {
    const results: GeneratedImage[] = [];
    const promptExtend = resolvePromptExtend(this.config);

    for (let index = 0; index < input.count; index += 1) {
      const parameters: Record<string, unknown> = { n: 1 };
      if (promptExtend !== undefined) parameters.prompt_extend = promptExtend;
      if (size) parameters.size = size;

      const payload = {
        model: this.config.model,
        input: { messages: [{ role: 'user', content: [{ image: imageUri }, { text: input.prompt }] }] },
        parameters,
      };

      let response: Response;
      try {
        response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(180_000),
        });
      } catch (error) {
        await log({ status: 'failed', failureStage: 'fetch', errorName: error instanceof Error ? error.name : undefined, errorMessage: error instanceof Error ? error.message : 'Unknown error', batchMode: 'single' });
        throw providerFetchError(error);
      }

      if (!response.ok) {
        const responseSnippet = await response.text();
        // If prompt_extend unsupported, retry without it
        if (promptExtend !== undefined && isPromptExtendUnsupported(response.status, responseSnippet)) {
          const retryResult = await this.generateSingleWithoutPromptExtend(input, imageUri, size, log);
          return [...results, ...retryResult];
        }
        await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet, batchMode: 'single' });
        console.error(`[ai] image.generation failed requestId=${(crypto.randomUUID()).slice(0, 8)}`);
        throw providerHttpError(response.status);
      }

      const images = await this.extractImages(response, 1, log, 'single');
      results.push(...images);
    }
    return results;
  }

  private async generateSingleWithoutPromptExtend(
    input: ImageGenerationInput,
    imageUri: string,
    size: string | undefined,
    log: ImageLogFn,
  ): Promise<GeneratedImage[]> {
    const results: GeneratedImage[] = [];
    // Only one request since we're already in fallback
    const parameters: Record<string, unknown> = { n: 1 };
    if (size) parameters.size = size;

    const payload = {
      model: this.config.model,
      input: { messages: [{ role: 'user', content: [{ image: imageUri }, { text: input.prompt }] }] },
      parameters,
    };

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      await log({ status: 'failed', failureStage: 'fetch', errorName: error instanceof Error ? error.name : undefined, errorMessage: error instanceof Error ? error.message : 'Unknown error', batchMode: 'single' });
      throw providerFetchError(error);
    }

    if (!response.ok) {
      const responseSnippet = await response.text();
      await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet, batchMode: 'single' });
      throw providerHttpError(response.status);
    }

    const images = await this.extractImages(response, 1, log, 'single');
    results.push(...images);
    return results;
  }

  private async extractImages(
    response: Response,
    expectedCount: number,
    log: ImageLogFn,
    batchMode: string,
  ): Promise<GeneratedImage[]> {
    let body: unknown;
    try { body = await response.json(); } catch {
      await log({ status: 'failed', failureStage: 'response-json', httpStatus: response.status, batchMode });
      throw new ProviderRequestError('AI 返回结果无法解析，请重新尝试。');
    }
    const output = ((body as { output?: unknown }).output ?? {}) as {
      choices?: { message?: { content?: { image?: string }[] } }[];
      results?: { url?: string }[];
    };
    const images: GeneratedImage[] = [];
    for (const choice of output.choices ?? []) {
      const url = choice.message?.content?.find((item) => item.image)?.image;
      if (url) images.push({ url });
    }
    for (const item of output.results ?? []) if (item.url) images.push({ url: item.url });
    if (images.length < expectedCount) {
      await log({ status: 'failed', failureStage: 'content-extract', httpStatus: response.status, batchMode });
      throw new ProviderRequestError(`模型返回结果数量不完整：要求 ${expectedCount} 张，实际 ${images.length} 张`);
    }
    await log({ status: 'succeeded', httpStatus: response.status, batchMode });
    return images.slice(0, expectedCount);
  }
}
