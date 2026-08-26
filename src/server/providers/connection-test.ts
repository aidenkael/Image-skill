import type { AIConnectionCapability } from '@/core/system';
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

function classify(status: number, body: unknown): string {
  if (status >= 200 && status < 300) return '连接成功';
  if (status === 401 || status === 403) throw new AIConnectionTestError('认证失败');
  if (status === 404) throw new AIConnectionTestError('接口地址不可用');
  if (status >= 500) throw new AIConnectionTestError('服务暂时不可用');
  const text = errorText(body);
  if (/model.*(invalid|not found|unsupported|不存在|无效)|invalid.*model|model_not_found/.test(text)) {
    throw new AIConnectionTestError('模型配置不可用');
  }
  if (status === 400 && /(missing|required).*(message|prompt|image|input)|(message|prompt|image|input).*(missing|required)/.test(text)) {
    return '连接成功';
  }
  throw new AIConnectionTestError('模型配置不可用');
}

export async function testProfileConnection(
  profileId: string,
  capability: AIConnectionCapability,
): Promise<string> {
  let config;
  try {
    config = capability === 'vision'
      ? await resolveProfileVisionConfig(profileId)
      : await resolveProfileImageConfig(profileId);
  } catch (error) {
    if (error instanceof AISettingsValidationError) throw error;
    throw new AIConnectionTestError('连接失败');
  }
  let response: Response;
  try {
    response = await fetch(config.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: config.model }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch { throw new AIConnectionTestError('接口地址不可用'); }
  let body: unknown = null;
  try { body = await response.json(); } catch { /* status is sufficient */ }
  return classify(response.status, body);
}
