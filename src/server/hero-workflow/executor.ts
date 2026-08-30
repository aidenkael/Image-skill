import fs from 'node:fs/promises';
import path from 'node:path';
import type { HeroBrief } from '@/core/hero-workflow';
import { createActiveImageProvider } from '@/server/providers/factory';
import { providerFetchError, providerHttpError } from '@/server/providers/provider-errors';
import { readImageMeta } from '@/server/image/sharp';
import type { HeroWorkflowInput } from './contracts';
import { buildHeroGenerationPrompt } from './prompt-builder';

/**
 * 执行：Image Provider 只负责生成。
 * 最终 prompt 由确定性编译器从 HeroBrief 组装；HTTP 级日志由 Provider adapter 写入。
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
  /** QA 反馈的一次性修复指令（仅补生轮携带） */
  repairInstruction?: string;
}

export async function executeHeroWorkflow(
  input: HeroWorkflowInput,
  brief: HeroBrief,
  outDir: string,
  options: ExecuteHeroWorkflowOptions,
): Promise<ExecutedHeroImage[]> {
  const provider = await createActiveImageProvider();
  const prompt = buildHeroGenerationPrompt(
    brief,
    { humanPolicy: input.humanPolicy, creativeIntent: input.creativeIntent },
    options.repairInstruction,
  );

  const generated = await provider.generate({
    imagePath: input.sourceImagePath,
    prompt,
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
  return images;
}
