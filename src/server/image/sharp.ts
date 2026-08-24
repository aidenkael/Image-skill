import sharp from 'sharp';

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
