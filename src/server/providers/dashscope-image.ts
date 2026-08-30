import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAIRequestLog } from '@/server/logging/ai-log';
import type { ResolvedImageConfig } from '@/server/settings/ai';
import type { GeneratedImage, ImageGenerationInput, ImageProvider } from './image-provider';
import { ProviderCapabilityError, ProviderConfigError, ProviderRequestError, providerFetchError, providerHttpError } from './provider-errors';

/**
 * 日志约定：一个实际 provider HTTP 请求 = 一个独立日志文件。
 * 原生批量不可用/提示词扩写不可用等协议降级，各自是新的 HTTP 请求与新文件。
 * editRegions 不被本协议支持：显式忽略并在 capabilities 中如实声明。
 */

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

function toDataUri(filePath: string, notFoundMessage: string): Promise<string> {
  return fs.readFile(filePath)
    .catch(() => { throw new ProviderRequestError(notFoundMessage); })
    .then((data) => {
      const ext = path.extname(filePath).slice(1).toLowerCase();
      const mime = MIME_BY_EXT[ext] ?? 'image/png';
      return `data:${mime};base64,${data.toString('base64')}`;
    });
}

function benchmarkLogExtra(input: ImageGenerationInput): Record<string, unknown> {
  if (!input.benchmarkTrace) return {};
  return {
    benchmarkRunId: input.benchmarkTrace.runId,
    benchmarkScenario: input.benchmarkTrace.scenario,
    benchmarkLane: input.benchmarkTrace.lane,
  };
}

function resolveSize(config: ResolvedImageConfig, ratio: ImageGenerationInput['ratio']): string | undefined {
  if (config.compatibility.sizeMode === 'provider-default') return undefined;
  const sizeMap = config.compatibility.sizeByRatio;
  const size = sizeMap[ratio as keyof typeof sizeMap];
  if (!size) throw new ProviderConfigError(`尺寸模式为预设映射时，当前比例 ${ratio} 缺少对应尺寸配置。`);
  return size;
}

