import type { ImageSlotLayer } from '@/core/templates';

/**
 * 图片槽位填充逻辑：cover（裁切填充）/ contain（完整容纳）。
 */
export type FabricNamespace = typeof import('@fabricjs/browser');

export interface ImageFitGeometry {
  left: number;
  top: number;
  scaleX: number;
  scaleY: number;
}

/** 计算图片在固定槽位中的初始位置与缩放；cover 从中心裁切。 */
export function imageFitGeometry(
  imageWidth: number,
  imageHeight: number,
  slot: ImageSlotLayer,
): ImageFitGeometry {
  const iw = imageWidth || 1;
  const ih = imageHeight || 1;
  const scale =
    slot.fit === 'cover'
      ? Math.max(slot.width / iw, slot.height / ih)
      : Math.min(slot.width / iw, slot.height / ih);
  const renderedWidth = iw * scale;
  const renderedHeight = ih * scale;

  return {
    left: slot.x + (slot.width - renderedWidth) / 2,
    top: slot.y + (slot.height - renderedHeight) / 2,
    scaleX: scale,
    scaleY: scale,
  };
}

export function applyImageFit(
  fabric: FabricNamespace,
  img: unknown,
  slot: ImageSlotLayer,
): void {
  const obj = img as {
    width?: number;
    height?: number;
    set(props: Record<string, unknown>): void;
    clipPath?: unknown;
  };
  const geometry = slot.contentTransform ?? imageFitGeometry(obj.width ?? 1, obj.height ?? 1, slot);

  obj.set({
    ...geometry,
    originX: 'left',
    originY: 'top',
  });

  if (slot.fit === 'cover') {
    const clip = new fabric.Rect({
      left: slot.x,
      top: slot.y,
      width: slot.width,
      height: slot.height,
      absolutePositioned: true,
      originX: 'left',
      originY: 'top',
      rx: slot.radius ?? 0,
      ry: slot.radius ?? 0,
    });
    obj.clipPath = clip;
  }
}
