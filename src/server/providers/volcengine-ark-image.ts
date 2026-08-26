import fs from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedImageConfig } from '@/server/settings/ai';
import type { GeneratedImage, ImageGenerationInput, ImageProvider } from './image-provider';
import { ProviderRequestError, providerFetchError, providerHttpError } from './provider-errors';

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

export function arkSizeForRatio(ratio: ImageGenerationInput['ratio']): string {
  if (ratio === '3:4') return '1536x2048';
  if (ratio === '4:3') return '2048x1536';
  return '2048x2048';
}

export class VolcengineArkImageProvider implements ImageProvider {
  constructor(private readonly config: ResolvedImageConfig) {}

  async generate(input: ImageGenerationInput): Promise<GeneratedImage[]> {
    let imageData: Buffer;
    try { imageData = await fs.readFile(input.imagePath); }
    catch { throw new ProviderRequestError('无法读取源商品图片，请重新选择后重试。'); }
    const ext = path.extname(input.imagePath).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'image/png';
    const dataUri = `data:${mime};base64,${imageData.toString('base64')}`;
    const results: GeneratedImage[] = [];
    for (let index = 0; index < input.count; index += 1) {
      let response: Response;
      try {
        response = await fetch(this.config.endpoint, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: this.config.model,
            prompt: input.prompt,
            image: dataUri,
            sequential_image_generation: 'disabled',
            stream: false,
            response_format: 'url',
            size: arkSizeForRatio(input.ratio),
            watermark: false,
          }),
          signal: AbortSignal.timeout(180_000),
        });
      } catch (error) { throw providerFetchError(error); }
      if (!response.ok) {
        console.error('[ark image] upstream request failed', { status: response.status });
        throw providerHttpError(response.status);
      }
      let body: unknown;
      try { body = await response.json(); } catch { throw new ProviderRequestError('AI 返回结果无法解析，请重新尝试。'); }
      const urls = (body as { data?: Array<{ url?: unknown }> }).data
        ?.flatMap((item) => typeof item.url === 'string' && item.url ? [{ url: item.url }] : []) ?? [];
      if (urls.length !== 1) throw new ProviderRequestError('AI 返回结果无法解析，请重新尝试。');
      results.push(urls[0]);
    }
    return results;
  }
}
