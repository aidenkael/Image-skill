import fs from 'node:fs/promises';
import { runtimePath } from '@/server/storage/fs-store';

export interface AILogEvent {
  timestamp?: string;
  requestId: string;
  operation: string;
  workspaceId?: string;
  profileId?: string;
  driver?: string;
  provider?: string;
  model?: string;
  endpoint?: string;
  status: 'succeeded' | 'failed';
  httpStatus?: number;
  durationMs: number;
  usage?: unknown;
  failureStage?: string;
  errorName?: string;
  errorMessage?: string;
  zodIssues?: Array<{ path: string; code: string; message: string }>;
  responseSnippet?: string;
  assetCount?: number;
  assetIds?: string[];
  count?: number;
  ratio?: string;
  /** Hero workflow 关键信息 */
  displayMode?: string;
  humanPolicy?: string;
  creativeLevel?: string;
  reviewScore?: number;
  reviewPassed?: boolean;
  normalization?: 'single-item-array-unwrapped';
  apiKey?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function sanitizeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return '[INVALID_ENDPOINT]';
  }
}

export function sanitizeAISnippet(value: string, apiKey?: string): string {
  let sanitized = value.replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=_-]+/gi, '[IMAGE_REDACTED]');
  if (apiKey) sanitized = sanitized.replace(new RegExp(escapeRegExp(apiKey), 'g'), '[SECRET_REDACTED]');
  return sanitized.slice(0, 4000);
}

export function aiLogFile(timestamp = new Date()): string {
  return runtimePath('logs', `ai-${timestamp.toISOString().slice(0, 10)}.jsonl`);
}

/** Local-only diagnostics. Failures here must never affect the AI operation. */
export async function writeAILog(event: AILogEvent): Promise<void> {
  try {
    const { apiKey, endpoint, responseSnippet, ...safeEvent } = event;
    const line = {
      ...safeEvent,
      timestamp: event.timestamp ?? new Date().toISOString(),
      ...(endpoint ? { endpoint: sanitizeEndpoint(endpoint) } : {}),
      ...(responseSnippet ? { responseSnippet: sanitizeAISnippet(responseSnippet, apiKey) } : {}),
    };
    const file = aiLogFile(new Date(line.timestamp));
    await fs.mkdir(runtimePath('logs'), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(line)}\n`, 'utf8');
  } catch {
    // Diagnostics must not turn a provider success into a user-visible failure.
  }
}
