'use client';

import { useEffect, useState } from 'react';
import type { AISettingsStatus } from '@/core/system';
import { clearAIKey, saveAIKey, testAIConnection } from '@/features/system/model/api';

interface Props {
  open: boolean;
  status: AISettingsStatus | null;
  onClose(): void;
  onStatusChange(status: AISettingsStatus): void;
}

const SOURCE_LABELS = {
  runtime: '工作台本机运行时',
  environment: '环境变量',
  none: '未配置',
} as const;

export function AISettingsDialog({ open, status, onClose, onStatusChange }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setApiKey('');
    setMessage(null);
    setError(null);
  }, [open]);
  if (!open) return null;

  async function run(action: () => Promise<AISettingsStatus>, success: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await action();
      onStatusChange(next);
      setApiKey('');
      setMessage(success);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await testAIConnection();
      setMessage(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <div className="dialog-title"><h2 id="ai-settings-title">AI 设置</h2><button type="button" className="dialog-close" onClick={onClose}>关闭</button></div>
        <dl className="settings-summary">
          <div><dt>Provider</dt><dd>{status?.provider ?? '读取中…'}</dd></div>
          <div><dt>商品分析模型</dt><dd>{status?.visionModel ?? '读取中…'}</dd></div>
          <div><dt>氛围主图模型</dt><dd>{status?.imageModel ?? '读取中…'}</dd></div>
          <div><dt>当前 Key</dt><dd>{status?.maskedKey ?? '未配置'}</dd></div>
          <div><dt>Key 来源</dt><dd>{status ? SOURCE_LABELS[status.source] : '读取中…'}</dd></div>
        </dl>
        <div className="field">
          <label className="field-label" htmlFor="runtime-ai-key">输入新 Key 并保存到本机运行时</label>
          <input id="runtime-ai-key" className="input" type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="DashScope API Key" />
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" disabled={busy || apiKey.trim().length < 8} onClick={() => void run(() => saveAIKey(apiKey), '工作台 Key 已保存并立即生效')}>保存工作台 Key</button>
          <button type="button" className="btn" disabled={busy || status?.source !== 'runtime'} onClick={() => void run(clearAIKey, '工作台 Key 已清除，已回退到环境变量')}>清除并回退环境变量</button>
          <button type="button" className="btn" disabled={busy || !status?.configured} onClick={() => void testConnection()}>测试商品分析连接</button>
        </div>
        <p className="hint">测试连接会产生极少量模型调用。</p>
        <p className="hint">qwen-image-3.0-pro 需要相应模型权限；实际图片生成权限由第一次真实生成调用确认。</p>
        {message ? <div className="status-notice">{message}</div> : null}
        {error ? <div className="status-error">{error}</div> : null}
      </section>
    </div>
  );
}
