import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { aiRequestLogFile, sanitizeEndpoint, sanitizeForLog, writeAIRequestLog, type AIRequestLog } from './ai-log';

let root = '';
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-log-')); process.env.RUNTIME_DIR = path.join(root, '.runtime'); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); delete process.env.RUNTIME_DIR; });
afterEach(() => vi.restoreAllMocks());

function event(overrides: Partial<AIRequestLog> = {}): AIRequestLog {
  return {
    timestamp: '2026-08-30T14:19:23.427Z',
    requestId: 'a1b2c3d4-0000-4000-8000-000000000000',
    operation: 'hero-director',
    status: 'succeeded',
    durationMs: 12,
    ...overrides,
  };
}

async function readLog(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

describe('每 HTTP 请求一个 JSON 文件', () => {
  it('两个请求 ID 写出两个独立 .json 文件，文件名含操作名与请求 ID 片段', async () => {
    await writeAIRequestLog(event());
    await writeAIRequestLog(event({ requestId: 'e5f60718-1111-4111-8111-111111111111', operation: 'image-generation' }));
    const dir = path.join(root, '.runtime', 'logs', 'ai', '2026-08-30');
    const files = (await fs.readdir(dir)).sort();
    expect(files).toHaveLength(2);
    expect(files[0]).toMatch(/^141923_427_hero-director_a1b2c3d4\.json$/);
    expect(files[1]).toMatch(/image-generation_e5f60718\.json$/);
  });

  it('新日志器不写按天聚合的 JSONL 文件', async () => {
    await writeAIRequestLog(event({ requestId: '99999999-2222-4222-8222-222222222222' }));
    const logsDir = path.join(root, '.runtime', 'logs');
    const entries = await fs.readdir(logsDir);
    expect(entries.filter((name) => name.endsWith('.jsonl'))).toEqual([]);
  });

  it('aiRequestLogFile 路径按日期分目录并净化操作名', () => {
    const file = aiRequestLogFile(event({ operation: 'Vision.Hero Review!' }));
    expect(file).toContain(path.join('logs', 'ai', '2026-08-30'));
    expect(path.basename(file)).toMatch(/^141923_427_vision-hero-review_a1b2c3d4\.json$/);
  });
});

describe('脱敏与保留诊断信息', () => {
  it('文本 prompt 保留，data 图片、密钥与 Bearer 令牌被脱敏', async () => {
    const file = aiRequestLogFile(event({ requestId: 'abcdef12-3333-4333-8333-333333333333' }));
    await writeAIRequestLog(event({
      requestId: 'abcdef12-3333-4333-8333-333333333333',
      endpoint: 'https://user:pass@example.com/path?token=1#fragment',
      redact: ['secret-key-for-test'],
      requestBody: {
        apiKey: 'secret-key-for-test',
        authorization: 'Bearer secret-key-for-test',
        messages: [
          { role: 'user', content: [
            { type: 'text', text: '你是电商摄影总监，请策划一张氛围主图' },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAABBBBCCCCDDDDEEEE' } },
          ] },
        ],
      },
      responseBody: 'secret-key-for-test data:image/png;base64,FFFFGGGG',
      parsedResult: { title: '晨光桌面' },
    }));
    const logged = await readLog(file);
    const raw = JSON.stringify(logged);
    expect(raw).toContain('你是电商摄影总监，请策划一张氛围主图');
    expect(raw).toContain('[IMAGE_REDACTED]');
    expect(raw).toContain('[SECRET_REDACTED]');
    expect(raw).not.toContain('secret-key-for-test');
    expect(raw).not.toContain('Bearer secret');
    expect((logged.parsedResult as { title: string }).title).toBe('晨光桌面');
  });

  it('端点仅保留协议/主机/路径，查询串被去除', async () => {
    const file = aiRequestLogFile(event({ requestId: 'abcdef34-4444-4444-8444-444444444444' }));
    await writeAIRequestLog(event({
      requestId: 'abcdef34-4444-4444-8444-444444444444',
      endpoint: 'https://api.example.com/v1/chat?api_key=leak&foo=1',
    }));
    const logged = await readLog(file);
    expect(logged.endpoint).toBe('https://api.example.com/v1/chat');
    expect(JSON.stringify(logged)).not.toContain('leak');
  });

  it('大段 base64 负载不落盘', () => {
    const blob = 'A'.repeat(2000);
    expect(sanitizeForLog({ image: blob })).toEqual({ image: '[BASE64_REDACTED]' });
    expect(sanitizeForLog({ prompt: '短文本保留' })).toEqual({ prompt: '短文本保留' });
    expect(sanitizeForLog(['data:image/png;base64,AAAA', 42])).toEqual(['[IMAGE_REDACTED]', 42]);
  });

  it('日志写入错误不会冒泡', async () => {
    const write = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(writeAIRequestLog(event({ requestId: 'request2-5555-4555-8555-555555555555' }))).resolves.toBeUndefined();
    write.mockRestore();
  });

  it('公开端点净化工具不保留凭据与查询', () => {
    expect(sanitizeEndpoint('https://u:p@host.example/api?q=1#x')).toBe('https://host.example/api');
  });
});
