import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeAILog } from '@/server/logging/ai-log';
import type { ResolvedImageConfig } from '@/server/settings/ai';
import type { GeneratedImage, ImageGenerationInput, ImageProvider } from './image-provider';
import { ProviderConfigError, ProviderRequestError, providerFetchError, providerHttpError } from './provider-errors';

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

  async generate(input: ImageGenerationInput): Promise<GeneratedImage[]> {
    if (!this.config.compatibility.referenceImage) {
      throw new ProviderConfigError('当前图片模型不支持参考图输入，不能用于氛围主图。');
    }

    // ── Capability validation (before any HTTP request) ──

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
      const requestId = crypto.randomUUID();
      const started = Date.now();
      const log = (event: Omit<Parameters<typeof writeAILog>[0], 'requestId' | 'operation' | 'profileId' | 'driver' | 'provider' | 'model' | 'endpoint' | 'durationMs' | 'apiKey' | 'count' | 'ratio'>) => writeAILog({
        ...event, requestId, operation: 'image.generation', profileId: this.config.profileId,
        driver: this.config.driver, provider: this.config.driver, model: this.config.model,
        endpoint: this.config.endpoint, apiKey: this.config.apiKey, durationMs: Date.now() - started,
        count: 1, ratio: input.ratio,
      });
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
      let response: Response;
      try {
        response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyPayload),
          signal: AbortSignal.timeout(180_000),
        });
      } catch (error) {
        await log({ status: 'failed', failureStage: 'fetch', errorName: error instanceof Error ? error.name : undefined, errorMessage: error instanceof Error ? error.message : 'Unknown error' });
        throw providerFetchError(error);
      }
      if (!response.ok) {
        const responseSnippet = await response.text();
        await log({ status: 'failed', failureStage: 'http', httpStatus: response.status, responseSnippet });
        console.error(`[ai] image.generation failed requestId=${requestId.slice(0, 8)}`);
        throw providerHttpError(response.status);
      }
      let body: unknown;
      try { body = await response.json(); } catch {
        await log({ status: 'failed', failureStage: 'response-json', httpStatus: response.status });
        throw new ProviderRequestError('AI 返回结果无法解析，请重新尝试。');
      }
      const urls = (body as { data?: Array<{ url?: unknown }> }).data
        ?.flatMap((item) => typeof item.url === 'string' && item.url ? [{ url: item.url }] : []) ?? [];
      if (urls.length !== 1) {
        await log({ status: 'failed', failureStage: 'content-extract', httpStatus: response.status });
        throw new ProviderRequestError('AI 返回结果无法解析，请重新尝试。');
      }
      results.push(urls[0]);
      await log({ status: 'succeeded', httpStatus: response.status });
    }
    return results;
  }
}
