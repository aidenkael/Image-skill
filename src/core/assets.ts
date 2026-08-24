import { z } from 'zod';

/**
 * 资源（商品图）领域契约。
 * 纯类型与规则，不依赖 React / Node / Provider。
 */

export const ASSET_ROLES = [
  'primary',
  'front',
  'back',
  'side',
  'inside',
  'detail',
  'size',
  'reference',
  'unknown',
] as const;
export type AssetRole = (typeof ASSET_ROLES)[number];

export const ALLOWED_ASSET_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AssetMimeType = (typeof ALLOWED_ASSET_MIME_TYPES)[number];

/** V1 单张上传大小上限 */
export const MAX_ASSET_BYTES = 20 * 1024 * 1024;

export const AssetRefSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.enum(ALLOWED_ASSET_MIME_TYPES),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  role: z.enum(ASSET_ROLES),
  createdAt: z.string(),
});
export type AssetRef = z.infer<typeof AssetRefSchema>;

export function normalizeRole(value: unknown, fallback: AssetRole = 'unknown'): AssetRole {
  return ASSET_ROLES.includes(value as AssetRole) ? (value as AssetRole) : fallback;
}

export function isAllowedMimeType(mime: string): mime is AssetMimeType {
  return (ALLOWED_ASSET_MIME_TYPES as readonly string[]).includes(mime);
}
