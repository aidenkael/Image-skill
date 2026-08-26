'use client';

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error('无法连接本地工作台服务，请确认启动窗口仍在运行后重试。');
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `请求失败 HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}
