'use client';

/**
 * 后续阶段能力占位面板（详情页 / 简单优化）。
 * 保持可见的"稍后阶段"状态，绝不静默调用 hero 生成。
 */

interface LaterPhasePanelProps {
  title: string;
  note: string;
}

export function LaterPhasePanel({ title, note }: LaterPhasePanelProps) {
  return (
    <section className="canvas-area">
      <div className="canvas-title">{title}</div>
      <div className="later-phase">
        <div className="later-badge">后续阶段（V2）</div>
        <p>{note}</p>
      </div>
    </section>
  );
}
