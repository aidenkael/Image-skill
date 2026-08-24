import type { EditorLayer, ImageSlotLayer, TemplateDocument } from '@/core/templates';
import { applyImageFit } from './render';

/**
 * 编辑器文档 ↔ Fabric 对象 的转换（浏览器端）。
 * 领域契约是 core 里的 EditorLayer / TemplateDocument，不把 Fabric 内部结构当作领域契约。
 */

export type FabricNamespace = typeof import('@fabricjs/browser');
export type AnyFabricObject = Record<string, unknown> & {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  scaleX?: number;
  scaleY?: number;
};

export interface LayerObjectMeta {
  layerId: string;
  layerType: 'image' | 'text' | 'shape';
  slot?: ImageSlotLayer;
}

export function attachMeta(
  obj: AnyFabricObject,
  layer: EditorLayer,
  slot?: ImageSlotLayer,
): void {
  obj.layerId = layer.id;
  obj.layerType = layer.type;
  if (slot) {
    obj.slot = {
      ...slot,
      contentTransform: slot.contentTransform ? { ...slot.contentTransform } : undefined,
    };
  }
}

/** 加载图片（URL → FabricImage），失败返回 null */
export async function loadSlotImage(
  fabric: FabricNamespace,
  src: string,
): Promise<unknown | null> {
  try {
    const img = await (fabric.FabricImage as unknown as {
      fromURL: (
        url: string,
        options?: { crossOrigin?: string },
      ) => Promise<unknown>;
    }).fromURL(src, { crossOrigin: 'anonymous' });
    return img;
  } catch {
    return null;
  }
}

/**
 * 根据编辑器文档构建 Fabric 对象列表（图片异步加载）。
 * getAssetSrc: assetId → 客户端可访问的图片 URL。
 */
export async function buildFabricObjects(
  fabric: FabricNamespace,
  doc: TemplateDocument,
  getAssetSrc: (assetId: string) => string,
): Promise<{ object: AnyFabricObject; layer: EditorLayer }[]> {
  const result: { object: AnyFabricObject; layer: EditorLayer }[] = [];

  for (const layer of doc.layers) {
    if (layer.type === 'shape') {
      const rect = new fabric.Rect({
        left: layer.x,
        top: layer.y,
        width: layer.width,
        height: layer.height,
        fill: layer.fill ?? '#ffffff',
        rx: layer.radius ?? 0,
        ry: layer.radius ?? 0,
        selectable: false,
        evented: false,
      });
      attachMeta(rect as unknown as AnyFabricObject, layer);
      result.push({ object: rect as unknown as AnyFabricObject, layer });
    } else if (layer.type === 'text') {
      const text = new fabric.Textbox(layer.text ?? '', {
        left: layer.x,
        top: layer.y,
        width: layer.width,
        fontSize: layer.fontSize,
        fontWeight: layer.fontWeight ?? 400,
        fill: layer.color ?? '#111827',
        textAlign: layer.align ?? 'left',
        editable: true,
      });
      attachMeta(text as unknown as AnyFabricObject, layer);
      result.push({ object: text as unknown as AnyFabricObject, layer });
    } else {
      const src = layer.assetId ? getAssetSrc(layer.assetId) : '';
      const img = src ? await loadSlotImage(fabric, src) : null;
      if (img) {
        applyImageFit(fabric, img, layer);
        attachMeta(img as unknown as AnyFabricObject, layer, layer);
        result.push({ object: img as unknown as AnyFabricObject, layer });
      } else {
        // 空槽位占位
        const placeholder = new fabric.Rect({
          left: layer.x,
          top: layer.y,
          width: layer.width,
          height: layer.height,
          fill: '#E5E7EB',
          rx: layer.radius ?? 0,
          ry: layer.radius ?? 0,
          selectable: false,
          evented: false,
        });
        attachMeta(placeholder as unknown as AnyFabricObject, layer, layer);
        result.push({ object: placeholder as unknown as AnyFabricObject, layer });
      }
    }
  }
  return result;
}

/** 把当前可编辑状态序列化回编辑器文档（EditorLayer[]） */
export function serializeDocument(canvas: unknown): EditorLayer[] {
  const layers: EditorLayer[] = [];
  const objects = (canvas as { getObjects(): AnyFabricObject[] }).getObjects();
  for (const obj of objects) {
    const layerId = obj.layerId as string | undefined;
    if (!layerId) continue;
    const layerType = obj.layerType as string | undefined;
    const left = obj.left ?? 0;
    const top = obj.top ?? 0;
    const scaleX = obj.scaleX ?? 1;
    const scaleY = obj.scaleY ?? 1;
    if (layerType === 'image') {
      const slot = obj.slot as ImageSlotLayer | undefined;
      if (!slot) continue;
      layers.push({
        type: 'image',
        id: layerId,
        x: slot.x,
        y: slot.y,
        width: slot.width,
        height: slot.height,
        fit: slot.fit,
        radius: slot.radius,
        slotIndex: slot.slotIndex,
        assetId: slot.assetId ?? null,
        contentTransform: { left, top, scaleX, scaleY },
      });
    } else if (layerType === 'text') {
      layers.push({
        type: 'text',
        id: layerId,
        x: left,
        y: top,
        width: (obj.width ?? 0) * scaleX,
        text: (obj.text as string) ?? '',
        fontSize: (obj.fontSize as number) ?? 24,
        fontWeight: (obj.fontWeight as 400 | 500 | 600 | 700 | undefined) ?? undefined,
        align: (obj.textAlign as 'left' | 'center' | 'right' | undefined) ?? undefined,
        color: (obj.fill as string | undefined) ?? undefined,
      });
    } else if (layerType === 'shape') {
      layers.push({
        type: 'shape',
        id: layerId,
        x: left,
        y: top,
        width: (obj.width ?? 0) * scaleX,
        height: (obj.height ?? 0) * scaleY,
        fill: (obj.fill as string | undefined) ?? undefined,
        radius: (obj.rx as number | undefined) ?? undefined,
      });
    }
  }
  return layers;
}
