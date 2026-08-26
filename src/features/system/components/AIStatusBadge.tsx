'use client';

import { useState } from 'react';
import type { AISettingsPublic } from '@/core/system';
import { AISettingsDialog, type AISettingsActions } from './AISettingsDialog';

export function AIStatusBadge({ settings, loading, actions }: {
  settings: AISettingsPublic | null;
  loading: boolean;
  actions: AISettingsActions;
}) {
  const [open, setOpen] = useState(false);
  const vision = settings?.profiles.find((profile) => profile.id === settings.activeVisionProfileId)?.name ?? '未选择';
  const image = settings?.profiles.find((profile) => profile.id === settings.activeImageProfileId)?.name ?? '未选择';
  return <><button type="button" className="ai-status" onClick={() => setOpen(true)} title={`识图：${vision}；生图：${image}`}><strong>AI 设置</strong><span>识图：{vision} · 生图：{image}</span></button><AISettingsDialog open={open} settings={settings} loading={loading} onClose={() => setOpen(false)} {...actions} /></>;
}
