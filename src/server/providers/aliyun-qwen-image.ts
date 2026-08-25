import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ImageProvider,
  ImageGenerationInput,
  GeneratedImage,
  ProviderConfigError,
  ProviderRequestError,
} from './image-provider';

/**
 * DashScope / 阿里云百炼 qwen-image-3.0-pro 图片编辑 Provider。
 * 请求/响应解析只允许出现在本文件内（src/server/providers/**）。
 */

export const DEFAULT_DASHSCOPE_API_URL =
  'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const TOKEN_PLAN_API_URL =
  'https://token-plan.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation';
export const QWEN_IMAGE_MODEL = 'qwen-image-3.0-pro';

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** 端点解析：显式 DASHSCOPE_API_URL 优先；sk-sp- Token Plan 凭证走专用端点；其余走默认端点 */
export function resolveDashScopeApiUrl(apiKey: string): string {
  if (process.env.DASHSCOPE_API_URL) return process.env.DASHSCOPE_API_URL;
  if (apiKey.startsWith('sk-sp-')) return TOKEN_PLAN_API_URL;
  return DEFAULT_DASHSCOPE_API_URL;
}

export class AliyunQwenImageProvider implements ImageProvider {
  async generate(input: ImageGenerationInput): Promise<GeneratedImage[]> {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new ProviderConfigError(
        '未配置 DASHSCOPE_API_KEY：请复制 .env.example 为 .env 并填入 DashScope API Key 后再生成',
      );
    }

    let imageData: Buffer;
    try {
      imageData = await fs.readFile(input.imagePath);
    } catch {
      throw new ProviderRequestError(`读取输入图片失败: ${input.imagePath}`);
    }
    const ext = path.extname(input.imagePath).slice(1).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'image/png';

    const payload = {
      model: QWEN_IMAGE_MODEL,
      input: {
        messages: [
          {
            role: 'user',
            content: [
              { image: `data:${mime};base64,${imageData.toString('base64')}` },
              { text: input.prompt },
            ],
          },
        ],
      },
      parameters: {
        n: input.count,
        prompt_extend: false,
        size: input.size,
      },
    };

    const url = resolveDashScopeApiUrl(apiKey);
    // 不打印 API Key，不打印 base64 图片体
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(180_000),
    });

    if (!res.ok) {
      const text = (await res.text()).slice(0, 500);
      throw new ProviderRequestError(`图片模型调用失败 HTTP ${res.status}: ${text}`);
    }

    const body = (await res.json()) as Record<string, unknown>;
    const output = (body.output ?? {}) as {
      choices?: { message?: { content?: { image?: string }[] } }[];
      results?: { url?: string }[];
    };

    const images: GeneratedImage[] = [];
    // 响应形态 1：output.choices[].message.content[].image
    for (const choice of output.choices ?? []) {
      const firstImage = choice.message?.content?.find((c) => c.image)?.image;
      if (firstImage) images.push({ url: firstImage });
    }
    // 响应形态 2：output.results[].url
    for (const item of output.results ?? []) {
      if (item.url) images.push({ url: item.url });
    }

    if (images.length === 0) {
      throw new ProviderRequestError('模型响应中未找到生成图片');
    }
    return images.slice(0, input.count);
  }
}
