'use client';

import type { RefObject } from 'react';
import type { TaskRecord } from '@/core/tasks';
import type { TemplateDocument } from '@/core/templates';
import { CollageEditor, type CollageEditorHandle } from '@/features/collage/components/CollageEditor';

interface CanvasAreaProps {
  workspaceId: string;
  kind: 'hero' | 'collage' | 'optimize';
  latestTask: TaskRecord | null;
  collageEditorRef: RefObject<CollageEditorHandle | null>;
  collageVariantCount?: number;
  activeCollageVariant?: number;
  onSelectCollageVariant?(index: number): void;
  onCollageDocumentChange?(doc: TemplateDocument): void;
}

export function CanvasArea({
  workspaceId,
  kind,
  latestTask,
  collageEditorRef,
  collageVariantCount = 0,
  activeCollageVariant = 0,
  onSelectCollageVariant,
  onCollageDocumentChange,
}: CanvasAreaProps) {
  if (kind === 'collage') {
    return (
      <section className="canvas-area">
        <div className="canvas-title">拼图画布（可拖动 / 缩放对象，双击文字编辑）</div>
        {collageVariantCount > 0 ? (
          <div className="variant-selector" role="tablist" aria-label="组合图方案">
            {Array.from({ length: collageVariantCount }, (_, index) => (
              <button
                key={index}
                type="button"
                role="tab"
                aria-selected={activeCollageVariant === index}
                className={`seg-btn${activeCollageVariant === index ? ' is-active' : ''}`}
                onClick={() => onSelectCollageVariant?.(index)}
              >
                方案 {index + 1}
              </button>
            ))}
          </div>
        ) : null}
        <div className="canvas-scroll">
          <CollageEditor ref={collageEditorRef} workspaceId={workspaceId} onDocumentChange={onCollageDocumentChange} />
        </div>
      </section>
    );
  }

  const images =
    latestTask?.status === 'succeeded'
      ? (latestTask.result?.outputs ?? []).filter(
          (output): output is Extract<typeof output, { kind: 'image' }> =>
            output.kind === 'image' && Boolean(output.url),
        )
      : [];
  const title = kind === 'hero' ? '氛围主图结果' : '优化结果';

  return (
    <section className="canvas-area">
      <div className="canvas-title">
        {title}
        {latestTask ? <span className={`task-status status-${latestTask.status}`}>{latestTask.status}</span> : null}
      </div>
      {images.length > 0 ? (
        <div className="result-grid">
          {images.map((image, index) => (
            <div key={`${image.url}-${index}`} className="result-card">
              <img src={image.url} alt={`${title} ${index + 1}`} className="result-img" />
              <a className="btn result-download" href={image.url} download={`${kind}-result-${index + 1}`}>下载</a>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-canvas">
          {latestTask?.status === 'failed'
            ? '处理失败，请查看右侧错误提示'
            : latestTask?.status === 'running'
              ? '处理中…'
              : kind === 'hero'
                ? '选择商品图片与视觉方向后，生成氛围主图'
                : '选择一张商品图并设置输出规格后，优化图片'}
        </div>
      )}
    </section>
  );
}
