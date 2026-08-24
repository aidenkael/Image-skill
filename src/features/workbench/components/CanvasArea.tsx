'use client';

import type { RefObject } from 'react';
import type { TaskRecord } from '@/core/tasks';
import { CollageEditor, CollageEditorHandle } from '@/features/collage/components/CollageEditor';

/**
 * 中央画布/预览区：
 * - hero：显示最近一次生成结果
 * - collage：Fabric 可编辑画布（滚动查看全尺寸）
 */

interface CanvasAreaProps {
  kind: 'hero' | 'collage';
  latestHeroTask: TaskRecord | null;
  collageEditorRef: RefObject<CollageEditorHandle | null>;
}

export function CanvasArea({ kind, latestHeroTask, collageEditorRef }: CanvasAreaProps) {
  if (kind === 'collage') {
    return (
      <section className="canvas-area">
        <div className="canvas-title">拼图画布（可拖动 / 缩放对象，双击文字编辑）</div>
        <div className="canvas-scroll">
          <CollageEditor ref={collageEditorRef} />
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
            <img
              key={`${img.url}-${i}`}
              src={img.url}
              alt={`生成结果 ${i + 1}`}
              className="result-img"
            />
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
