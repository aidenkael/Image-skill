import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { aiLogFile, sanitizeAISnippet, sanitizeEndpoint, writeAILog } from './ai-log';

let root = '';
beforeAll(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-log-')); process.env.RUNTIME_DIR = path.join(root, '.runtime'); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); delete process.env.RUNTIME_DIR; });

describe('AI 诊断日志', () => {
  it('写入单行 JSONL，并脱敏端点、密钥和图片数据', async () => {
    const apiKey = 'secret-key-for-test';
    await writeAILog({ requestId: 'request-id', operation: 'vision.product-analysis', status: 'failed', durationMs: 12,
      endpoint: 'https://user:pass@example.com/path?token=1#fragment', apiKey,
      responseSnippet: `${apiKey} data:image/png;base64,ABCDEFGH`, failureStage: 'content-json-parse' });
    const event = JSON.parse((await fs.readFile(aiLogFile(), 'utf8')).trim());
    expect(event.endpoint).toBe('https://example.com/path');
    expect(event.responseSnippet).toContain('[SECRET_REDACTED]');
    expect(event.responseSnippet).toContain('[IMAGE_REDACTED]');
    expect(JSON.stringify(event)).not.toContain(apiKey);
  });

  it('日志写入错误不会冒泡', async () => {
    const append = vi.spyOn(fs, 'appendFile').mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(writeAILog({ requestId: 'request-id-2', operation: 'vision.hero-planning', status: 'failed', durationMs: 1 })).resolves.toBeUndefined();
    append.mockRestore();
  });

  it('公开清洗工具不保留端点凭据、查询或 data URI', () => {
    expect(sanitizeEndpoint('https://u:p@host.example/api?q=1#x')).toBe('https://host.example/api');
    expect(sanitizeAISnippet('data:image/jpeg;base64,AAAA secret', 'secret')).toBe('[IMAGE_REDACTED] [SECRET_REDACTED]');
  });
});