function resolvePromptExtend(
  config: ResolvedImageConfig,
  override?: ImageGenerationInput['promptEnhancement'],
): boolean | undefined {
  // Provider/profile 不支持 prompt enhancement → 完全不发送
  if (!config.compatibility.promptEnhancementSupported) return undefined;
  const mode = override ?? config.compatibility.promptEnhancement;
  if (mode === 'on') return true;
  if (mode === 'off') return false;
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

/** Marker: native batch is unsupported by the protocol (auto mode may fall back to single). */
class BatchUnsupportedError extends Error {
  constructor() { super('batch unsupported'); }
}

/** 从响应正文提取图片；携带失败阶段以便同一请求只写一次日志。 */
function extractImagesFromBody(raw: string, expectedCount: number): GeneratedImage[] {
  let body: unknown;
  try { body = JSON.parse(raw); } catch {
    throw new ExtractError('response-json', new ProviderRequestError('AI 返回结果无法解析，请重新尝试。'), raw);
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
    throw new ExtractError('content-extract', new ProviderRequestError(`模型返回结果数量不完整：要求 ${expectedCount} 张，实际 ${images.length} 张`), raw);
  }
  return images.slice(0, expectedCount);
}

class ExtractError extends Error {
  constructor(
    readonly stage: string,
    readonly inner: ProviderRequestError,
    readonly raw: string,
  ) {
    super(inner.message);
  }
}

export class DashScopeImageProvider implements ImageProvider {
  constructor(private readonly config: ResolvedImageConfig) {}

  capabilities() {
    return {
      supportsMultipleReferences: this.config.compatibility.maxReferenceImages > 0,
      maxReferenceImages: this.config.compatibility.maxReferenceImages,
      supportsEditRegions: false,
      supportsPromptEnhancementOverride: this.config.compatibility.promptEnhancementSupported,
    };
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedImage[]> {
    if (!this.config.compatibility.referenceImage) {
      throw new ProviderConfigError('当前图片模型不支持参考图输入，不能用于氛围主图。');
    }

    const referencePaths = input.referenceImagePaths ?? [];
    const maxRefs = this.config.compatibility.maxReferenceImages;
    if (referencePaths.length > maxRefs) {
      throw new ProviderCapabilityError(
        `当前配置最多支持 ${maxRefs} 张额外参考图，当前传入了 ${referencePaths.length} 张。`,
      );
    }

    let imageUri: string;
    try { imageUri = await toDataUri(input.imagePath, '无法读取源商品图片，请重新选择后重试。'); }
    catch (error) {
      if (error instanceof ProviderRequestError) throw error;
      throw new ProviderRequestError('无法读取源商品图片，请重新选择后重试。');
    }
    const referenceUris: string[] = [];
    for (const refPath of referencePaths) {
      referenceUris.push(await toDataUri(refPath, '无法读取参考图片，请重新选择后重试。'));
    }
    const contentItems: Array<Record<string, string>> = [
      { image: imageUri },
      ...referenceUris.map((uri) => ({ image: uri })),
      { text: input.prompt },
    ];

    const size = resolveSize(this.config, input.ratio);
    const batchMode = this.config.compatibility.batchMode;

    const useNativeBatch = batchMode === 'native' || batchMode === 'auto';

    if (useNativeBatch) {
      try {
        return await this.generateNative(input, contentItems, size);
      } catch (error) {
        if (error instanceof BatchUnsupportedError && batchMode === 'auto') {
          return this.generateSingle(input, contentItems, size);
        }
        throw error;
      }
    }

    return this.generateSingle(input, contentItems, size);
  }

  /** 为一次实际 HTTP 请求构造一次性日志写入函数。 */
  private requestLogger(requestId: string, started: number, extraBase: Record<string, unknown>) {
    return (event: {
      status: 'succeeded' | 'failed';
      httpStatus?: number;
      failureStage?: string;
      errorName?: string;
      errorMessage?: string;
      requestBody?: unknown;
      responseBody?: unknown;
      extra?: Record<string, unknown>;
    }) => writeAIRequestLog({
      timestamp: new Date().toISOString(),
      requestId,
      operation: 'image-generation',
      profileId: this.config.profileId,
      driver: this.config.driver,
      model: this.config.model,
      endpoint: this.config.endpoint,
      durationMs: Date.now() - started,
      status: event.status,
      ...(event.httpStatus !== undefined ? { httpStatus: event.httpStatus } : {}),
      ...(event.failureStage ? { failureStage: event.failureStage } : {}),
      ...(event.errorName ? { errorName: event.errorName } : {}),
      ...(event.errorMessage !== undefined ? { errorMessage: event.errorMessage } : {}),
      ...(event.requestBody !== undefined ? { requestBody: event.requestBody } : {}),
      ...(event.responseBody !== undefined ? { responseBody: event.responseBody } : {}),
      redact: [this.config.apiKey],
      extra: { ...extraBase, ...event.extra },
    });
  }

  /**
   * Request a single image generation with the given promptExtend flag.
   * Throws PromptExtendUnsupportedError when the protocol rejects prompt_extend.
   */
  private async requestSingle(
    input: ImageGenerationInput,
    contentItems: Array<Record<string, string>>,
    size: string | undefined,
    promptExtend: boolean | undefined,
  ): Promise<GeneratedImage> {
    const parameters: Record<string, unknown> = { n: 1 };
    if (promptExtend !== undefined) parameters.prompt_extend = promptExtend;
    if (size) parameters.size = size;

    const payload = {
      model: this.config.model,
      input: { messages: [{ role: 'user', content: contentItems }] },
      parameters,
    };

    const requestId = crypto.randomUUID();
    const started = Date.now();
    const log = this.requestLogger(requestId, started, { batchMode: 'single', count: 1, ...benchmarkLogExtra(input) });

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      await log({ status: 'failed', failureStage: 'fetch', requestBody: payload,
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : 'Unknown error' });
      throw providerFetchError(error);
    }

    const responseRaw = await response.text();
    if (!response.ok) {
      const promptExtendRejected = promptExtend !== undefined && isPromptExtendUnsupported(response.status, responseRaw);
      await log({
        status: 'failed', failureStage: 'http', httpStatus: response.status,
        requestBody: payload, responseBody: responseRaw,
        ...(promptExtendRejected ? { extra: { promptExtendUnsupported: true } } : {}),
      });
      if (promptExtendRejected) throw new PromptExtendUnsupportedError(response.status, responseRaw);
      console.error(`[ai] image-generation failed requestId=${requestId.slice(0, 8)}`);
      throw providerHttpError(response.status);
    }

    let images: GeneratedImage[];
    try {
      images = extractImagesFromBody(responseRaw, 1);
    } catch (error) {
      if (error instanceof ExtractError) {
        await log({ status: 'failed', failureStage: error.stage, httpStatus: response.status, requestBody: payload, responseBody: error.raw });
        throw error.inner;
      }
      throw error;
    }
    await log({ status: 'succeeded', httpStatus: response.status, requestBody: payload, responseBody: JSON.parse(responseRaw) });
    return images[0];
  }

  private async generateSingle(
    input: ImageGenerationInput,
    contentItems: Array<Record<string, string>>,
    size: string | undefined,
  ): Promise<GeneratedImage[]> {
    const results: GeneratedImage[] = [];
    const effectiveEnhancement = input.promptEnhancement ?? this.config.compatibility.promptEnhancement;
    let usePromptExtend = resolvePromptExtend(this.config, input.promptEnhancement);

    for (let index = 0; index < input.count; index += 1) {
      try {
        const image = await this.requestSingle(input, contentItems, size, usePromptExtend);
        results.push(image);
      } catch (error) {
        if (error instanceof PromptExtendUnsupportedError) {
          if (effectiveEnhancement !== 'auto') {
            throw new ProviderConfigError('提示词扩写功能不被当前图片模型支持，请将 promptEnhancement 改为 auto 或 off。');
          }
          // auto: drop prompt_extend, retry current image, continue rest without it
          usePromptExtend = undefined;
          const retryImage = await this.requestSingle(input, contentItems, size, undefined);
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
    contentItems: Array<Record<string, string>>,
    size: string | undefined,
  ): Promise<GeneratedImage[]> {
    const promptExtend = resolvePromptExtend(this.config, input.promptEnhancement);
    const parameters: Record<string, unknown> = { n: input.count };
    if (promptExtend !== undefined) parameters.prompt_extend = promptExtend;
    if (size) parameters.size = size;

    const payload = {
      model: this.config.model,
      input: { messages: [{ role: 'user', content: contentItems }] },
      parameters,
    };

    const requestId = crypto.randomUUID();
    const started = Date.now();
    const log = this.requestLogger(requestId, started, { batchMode: 'native', count: input.count, ...benchmarkLogExtra(input) });

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      await log({ status: 'failed', failureStage: 'fetch', requestBody: payload,
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : 'Unknown error' });
      throw providerFetchError(error);
    }

    const responseRaw = await response.text();
    if (!response.ok) {
      const batchRejected = isBatchUnsupported(response.status, responseRaw);
      const promptExtendRejected = promptExtend !== undefined && isPromptExtendUnsupported(response.status, responseRaw);
      await log({
        status: 'failed', failureStage: 'http', httpStatus: response.status,
        requestBody: payload, responseBody: responseRaw,
        extra: {
          ...(batchRejected ? { compatibilityFallback: 'single' } : {}),
          ...(promptExtendRejected ? { promptExtendUnsupported: true } : {}),
        },
      });
      if (batchRejected) throw new BatchUnsupportedError();
      if (promptExtendRejected) {
        const effectiveEnhancement = input.promptEnhancement ?? this.config.compatibility.promptEnhancement;
        if (effectiveEnhancement !== 'auto') {
          throw new ProviderConfigError('提示词扩写功能不被当前图片模型支持，请将 promptEnhancement 改为 auto 或 off。');
        }
        // auto: retry native without prompt_extend (new HTTP request, new log file)
        return this.generateNativeWithoutPromptExtend(input, contentItems, size);
      }
      console.error(`[ai] image-generation failed requestId=${requestId.slice(0, 8)}`);
      throw providerHttpError(response.status);
    }

    let images: GeneratedImage[];
    try {
      images = extractImagesFromBody(responseRaw, input.count);
    } catch (error) {
      if (error instanceof ExtractError) {
        await log({ status: 'failed', failureStage: error.stage, httpStatus: response.status, requestBody: payload, responseBody: error.raw });
        throw error.inner;
      }
      throw error;
    }
    await log({ status: 'succeeded', httpStatus: response.status, requestBody: payload, responseBody: JSON.parse(responseRaw) });
    return images;
  }

  private async generateNativeWithoutPromptExtend(
    input: ImageGenerationInput,
    contentItems: Array<Record<string, string>>,
    size: string | undefined,
  ): Promise<GeneratedImage[]> {
    const parameters: Record<string, unknown> = { n: input.count };
    if (size) parameters.size = size;

    const payload = {
      model: this.config.model,
      input: { messages: [{ role: 'user', content: contentItems }] },
      parameters,
    };

    const requestId = crypto.randomUUID();
    const started = Date.now();
    const log = this.requestLogger(requestId, started, { batchMode: 'native', count: input.count, ...benchmarkLogExtra(input) });

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      await log({ status: 'failed', failureStage: 'fetch', requestBody: payload,
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : 'Unknown error' });
      throw providerFetchError(error);
    }

    const responseRaw = await response.text();
    if (!response.ok) {
      await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, requestBody: payload, responseBody: responseRaw });
      if (isBatchUnsupported(response.status, responseRaw)) throw new BatchUnsupportedError();
      throw providerHttpError(response.status);
    }

    let images: GeneratedImage[];
    try {
      images = extractImagesFromBody(responseRaw, input.count);
    } catch (error) {
      if (error instanceof ExtractError) {
        await log({ status: 'failed', failureStage: error.stage, httpStatus: response.status, requestBody: payload, responseBody: error.raw });
        throw error.inner;
      }
      throw error;
    }
    await log({ status: 'succeeded', httpStatus: response.status, requestBody: payload, responseBody: JSON.parse(responseRaw) });
    return images;
  }
}
