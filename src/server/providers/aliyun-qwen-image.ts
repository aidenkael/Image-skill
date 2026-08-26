import fs from 'node:fs/promises';
import path from 'node:path';
import type { ResolvedImageConfig } from '@/server/settings/ai';
import type { GeneratedImage, ImageGenerationInput, ImageProvider } from './image-provider';
import { ProviderRequestError, providerFetchError, providerHttpError } from './provider-errors';

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

export function qwenSizeForRatio(ratio: ImageGenerationInput['ratio']): string {
  if (ratio === '3:4') return '768*1344';
  if (ratio === '4:3') return '1344*768';
  return '1024*1024';
}

export class AliyunQwenImageProvider implements ImageProvider {
  constructor(private readonly config: ResolvedImageConfig) {}

  async generate(input: ImageGenerationInput): Promise<GeneratedImage[]> {
    let imageData: Buffer;
    try { imageData = await fs.readFile(input.imagePath); }
    catch { throw new ProviderRequestError('无法读取源商品图片，请重新选择后重试。'); }
    const ext = path.extname(input.imagePath).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'image/png';
    const payload = {
      model: this.config.model,
      input: { messages: [{ role: 'user', content: [
        { image: `data:${mime};base64,${imageData.toString('base64')}` },
        { text: input.prompt },
      ] }] },
      parameters: { n: input.count, prompt_extend: true, size: qwenSizeForRatio(input.ratio) },
    };

    let response: Response;
    try {
      response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(180_000),
      });
    } catch (error) { throw providerFetchError(error); }
    if (!response.ok) {
      console.error('[qwen image] upstream request failed', { status: response.status });
      throw providerHttpError(response.status);
    }

    let body: unknown;
    try { body = await response.json(); } catch { throw new ProviderRequestError('AI 返回结果无法解析，请重新尝试。'); }
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
    if (images.length < input.count) {
      throw new ProviderRequestError(`模型返回结果数量不完整：要求 ${input.count} 张，实际 ${images.length} 张`);
    }
    return images.slice(0, input.count);
  }
}
