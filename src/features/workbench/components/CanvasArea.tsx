'use client';

import type { RefObject } from 'react';
import type { TaskRecord } from '@/core/tasks';
import type { TemplateDocument } from '@/core/templates';
import { CollageEditor, CollageEditorHandle } from '@/features/collage/components/CollageEditor';

/**
 * 中央画布/预览区：
 * - hero：显示最近一次生成结果
 * - collage：Fabric 可编辑画布（滚动查看全尺寸）
 */

interface CanvasAreaProps {
  workspaceId: string;
  kind: 'hero' | 'collage';
  latestHeroTask: TaskRecord | null;
  collageEditorRef: RefObject<CollageEditorHandle | null>;
  collageVariantCount?: number;
  activeCollageVariant?: number;
  onSelectCollageVariant?(index: number): void;
  onCollageDocumentChange?(doc: TemplateDocument): void;
}

export function CanvasArea({
  workspaceId,
  kind,
  latestHeroTask,
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
          <CollageEditor
            ref={collageEditorRef}
            workspaceId={workspaceId}
            onDocumentChange={onCollageDocumentChange}
          />
        </div>
      </section>
    );
  }

  const images =
    latestHeroTask?.status === 'succeeded'
      ? (latestHeroTask.result?.outputs ?? []).filter(
          (o): o is Extract<typeof o, { kind: 'image' }> =>
            o.kind === 'image' && Boolean(o.url),
        )
      : [];

  return (
    <section className="canvas-area">
      <div className="canvas-title">
        氛围主图结果
        {latestHeroTask && (
          <span className={`task-status status-${latestHeroTask.status}`}>
            {latestHeroTask.status}
          </span>
        )}
      </div>
      {images.length > 0 ? (
        <div className="result-grid">
          {images.map((img, i) => (
            <div key={`${img.url}-${i}`} className="result-card">
              <img
                src={img.url}
                alt={`生成结果 ${i + 1}`}
                className="result-img"
              />
              <a
                className="btn result-download"
                href={img.url}
                download={`hero-result-${i + 1}`}
              >
                下载
              </a>
            </div>
          ))}
        </div>
      ) : (
        <div className="empty-canvas">
          {latestHeroTask?.status === 'failed'
            ? '生成失败，请查看右侧错误提示'
            : latestHeroTask?.status === 'running'
              ? '生成中…'
              : '选择商品图片并设置方向后，点击“生成氛围主图”'}
        </div>
      )}
    </section>
  );
}
