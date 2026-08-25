'use client';

export async function getSystemStatus(): Promise<{ aiConfigured: boolean }> {
  const response = await fetch('/api/system/status');
  if (!response.ok) throw new Error(`读取 AI 配置状态失败 HTTP ${response.status}`);
  return response.json() as Promise<{ aiConfigured: boolean }>;
}
