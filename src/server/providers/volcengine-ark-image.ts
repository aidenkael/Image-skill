import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAIRequestLog } from '@/server/logging/ai-log';
import type { ResolvedImageConfig } from '@/server/settings/ai';
import type { GeneratedImage, ImageGenerationInput, ImageProvider } from './image-provider';
import { ProviderCapabilityError, ProviderConfigError, ProviderRequestError, providerFetchError, providerHttpError } from './provider-errors';

/**
 * 火山方舟图片协议只支持单张循环；每张一次 HTTP 请求 = 一个独立日志文件。
 * 当前可访问的 Ark images/generations 路由只接受单个 image 字段，
 * 无真实多参考图与 edit region 能力：不伪装，抛 ProviderCapabilityError。
 */

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

export class VolcengineArkImageProvider implements ImageProvider {
  constructor(private readonly config: ResolvedImageConfig) {}

  capabilities() {
    return {
      supportsMultipleReferences: false,
      maxReferenceImages: 0,
      supportsEditRegions: false,
      supportsPromptEnhancementOverride: false,
    };
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedImage[]> {
    if (!this.config.compatibility.referenceImage) {
      throw new ProviderConfigError('当前图片模型不支持参考图输入，不能用于氛围主图。');
    }

    // ── Capability validation (before any HTTP request) ──

    // 多参考图：当前 Ark 图片路由无真实支持，不用 prompt 文本伪装，显式拒绝。
    if ((input.referenceImagePaths?.length ?? 0) > 0) {
      throw new ProviderCapabilityError(
        '火山方舟图片当前路由不支持多参考图输入，对应 Benchmark lane 不可用。',
      );
    }

    // 请求级扩写覆盖：Ark 无此能力，显式 off 之外的要求都拒绝。
    if (input.promptEnhancement === 'on') {
      throw new ProviderCapabilityError('火山方舟图片 adapter 当前不支持提示词扩写。');
    }

    // batchMode: Ark only supports single-loop. auto resolves to single.
    const batchMode = this.config.compatibility.batchMode;
    if (batchMode === 'native') {
      throw new ProviderConfigError('火山方舟图片 adapter 当前不支持原生批量模式，请使用 single 或 auto。');
    }
    // auto and single both resolve to single-loop

    // promptEnhancement: Ark does not support prompt enhancement
    const promptEnhancement = this.config.compatibility.promptEnhancement;
    if (promptEnhancement === 'on') {
      throw new ProviderConfigError('火山方舟图片 adapter 当前不支持提示词扩写，请使用 auto 或 off。');
    }
    // auto and off both resolve to: do not send any prompt_extend parameter

    let imageData: Buffer;
    try { imageData = await fs.readFile(input.imagePath); }
    catch { throw new ProviderRequestError('无法读取源商品图片，请重新选择后重试。'); }
    const ext = path.extname(input.imagePath).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'image/png';
    const dataUri = `data:${mime};base64,${imageData.toString('base64')}`;
    const size = resolveSize(this.config, input.ratio);
    const results: GeneratedImage[] = [];
    for (let index = 0; index < input.count; index += 1) {
      results.push(await this.requestSingle(input, dataUri, size));
    }
    return results;
  }

  private async requestSingle(
    input: ImageGenerationInput,
    dataUri: string,
    size: string | undefined,
  ): Promise<GeneratedImage> {
    const bodyPayload: Record<string, unknown> = {
      model: this.config.model,
      prompt: input.prompt,
      image: dataUri,
      sequential_image_generation: 'disabled',
      stream: false,
      response_format: 'url',
      watermark: false,
    };
    if (size) bodyPayload.size = size;

    const requestId = crypto.randomUUID();
    const started = Date.now();
    const log = (event: {
      status: 'succeeded' | 'failed';
      httpStatus?: number;
      failureStage?: string;
      errorName?: string;
      errorMessage?: string;
      responseBody?: unknown;
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
      requestBody: bodyPayload,
      ...(event.responseBody !== undefined ? { responseBody: event.responseBody } : {}),
      redact: [this.config.apiKey],
      extra: {
        batchMode: 'single', count: 1, ratio: input.ratio,
        ...(input.benchmarkTrace
          ? {
            benchmarkRunId: input.benchmarkTrace.runId,
            benchmarkScenario: input.benchmarkTrace.scenario,
            benchmarkLane: input.benchmarkTrace.lane,
          }
          : {}),
      },
    });

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) {
      await log({ status: 'failed', failureStage: 'fetch',
        errorName: error instanceof Error ? error.name : undefined,
        errorMessage: error instanceof Error ? error.message : 'Unknown error' });
      throw providerFetchError(error);
    }

    const responseRaw = await response.text();
    if (!response.ok) {
      await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseBody: responseRaw });
      console.error(`[ai] image-generation failed requestId=${requestId.slice(0, 8)}`);
      throw providerHttpError(response.status);
    }

    let body: unknown;
    try { body = JSON.parse(responseRaw); } catch {
      await log({ status: 'failed', failureStage: 'response-json', httpStatus: response.status, responseBody: responseRaw });
      throw new ProviderRequestError('AI 返回结果无法解析，请重新尝试。');
    }
    const urls = (body as { data?: Array<{ url?: unknown }> }).data
      ?.flatMap((item) => typeof item.url === 'string' && item.url ? [{ url: item.url }] : []) ?? [];
    if (urls.length !== 1) {
      await log({ status: 'failed', failureStage: 'content-extract', httpStatus: response.status, responseBody: body });
      throw new ProviderRequestError('AI 返回结果无法解析，请重新尝试。');
    }
    await log({ status: 'succeeded', httpStatus: response.status, responseBody: body });
    return urls[0];
  }
}
