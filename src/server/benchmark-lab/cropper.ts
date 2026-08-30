import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { ReferenceCrop } from '@/core/benchmark-lab';

/**
 * Benchmark Lab 确定性裁剪：Vision 给出归一化 box 后，
 * 扩边、钳制、裁剪完全确定，不再依赖任何 AI。
 */

export interface PixelCropBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 每侧按 box 自身尺寸外扩的比例，保证区域有上下文 */
const DEFAULT_MARGIN_RATIO = 0.12;
const MIN_CROP_PX = 16;

/**
 * 归一化 box → 像素 box：按比例外扩并安全钳制在图像边界内。
 * 同一输入恒定产出同一结果（确定性）。
 */
export function expandAndClampCrop(
  crop: Pick<ReferenceCrop, 'x' | 'y' | 'width' | 'height'>,
  imageWidth: number,
  imageHeight: number,
  marginRatio: number = DEFAULT_MARGIN_RATIO,
): PixelCropBox {
  if (imageWidth <= 0 || imageHeight <= 0) throw new Error('图像尺寸非法，无法裁剪');

  const boxW = crop.width * imageWidth;
  const boxH = crop.height * imageHeight;
  const marginX = boxW * marginRatio;
  const marginY = boxH * marginRatio;

  let left = crop.x * imageWidth - marginX;
  let top = crop.y * imageHeight - marginY;
  let width = boxW + marginX * 2;
  let height = boxH + marginY * 2;

  if (left < 0) { width += left; left = 0; }
  if (top < 0) { height += top; top = 0; }
  if (left + width > imageWidth) width = imageWidth - left;
  if (top + height > imageHeight) height = imageHeight - top;

  // 最小尺寸保障：过小的框优先向左上扩展，随后重新钳制到右下边界内
  if (width < MIN_CROP_PX) { width = Math.min(MIN_CROP_PX, imageWidth); left = Math.max(0, Math.min(left, imageWidth - width)); }
  if (height < MIN_CROP_PX) { height = Math.min(MIN_CROP_PX, imageHeight); top = Math.max(0, Math.min(top, imageHeight - height)); }

  left = Math.floor(left);
  top = Math.floor(top);
  width = Math.floor(Math.min(width, imageWidth - left));
  height = Math.floor(Math.min(height, imageHeight - top));

  return { left, top, width, height };
}

/** 按 Vision 裁剪计划把源图裁剪为实际文件；返回每个裁剪的像素信息与文件路径。 */
export async function cropReferenceRegions(
  sourcePath: string,
  crops: ReferenceCrop[],
  outDir: string,
): Promise<Array<{ crop: ReferenceCrop; box: PixelCropBox; path: string }>> {
  const limited = crops.slice(0, 3);
  if (limited.length === 0) return [];

  const sourceBuffer = await fs.readFile(sourcePath);
  const meta = await sharp(sourceBuffer).rotate().metadata();
  if (!meta.width || !meta.height) throw new Error('无法识别源图尺寸，无法生成参考裁剪');

  await fs.mkdir(outDir, { recursive: true });
  const results: Array<{ crop: ReferenceCrop; box: PixelCropBox; path: string }> = [];
  for (let index = 0; index < limited.length; index += 1) {
    const crop = limited[index];
    const box = expandAndClampCrop(crop, meta.width, meta.height);
    const filePath = path.join(outDir, `crop-${index + 1}.png`);
    await sharp(sourceBuffer)
      .rotate()
      .extract(box)
      .png()
      .toFile(filePath);
    results.push({ crop, box, path: filePath });
  }
  return results;
}
