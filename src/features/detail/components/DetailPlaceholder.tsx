'use client';

import { LaterPhasePanel } from '@/features/workbench/components/LaterPhasePanel';

/**
 * 详情页图：V2 阶段能力占位。
 * 仅保留任务契约与能力入口，不实现详情页生成器。
 */

export function DetailPlaceholder() {
  return (
    <LaterPhasePanel
      title="详情页图"
      note="详情页图为 V2 阶段能力：当前仅保留任务契约（TaskKind='detail'）、templates/detail 目录与 features/detail 模块边界，不做完整实现。"
    />
  );
}
