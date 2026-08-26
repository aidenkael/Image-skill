import { afterEach, describe, expect, it, vi } from 'vitest';

const { imageConfig, visionConfig } = vi.hoisted(() => ({ imageConfig: vi.fn(), visionConfig: vi.fn() }));
vi.mock('@/server/settings/ai', async (original) => ({
  ...await original<typeof import('@/server/settings/ai')>(),
  resolveProfileImageConfig: imageConfig,
  resolveProfileVisionConfig: visionConfig,
}));
import { testProfileConnection } from './connection-test';

const config = { profileId: 'p', apiKey: 'secret-key', enabled: true, driver: 'volcengine-ark-image', endpoint: 'https://ark.example', model: 'model-a' };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('连接测试', () => {
  it('只发送 model 探针，已认证的缺少输入校验视为成功', async () => {
    imageConfig.mockResolvedValue(config);
    let body: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return Response.json({ error: { message: 'prompt is required' } }, { status: 400 });
    }));
    await expect(testProfileConnection('p', 'image')).resolves.toBe('连接成功');
    expect(body).toEqual({ model: 'model-a' });
  });

  it.each([[401, '认证失败'], [403, '认证失败'], [404, '接口地址不可用'], [500, '服务暂时不可用']])('%s 映射为 %s', async (status, message) => {
    imageConfig.mockResolvedValue(config);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    await expect(testProfileConnection('p', 'image')).rejects.toThrow(message);
  });

  it('无效模型不被任意 400 误判成功，网络错误为地址不可用', async () => {
    visionConfig.mockResolvedValue({ ...config, driver: 'openai-compatible-vision' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'model not found' } }, { status: 400 })));
    await expect(testProfileConnection('p', 'vision')).rejects.toThrow('模型配置不可用');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(testProfileConnection('p', 'vision')).rejects.toThrow('接口地址不可用');
  });
});
