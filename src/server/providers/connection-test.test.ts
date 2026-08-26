import { afterEach, describe, expect, it, vi } from 'vitest';
import crypto from 'node:crypto';

const { imageConfig, visionConfig } = vi.hoisted(() => ({ imageConfig: vi.fn(), visionConfig: vi.fn() }));
vi.mock('@/server/settings/ai', async (original) => ({
  ...await original<typeof import('@/server/settings/ai')>(),
  resolveProfileImageConfig: imageConfig,
  resolveProfileVisionConfig: visionConfig,
}));
import { testProfileConnection } from './connection-test';

const config = { profileId: 'p', apiKey: 'secret-key', enabled: true, driver: 'volcengine-ark-image', endpoint: 'https://ark.example', model: 'model-a' };
const probeColor = (['RED', 'GREEN', 'BLUE'] as const)[crypto.createHash('sha256').update('p').digest()[0] % 3];
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('连接测试', () => {
  it('图片测试仅发送非生成 model 探针', async () => {
    imageConfig.mockResolvedValue(config);
    let body: unknown;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return Response.json({ error: { message: 'prompt is required' } }, { status: 400 });
    }));
    await expect(testProfileConnection('p', 'image')).resolves.toBe('连接成功');
    expect(body).toEqual({ model: 'model-a' });
  });

  it('识图测试发送真实 256x256 图片和颜色问题，仅正确答案成功', async () => {
    visionConfig.mockResolvedValue({ ...config, driver: 'openai-compatible-vision' });
    let body: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return Response.json({ choices: [{ message: { content: probeColor } }] });
    }));
    await expect(testProfileConnection('p', 'vision')).resolves.toBe('连接成功');
    expect(body).toMatchObject({ model: 'model-a', max_tokens: 8, stream: false });
    expect(body).not.toEqual({ model: 'model-a' });
    const content = (body.messages as Array<{ content: Array<{ type: string; image_url?: { url: string }; text?: string }> }>)[0].content;
    expect(content[0].image_url?.url).toMatch(/^data:image\/png;base64,/);
    expect(content[1].text).toContain('Identify the dominant color');
  });

  it('识图答案错误或 400 均不视为成功', async () => {
    visionConfig.mockResolvedValue({ ...config, driver: 'openai-compatible-vision' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: 'PURPLE' } }] })));
    await expect(testProfileConnection('p', 'vision')).rejects.toThrow('模型未通过识图测试');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'invalid request' } }, { status: 400 })));
    await expect(testProfileConnection('p', 'vision')).rejects.toThrow('连接失败');
  });

  it.each([[401, '认证失败'], [403, '认证失败'], [404, '接口地址不可用'], [500, '服务暂时不可用']])('%s 映射为 %s', async (status, message) => {
    visionConfig.mockResolvedValue({ ...config, driver: 'openai-compatible-vision' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
    await expect(testProfileConnection('p', 'vision')).rejects.toThrow(message);
  });

  it('无效模型不被任意 400 误判成功，网络错误为地址不可用', async () => {
    visionConfig.mockResolvedValue({ ...config, driver: 'openai-compatible-vision' });
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'model not found' } }, { status: 400 })));
    await expect(testProfileConnection('p', 'vision')).rejects.toThrow('模型配置不可用');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    await expect(testProfileConnection('p', 'vision')).rejects.toThrow('接口地址不可用');
  });
});
