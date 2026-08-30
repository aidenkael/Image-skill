import fs from 'node:fs/promises';
import path from 'node:path';
import { runtimePath } from '@/server/storage/fs-store';

/**
 * AI Provider 请求级诊断日志。
 * 一个实际 provider HTTP 请求 = 一个独立 JSON 文件（不再按天聚合 JSONL）。
 * 路径：.runtime/logs/ai/YYYY-MM-DD/HHmmss_SSS_<safe-operation>_<requestId8>.json
 * 同一逻辑 Vision 操作的多次协议降级/重试请求共享 traceId，各自独立 requestId。
 */

export interface AIRequestLog {
  timestamp: string;
  /** 一个实际 HTTP 请求一个 ID */
  requestId: string;
  /** 关联同一逻辑操作的多次降级/重试 HTTP 请求 */
  traceId?: string;
  operation: string;

  workspaceId?: string;
  taskId?: string;
  profileId?: string;

  /** Benchmark Lab 追踪（可选，仅 Lab 请求携带） */
  benchmarkRunId?: string;
  benchmarkScenario?: string;
  benchmarkLane?: string;

  driver?: string;
  model?: string;
  endpoint?: string;

  status: 'succeeded' | 'failed';
  httpStatus?: number;
  durationMs: number;

  requestBody?: unknown;
  responseBody?: unknown;
  parsedResult?: unknown;

  failureStage?: string;
  errorName?: string;
  errorMessage?: string;

  /** 额外结构化诊断字段（结构化模式、归一化、zod issues 等） */
  extra?: Record<string, unknown>;

  /** 需要全局抹除的已知密钥串（如当前配置的 API Key）；本字段本身不落盘 */
  redact?: string[];
}

const SECRET_KEY_PATTERN = /^(api[_-]?key|apikey|authorization|x-api-key|token)$/i;
const DATA_IMAGE_PATTERN = /^data:image\//i;
const EMBEDDED_DATA_IMAGE_PATTERN = /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi;
const BASE64_BLOB_PATTERN = /^[a-z0-9+/=\s]+$/i;
/** 超过该长度的纯 base64 文本视为原始图片/二进制负载，不落盘 */
const BASE64_REDACT_MIN_LENGTH = 800;

export function sanitizeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[INVALID_ENDPOINT]';
  }
}

/**
 * 递归脱敏：密钥/凭据、data: 图片、大段 base64/二进制。
 * 保留可读文本 prompt 与结构化解析结果（HeroBrief / HeroBatchReview 等）。
 */
export function sanitizeForLog(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (DATA_IMAGE_PATTERN.test(value)) return '[IMAGE_REDACTED]';
    if (/^bearer\s+/i.test(value)) return '[SECRET_REDACTED]';
    if (value.length > BASE64_REDACT_MIN_LENGTH && BASE64_BLOB_PATTERN.test(value)) {
      return '[BASE64_REDACTED]';
    }
    // 文本中嵌入的 data 图片片段同样脱敏（保留其余可读文本）
    return value.replace(EMBEDDED_DATA_IMAGE_PATTERN, '[IMAGE_REDACTED]');
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeForLog(item));
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        result[key] = '[SECRET_REDACTED]';
        continue;
      }
      result[key] = sanitizeForLog(item);
    }
    return result;
  }
  return value;
}

/** 全局抹除已知密钥串（出现在任何字符串值中均被替换） */
export function scrubKnownSecrets(value: unknown, secrets: string[]): unknown {
  const active = secrets.filter((secret) => typeof secret === 'string' && secret.length > 0);
  if (active.length === 0) return value;
  if (typeof value === 'string') {
    let result = value;
    for (const secret of active) result = result.split(secret).join('[SECRET_REDACTED]');
    return result;
  }
  if (Array.isArray(value)) return value.map((item) => scrubKnownSecrets(item, active));
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = scrubKnownSecrets(item, active);
    }
    return result;
  }
  return value;
}

/** 文件名安全的操作名：小写字母数字与连字符 */
export function safeOperationName(operation: string): string {
  const safe = operation.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'unknown';
}

export function aiRequestLogFile(event: Pick<AIRequestLog, 'timestamp' | 'requestId' | 'operation'>): string {
  const date = event.timestamp.slice(0, 10);
  const time = `${event.timestamp.slice(11, 13)}${event.timestamp.slice(14, 16)}${event.timestamp.slice(17, 19)}_${event.timestamp.slice(20, 23)}`;
  const requestIdPart = event.requestId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  return runtimePath(
    'logs', 'ai', date,
    `${time}_${safeOperationName(event.operation)}_${requestIdPart}.json`,
  );
}

/** Local-only diagnostics. Failures here must never affect the AI operation. */
export async function writeAIRequestLog(event: AIRequestLog): Promise<void> {
  try {
    const { endpoint, requestBody, responseBody, parsedResult, errorMessage, redact, ...rest } = event;
    const file = aiRequestLogFile(event);
    const sanitized = sanitizeForLog({
      ...rest,
      ...(endpoint ? { endpoint: sanitizeEndpoint(endpoint) } : {}),
      ...(requestBody !== undefined ? { requestBody } : {}),
      ...(responseBody !== undefined ? { responseBody } : {}),
      ...(parsedResult !== undefined ? { parsedResult } : {}),
      ...(errorMessage !== undefined
        ? { errorMessage: errorMessage.slice(0, 4000) }
        : {}),
    });
    const document = redact?.length ? scrubKnownSecrets(sanitized, redact) : sanitized;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  } catch {
    // Diagnostics must not turn a provider success into a user-visible failure.
  }
}
