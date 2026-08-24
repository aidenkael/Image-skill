'use client';

import type { TemplateDocument } from '@/core/templates';
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { createEditorCanvas, EditorCanvasController } from '@/editor/fabric/canvas';
import { downloadBlob } from '@/editor/fabric/export';

/**
 * 拼图画布（浏览器端 Fabric 编辑器宿主）。
 * 通过 ref 暴露 createLayout / exportPNG；画布内支持选择/移动/缩放/双击编辑文字。
 */

export interface CollageEditorHandle {
  createLayout(doc: TemplateDocument): Promise<void>;
  getDocument(): TemplateDocument | null;
  exportPNG(fileName?: string): Promise<void>;
  replaceSlotImage(layerId: string, src: string, assetId: string): Promise<void>;
}

export const CollageEditor = forwardRef<CollageEditorHandle>(function CollageEditor(_props, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<EditorCanvasController | null>(null);
  const documentRef = useRef<TemplateDocument | null>(null);

  useImperativeHandle(
    ref,
    () => ({
      async createLayout(doc: TemplateDocument) {
        const host = hostRef.current;
        if (!host) return;
        controllerRef.current?.dispose();
        controllerRef.current = null;
        host.innerHTML = '';
        host.style.width = `${doc.width}px`;
        host.style.height = `${doc.height}px`;
        controllerRef.current = await createEditorCanvas(
          host,
          doc,
          (assetId) => `/api/assets/${assetId}`,
        );
        documentRef.current = doc;
      },
      getDocument() {
        const doc = documentRef.current;
        const controller = controllerRef.current;
        if (!doc || !controller) return null;
        const current = { ...doc, layers: controller.getDocument() };
        documentRef.current = current;
        return current;
      },
      async exportPNG(fileName = 'collage-export.png') {
        const c = controllerRef.current;
        if (!c) throw new Error('请先创建布局再导出');
        const blob = await c.exportPNG(2);
        downloadBlob(blob, fileName);
      },
      async replaceSlotImage(layerId: string, src: string, assetId: string) {
        await controllerRef.current?.replaceSlotImage(layerId, src, assetId);
      },
    }),
    [],
  );

  useEffect(
    () => () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
      documentRef.current = null;
    },
    [],
  );

  return <div ref={hostRef} className="collage-canvas-host" />;
});
