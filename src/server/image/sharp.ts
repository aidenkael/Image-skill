import sharp from 'sharp';
import type { OptimizeTaskOptions } from '@/core/tasks';

/**
 * 服务端确定性图片操作（仅 sharp，不引入自研图像算法）。
 */

export interface ImageMeta {
  width: number;
  height: number;
  format: string;
}

export async function readImageMeta(buffer: Buffer): Promise<ImageMeta> {
  const meta = await sharp(buffer).metadata();
  if (!meta.width || !meta.height || !meta.format) {
    throw new Error('无法识别的图片文件');
  }
  return { width: meta.width, height: meta.height, format: meta.format };
}

/** 生成缩略图（最长边 maxSide，不放大） */
export async function makeThumbnail(buffer: Buffer, maxSide = 320): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();
}

export async function makeVisionPreview(buffer: Buffer, maxSide = 1600): Promise<Buffer> {
  return sharp(buffer)
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({
      width: maxSide,
      height: maxSide,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: 85 })
    .toBuffer();
}

export function optimizeDimensions(
  ratio: OptimizeTaskOptions['ratio'],
  maxEdge: OptimizeTaskOptions['maxEdge'],
): { width: number; height: number } | null {
  if (ratio === 'original') return null;
  if (ratio === '1:1') return { width: maxEdge, height: maxEdge };
  if (ratio === '3:4') return { width: Math.round((maxEdge * 3) / 4), height: maxEdge };
  return { width: maxEdge, height: Math.round((maxEdge * 3) / 4) };
}

export async function optimizeImage(
  buffer: Buffer,
  options: OptimizeTaskOptions,
): Promise<Buffer> {
  const background = options.background === 'white' ? '#ffffff' : '#f3f4f6';
  const target = optimizeDimensions(options.ratio, options.maxEdge);
  let pipeline = sharp(buffer).rotate();

  if (target) {
    pipeline = pipeline.resize({
      ...target,
      fit: options.fit,
      position: 'centre',
      background,
    });
  } else {
    pipeline = pipeline.resize({
      width: options.maxEdge,
      height: options.maxEdge,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  if (options.format === 'jpg') return pipeline.flatten({ background }).jpeg({ quality: options.quality }).toBuffer();
  if (options.format === 'webp') return pipeline.webp({ quality: options.quality }).toBuffer();
  return pipeline.png().toBuffer();
}
