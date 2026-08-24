import type { ImageSlotLayer } from '@/core/templates';

/**
 * 图片槽位填充逻辑：cover（裁切填充）/ contain（完整容纳）。
 */
export type FabricNamespace = typeof import('fabric');

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
  const iw = obj.width ?? 1;
  const ih = obj.height ?? 1;
  const sw = slot.width;
  const sh = slot.height;
  const scale = slot.fit === 'cover' ? Math.max(sw / iw, sh / ih) : Math.min(sw / iw, sh / ih);

  obj.set({
    left: slot.x,
    top: slot.y,
    scaleX: scale,
    scaleY: scale,
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
    });
    obj.clipPath = clip;
  }
}
