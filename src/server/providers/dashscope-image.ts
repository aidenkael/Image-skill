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
  if (!size) throw new ProviderConfigError(`尺寸模式为预设映射时，当前比例 ${ratio} 缺少对应尺寸配置。`);
  return size;
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

/** Marker error class for prompt_extend unsupported, distinct from other HTTP errors. */
class PromptExtendUnsupportedError extends Error {
  readonly httpStatus: number;
  readonly snippet: string;
  constructor(httpStatus: number, snippet: string) {
    super('prompt_extend unsupported');
    this.httpStatus = httpStatus;
    this.snippet = snippet;
  }
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

    const useNativeBatch = batchMode === 'native' || batchMode === 'auto';

    if (useNativeBatch) {
      try {
        return await this.generateNative(input, imageUri, size, log);
      } catch (error) {
        if (error instanceof BatchUnsupportedError && batchMode === 'auto') {
          return this.generateSingle(input, imageUri, size, log);
        }
        throw error;
      }
    }

    return this.generateSingle(input, imageUri, size, log);
  }

  /**
   * Request a single image generation with the given promptExtend flag.
   * Throws PromptExtendUnsupportedError when the protocol rejects prompt_extend.
   */
  private async requestSingle(
    imageUri: string,
    prompt: string,
    size: string | undefined,
    promptExtend: boolean | undefined,
    log: ImageLogFn,
  ): Promise<GeneratedImage> {
    const parameters: Record<string, unknown> = { n: 1 };
    if (promptExtend !== undefined) parameters.prompt_extend = promptExtend;
    if (size) parameters.size = size;

    const payload = {
      model: this.config.model,
      input: { messages: [{ role: 'user', content: [{ image: imageUri }, { text: prompt }] }] },
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
      if (promptExtend !== undefined && isPromptExtendUnsupported(response.status, responseSnippet)) {
        throw new PromptExtendUnsupportedError(response.status, responseSnippet);
      }
      await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet, batchMode: 'single' });
      console.error(`[ai] image.generation failed requestId=${(crypto.randomUUID()).slice(0, 8)}`);
      throw providerHttpError(response.status);
    }

    const images = await this.extractImages(response, 1, log, 'single');
    return images[0];
  }

  private async generateSingle(
    input: ImageGenerationInput,
    imageUri: string,
    size: string | undefined,
    log: ImageLogFn,
  ): Promise<GeneratedImage[]> {
    const results: GeneratedImage[] = [];
    let usePromptExtend = resolvePromptExtend(this.config);

    for (let index = 0; index < input.count; index += 1) {
      try {
        const image = await this.requestSingle(imageUri, input.prompt, size, usePromptExtend, log);
        results.push(image);
      } catch (error) {
        if (error instanceof PromptExtendUnsupportedError) {
          if (this.config.compatibility.promptEnhancement !== 'auto') {
            await log({ status: 'failed', failureStage: 'http', httpStatus: error.httpStatus, responseSnippet: error.snippet, batchMode: 'single' });
            throw new ProviderConfigError('提示词扩写功能不被当前图片模型支持，请将 promptEnhancement 改为 auto 或 off。');
          }
          // auto: drop prompt_extend, retry current image, continue rest without it
          usePromptExtend = undefined;
          const retryImage = await this.requestSingle(imageUri, input.prompt, size, undefined, log);
          results.push(retryImage);
        } else {
          throw error;
        }
      }
    }

    if (results.length !== input.count) {
      throw new ProviderRequestError(`模型返回结果数量不完整：要求 ${input.count} 张，实际 ${results.length} 张`);
    }
    return results;
  }

  private async generateNative(
    input: ImageGenerationInput,
    imageUri: string,
    size: string | undefined,
    log: ImageLogFn,
  ): Promise<GeneratedImage[]> {
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
      if (isBatchUnsupported(response.status, responseSnippet)) {
        await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet, batchMode: 'native', compatibilityFallback: 'single' });
        throw new BatchUnsupportedError();
      }
      if (promptExtend !== undefined && isPromptExtendUnsupported(response.status, responseSnippet)) {
        if (this.config.compatibility.promptEnhancement === 'on') {
          await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet, batchMode: 'native' });
          throw new ProviderConfigError('提示词扩写功能不被当前图片模型支持，请将 promptEnhancement 改为 auto 或 off。');
        }
        // auto: retry native without prompt_extend
        return this.generateNativeWithoutPromptExtend(input, imageUri, size, log);
      }
      await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet, batchMode: 'native' });
      console.error(`[ai] image.generation failed requestId=${(crypto.randomUUID()).slice(0, 8)}`);
      throw providerHttpError(response.status);
    }

    return this.extractImages(response, input.count, log, 'native');
  }

  private async generateNativeWithoutPromptExtend(
    input: ImageGenerationInput,
    imageUri: string,
    size: string | undefined,
    log: ImageLogFn,
  ): Promise<GeneratedImage[]> {
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
        throw new BatchUnsupportedError();
      }
      await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet, batchMode: 'native' });
      throw providerHttpError(response.status);
    }

    return this.extractImages(response, input.count, log, 'native');
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

/** Marker: native batch is unsupported by the protocol (auto mode may fall back to single). */
class BatchUnsupportedError extends Error {
  constructor() { super('batch unsupported'); }
}
