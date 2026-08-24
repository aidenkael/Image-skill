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
  exportPNG(): Promise<void>;
  replaceSlotImage(layerId: string, src: string): Promise<void>;
}

export const CollageEditor = forwardRef<CollageEditorHandle>(function CollageEditor(_props, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const controllerRef = useRef<EditorCanvasController | null>(null);

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
      },
      async exportPNG() {
        const c = controllerRef.current;
        if (!c) throw new Error('请先创建布局再导出');
        const blob = await c.exportPNG(2);
        downloadBlob(blob, 'collage-export.png');
      },
      async replaceSlotImage(layerId: string, src: string) {
        await controllerRef.current?.replaceSlotImage(layerId, src);
      },
    }),
    [],
  );

  useEffect(
    () => () => {
      controllerRef.current?.dispose();
      controllerRef.current = null;
    },
    [],
  );

  return <div ref={hostRef} className="collage-canvas-host" />;
});
