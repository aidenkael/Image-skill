import { z } from 'zod';
import type { StructuredOutputMode } from '@/core/system';

/* ── JSON Schema helpers ── */

type JsonSchema = Record<string, unknown>;

export function sanitizeJsonSchema(schema: unknown): JsonSchema {
  const input = schema as JsonSchema;
  const output: JsonSchema = {};
  if (typeof input.type === 'string') output.type = input.type;
  if (typeof input.description === 'string') output.description = input.description;
  if (Array.isArray(input.enum)) output.enum = input.enum;
  if (Array.isArray(input.required)) output.required = input.required;
  if (typeof input.additionalProperties === 'boolean') output.additionalProperties = input.additionalProperties;
  if (input.items && typeof input.items === 'object') output.items = sanitizeJsonSchema(input.items);
  if (input.properties && typeof input.properties === 'object') {
    output.properties = Object.fromEntries(
      Object.entries(input.properties as JsonSchema).map(([key, value]) => [key, sanitizeJsonSchema(value)]),
    );
  }
  return output;
}

/** Build a strict json_schema response_format from a Zod schema. */
export function buildStrictResponseFormat(name: string, schema: z.ZodType): Record<string, unknown> {
  const json = sanitizeJsonSchema(z.toJSONSchema(schema));
  json.additionalProperties = false;
  const properties = json.properties as JsonSchema | undefined;
  if (properties) json.required = Object.keys(properties);
  return { type: 'json_schema', json_schema: { name, strict: true, schema: json } };
}

/** Build a json_object response_format. */
export function buildJsonObjectResponseFormat(): Record<string, unknown> {
  return { type: 'json_object' };
}

/* ── Content extraction ── */

export function extractTextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    const text = (item as { text?: unknown }).text;
    return typeof text === 'string' ? [text] : [];
  }).join('');
}

export function extractResponseUsage(body: unknown): unknown {
  return body && typeof body === 'object' ? (body as { usage?: unknown }).usage : undefined;
}

/* ── Normalization ── */

export function normalizeStructuredPayload<T extends z.ZodType>(
  parsed: unknown,
  schema: T,
): { success: true; data: z.output<T>; normalization?: 'single-item-array-unwrapped' }
  | { success: false; error: z.ZodError } {
  const direct = schema.safeParse(parsed);
  if (direct.success) return direct;
  if (!Array.isArray(parsed) || parsed.length !== 1 || parsed[0] === null || typeof parsed[0] !== 'object' || Array.isArray(parsed[0])) {
    return { success: false, error: direct.error };
  }
  const unwrapped = schema.safeParse(parsed[0]);
  if (!unwrapped.success) return { success: false, error: unwrapped.error };
  return { success: true, data: unwrapped.data, normalization: 'single-item-array-unwrapped' };
}

/* ── Text-JSON extraction ── */

/**
 * Extract a JSON object from text-json response.
 * Allows: bare JSON, markdown code fence, single-item array wrap.
 */
export function extractJsonFromText(raw: string): unknown {
  const trimmed = raw.trim();
  // Try direct parse
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  // Try markdown code fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* continue */ }
  }
  // Try to find a JSON object in the text
  const braceStart = trimmed.indexOf('{');
  const braceEnd = trimmed.lastIndexOf('}');
  if (braceStart !== -1 && braceEnd > braceStart) {
    try { return JSON.parse(trimmed.slice(braceStart, braceEnd + 1)); } catch { /* continue */ }
  }
  throw new Error('Unable to extract JSON from text response');
}

/* ── Mode resolution ── */

export interface StructuredOutputModeResult {
  mode: 'json-schema' | 'json-object' | 'text-json';
  responseFormat: Record<string, unknown> | null;
  systemSuffix?: string;
}

export function resolveStructuredMode(
  requestedMode: StructuredOutputMode,
  schemaName: string,
  zodSchema: z.ZodType,
  jsonSchemaOverride?: JsonSchema,
): StructuredOutputModeResult {
  if (requestedMode === 'json-schema' || requestedMode === 'auto') {
    const jsonSchema = jsonSchemaOverride
      ? { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema: jsonSchemaOverride } }
      : buildStrictResponseFormat(schemaName, zodSchema);
    return { mode: 'json-schema', responseFormat: jsonSchema };
  }
  if (requestedMode === 'json-object') {
    return {
      mode: 'json-object',
      responseFormat: buildJsonObjectResponseFormat(),
      systemSuffix: 'Return exactly one JSON object strictly matching the supplied schema. Do not add, remove or rename fields.',
    };
  }
  // text-json
  return {
    mode: 'text-json',
    responseFormat: null,
    systemSuffix: 'Return ONLY raw JSON. No markdown, no explanation, no surrounding text.',
  };
}

/** Downgrade mode after explicit protocol unsupported error. */
export function downgradeMode(current: 'json-schema' | 'json-object' | 'text-json'): 'json-object' | 'text-json' | null {
  if (current === 'json-schema') return 'json-object';
  if (current === 'json-object') return 'text-json';
  return null;
}

/**
 * Check whether an HTTP error indicates the structured output mode is unsupported
 * (as opposed to auth/rate-limit/server errors which must NOT trigger fallback).
 */
export function isStructuredOutputUnsupported(httpStatus: number, body: string): boolean {
  if (httpStatus !== 400 && httpStatus !== 422) return false;
  const lower = body.toLowerCase();
  return /response_format|json_schema|json_object|structured output|format.*not.*support|unsupported.*format/i.test(lower);
}

/**
 * Parse raw text as JSON (supports text-json mode extraction).
 */
export function parseRawJson(raw: string): unknown {
  const trimmed = raw.trim();
  try { return JSON.parse(trimmed); } catch { /* continue */ }
  // For text-json mode, try extraction from surrounding text
  return extractJsonFromText(trimmed);
}

export function zodIssues(error: unknown): Array<{ path: string; code: string; message: string }> | undefined {
  if (!(error instanceof z.ZodError)) return undefined;
  return error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }));
}
