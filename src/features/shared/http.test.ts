import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from './http';

afterEach(() => vi.unstubAllGlobals());

describe('工作台客户端 HTTP 错误', () => {
  it('浏览器连接失败映射为本地工作台中文错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchJson('/api/test')).rejects.toThrow(
      '无法连接本地工作台服务，请确认启动窗口仍在运行后重试。',
    );
  });

  it('HTTP JSON 错误保留服务端可读文案', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ error: 'AI 正在使用此图片' }),
      { status: 409, headers: { 'Content-Type': 'application/json' } },
    )));
    await expect(fetchJson('/api/test')).rejects.toThrow('AI 正在使用此图片');
  });
});
