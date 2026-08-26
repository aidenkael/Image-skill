'use client';

import { useState } from 'react';
import type { AISettingsStatus } from '@/core/system';
import { AISettingsDialog } from './AISettingsDialog';

export function AIStatusBadge({
  status,
  onStatusChange,
}: {
  status: AISettingsStatus | null;
  onStatusChange(status: AISettingsStatus): void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`ai-status ${status?.configured ? 'is-ready' : 'is-missing'}`}
        onClick={() => setOpen(true)}
      >
        {status === null ? 'AI 状态读取中' : status.configured ? 'AI 已配置' : 'AI 未配置'}
      </button>
      <AISettingsDialog
        open={open}
        status={status}
        onClose={() => setOpen(false)}
        onStatusChange={onStatusChange}
      />
    </>
  );
}
