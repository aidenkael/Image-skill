import crypto from 'node:crypto';
import sharp from 'sharp';
import type { AIConnectionCapability } from '@/core/system';
import { writeAILog } from '@/server/logging/ai-log';
import {
  AISettingsValidationError,
  resolveProfileImageConfig,
  resolveProfileVisionConfig,
} from '@/server/settings/ai';

export class AIConnectionTestError extends Error {}

function errorText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const value = body as { error?: unknown; message?: unknown; code?: unknown };
  const nested = value.error && typeof value.error === 'object'
    ? value.error as { message?: unknown; code?: unknown; type?: unknown }
    : null;
  return [value.message, value.code, nested?.message, nested?.code, nested?.type]
    .filter((item): item is string => typeof item === 'string')
    .join(' ').toLowerCase();
}

function classifyFailure(status: number, body: unknown): never {
  if (status === 401 || status === 403) throw new AIConnectionTestError('认证失败');
  if (status === 404) throw new AIConnectionTestError('接口地址不可用');
  if (status >= 500) throw new AIConnectionTestError('服务暂时不可用');
  const text = errorText(body);
  if (/model.*(invalid|not found|unsupported|不存在|无效)|invalid.*model|model_not_found/.test(text)) {
    throw new AIConnectionTestError('模型配置不可用');
  }
  throw new AIConnectionTestError(status >= 400 && status < 500 ? '连接失败' : '模型配置不可用');
}

function responseText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const text = (item as { text?: unknown }).text;
    return typeof text === 'string' ? [text] : [];
  }).join('');
}

async function visionProbe(profileId: string): Promise<{ color: 'RED' | 'GREEN' | 'BLUE'; dataUri: string }> {
  const colors = ['RED', 'GREEN', 'BLUE'] as const;
  const color = colors[crypto.createHash('sha256').update(profileId).digest()[0] % colors.length];
  const background = color.toLowerCase();
  const buffer = await sharp({ create: { width: 256, height: 256, channels: 3, background } }).png().toBuffer();
  return { color, dataUri: `data:image/png;base64,${buffer.toString('base64')}` };
}

export async function testProfileConnection(
  profileId: string,
  capability: AIConnectionCapability,
): Promise<string> {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  const operation = capability === 'vision' ? 'vision.connection-test' : 'image.connection-test';
  let config;
  try {
    config = capability === 'vision'
      ? await resolveProfileVisionConfig(profileId)
      : await resolveProfileImageConfig(profileId);
  } catch (error) {
    await writeAILog({ requestId, operation, profileId, status: 'failed', durationMs: Date.now() - started,
      failureStage: 'config', errorName: error instanceof Error ? error.name : undefined,
      errorMessage: error instanceof Error ? error.message : 'Unknown error' });
    if (error instanceof AISettingsValidationError) throw error;
    throw new AIConnectionTestError('连接失败');
  }
  const log = (event: Omit<Parameters<typeof writeAILog>[0], 'requestId' | 'operation' | 'profileId' | 'driver' | 'model' | 'endpoint' | 'durationMs' | 'apiKey'>) => writeAILog({
    ...event, requestId, operation, profileId, driver: config.driver, provider: config.driver,
    model: config.model, endpoint: config.endpoint, apiKey: config.apiKey, durationMs: Date.now() - started,
  });
  let response: Response | undefined;
  try {
    if (capability !== 'vision') {
      response = await fetch(config.endpoint, {
        method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model }), signal: AbortSignal.timeout(30_000),
      });
      let body: unknown = null;
      try { body = await response.json(); } catch { /* status is sufficient */ }
      if (response.status === 400 && /(missing|required).*(message|prompt|image|input)|(message|prompt|image|input).*(missing|required)/.test(errorText(body))) {
        await log({ status: 'succeeded', httpStatus: response.status });
        return '连接成功';
      }
      if (response.ok) {
        await log({ status: 'succeeded', httpStatus: response.status });
        return '连接成功';
      }
      return classifyFailure(response.status, body);
    }
    const probe = await visionProbe(profileId);
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: probe.dataUri } },
          { type: 'text', text: 'Identify the dominant color of this image. Reply with exactly one uppercase word: RED, GREEN, or BLUE.' },
        ] }],
        max_tokens: 8,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    let body: unknown = null;
    try { body = await response.json(); } catch { /* status is sufficient */ }
    if (!response.ok) return classifyFailure(response.status, body);
    const content = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
    if (responseText(content).trim().toUpperCase() !== probe.color) {
      throw new AIConnectionTestError('模型未通过识图测试');
    }
    await log({ status: 'succeeded', httpStatus: response.status });
    return '连接成功';
  } catch (error) {
    await log({ status: 'failed', httpStatus: response?.status, failureStage: response ? 'http' : 'fetch',
      errorName: error instanceof Error ? error.name : undefined,
      errorMessage: error instanceof Error ? error.message : 'Unknown error' });
    if (!response) throw new AIConnectionTestError('接口地址不可用');
    throw error;
  }
}
