import type { EditorLayer, ImageSlotLayer, TemplateDocument } from '@/core/templates';
import { buildFabricObjects, serializeDocument } from './document';
import { applyImageFit } from './render';
import { exportPNG } from './export';

/**
 * Fabric 画布适配器：创建可编辑画布、替换槽位图片、序列化、导出。
 * 不做通用设计器；只实现模板所需操作（选择/移动/缩放/换图/导出）。
 */

export interface EditorCanvasController {
  /** 替换某个图片槽位的资产（保留槽位几何） */
  replaceSlotImage(layerId: string, src: string): Promise<void>;
  /** 序列化当前可编辑状态 → 编辑器文档 */
  getDocument(): EditorLayer[];
  /** 导出 PNG Blob */
  exportPNG(scale?: number): Promise<Blob>;
  dispose(): void;
}

export async function createEditorCanvas(
  container: HTMLElement,
  doc: TemplateDocument,
  getAssetSrc: (assetId: string) => string,
): Promise<EditorCanvasController> {
  const fabric = await import('fabric');
  const canvasEl = document.createElement('canvas');
  container.appendChild(canvasEl);
  const canvas = new fabric.Canvas(canvasEl, {
    selection: true,
    preserveObjectStacking: true,
    backgroundColor: '#ffffff',
    enableRetinaScaling: true,
  });
  canvas.setDimensions({ width: doc.width, height: doc.height });

  const items = await buildFabricObjects(fabric, doc, getAssetSrc);
  for (const { object } of items) {
    canvas.add(object as never);
  }
  canvas.requestRenderAll();

  return {
    async replaceSlotImage(layerId: string, src: string) {
      const existing = canvas
        .getObjects()
        .find((o) => (o as unknown as { layerId?: string }).layerId === layerId);
      if (!existing) return;
      const slot = (existing as unknown as { slot?: ImageSlotLayer }).slot;
      const img = await (async () => {
        try {
          return await (fabric.FabricImage as unknown as {
            fromURL: (url: string, o?: { crossOrigin?: string }) => Promise<unknown>;
          }).fromURL(src, { crossOrigin: 'anonymous' });
        } catch {
          return null;
        }
      })();
      if (!img) return;
      canvas.remove(existing);
      if (slot) applyImageFit(fabric, img, slot);
      const meta = img as { layerId?: string; layerType?: string; slot?: ImageSlotLayer };
      meta.layerId = layerId;
      meta.layerType = 'image';
      meta.slot = slot;
      canvas.add(img as never);
      canvas.requestRenderAll();
    },

    getDocument: () => serializeDocument(canvas),

    exportPNG: (scale = 2) => exportPNG(canvas, scale),

    dispose() {
      void canvas.dispose();
    },
  };
}
