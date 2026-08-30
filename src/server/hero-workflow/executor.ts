import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { HeroPlanV2 } from '@/core/hero-workflow';
import { writeAILog } from '@/server/logging/ai-log';
import { createActiveImageProvider } from '@/server/providers/factory';
import { providerFetchError, providerHttpError } from '@/server/providers/provider-errors';
import { readImageMeta } from '@/server/image/sharp';
import type { HeroWorkflowInput } from './contracts';
import { buildHeroWorkflowPrompt } from './prompt-builder';

/**
 * Phase C：执行。
 * 两条通用分支（scene-staging / human-interaction）都走现有 ImageProvider，
 * 差异只体现在由 HeroPlanV2 组装的最终 Prompt 上；不按商品类别分支。
 */

export interface ExecutedHeroImage {
  url?: string;
  localPath: string;
  buffer: Buffer;
  extension: string;
}

async function downloadImage(url: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw providerFetchError(error);
  }
  if (!res.ok) throw providerHttpError(res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('下载的生成图片为空');
  return buf;
}

async function saveGeneratedImage(buf: Buffer, outDir: string, name: string): Promise<{ localPath: string; extension: string }> {
  const meta = await readImageMeta(buf).catch(() => null);
  if (!meta) throw new Error('生成的图片下载后无法解析为有效图片');
  const extension = meta.format === 'jpeg' ? 'jpg' : meta.format === 'webp' ? 'webp' : 'png';
  const fileName = `${name}.${extension}`;
  const localPath = path.join(outDir, fileName);
  await fs.writeFile(localPath, buf);
  return { localPath, extension };
}

export interface ExecuteHeroWorkflowOptions {
  count: number;
  startIndex: number;
  variant?: 'primary' | 'alt';
  attempt?: number;
}

export async function executeHeroWorkflow(
  input: HeroWorkflowInput,
  plan: HeroPlanV2,
  outDir: string,
  options: ExecuteHeroWorkflowOptions = { count: input.count, startIndex: 0 },
): Promise<ExecutedHeroImage[]> {
  const provider = await createActiveImageProvider();
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const attempt = options.attempt ?? 1;
  const promptVariant = options.variant ?? 'primary';
  const log = (extra: Record<string, unknown>) => writeAILog({
    requestId,
    operation: 'hero.generate',
    workspaceId: input.workspaceId,
    status: 'succeeded',
    durationMs: Date.now() - started,
    displayMode: plan.displayMode,
    humanPolicy: input.humanPolicy,
    creativeLevel: input.creativeLevel,
    ratio: input.ratio,
    count: options.count,
    attempt,
    ...extra,
  });

  try {
    const generated = await provider.generate({
      imagePath: input.sourceImagePath,
      prompt: buildHeroWorkflowPrompt(plan, promptVariant),
      ratio: input.ratio,
      count: options.count,
    });
    if (generated.length !== options.count) {
      throw new Error(`模型返回结果数量不完整：要求 ${options.count} 张，实际 ${generated.length} 张`);
    }

    const images: ExecutedHeroImage[] = [];
    let idx = 0;
    for (const item of generated) {
      if (!item.url) continue;
      const buf = await downloadImage(item.url);
      const saved = await saveGeneratedImage(buf, outDir, `candidate-${String(options.startIndex + idx + 1).padStart(2, '0')}`);
      images.push({ url: item.url, buffer: buf, ...saved });
      idx += 1;
    }
    if (images.length !== options.count) {
      throw new Error(`模型返回结果数量不完整：要求 ${options.count} 张，实际 ${images.length} 张`);
    }
    await log({ status: 'succeeded' });
    return images;
  } catch (error) {
    await log({
      status: 'failed',
      errorName: error instanceof Error ? error.name : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
