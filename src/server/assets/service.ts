import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {
  AssetRef,
  AssetRole,
  ALLOWED_ASSET_MIME_TYPES,
  ASSET_ROLES,
  AssetMimeType,
  MAX_ASSET_BYTES,
  isAllowedMimeType,
} from '@/core/assets';
import { readImageMeta, makeThumbnail } from '@/server/image/sharp';
import {
  writeBuffer,
  writeJson,
  readJson,
  readBuffer,
  UUID_RE,
} from '@/server/storage/fs-store';
import { workspaceRuntimePath } from '@/server/workspaces/service';

/**
 * 资源（商品图）服务：上传校验、原图/缩略图落盘、小 JSON 元数据持久化。
 * 元数据只存相对文件名，绝不向客户端暴露本地绝对路径。
 */

export class AssetValidationError extends Error {}

export interface UploadedAssetFile {
  buffer: Buffer;
  name: string;
  mimeType: string;
}

const EXT_BY_MIME: Record<AssetMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function assertSafeId(id: string): void {
  if (!UUID_RE.test(id)) throw new AssetValidationError(`非法资源 id: ${id}`);
}

function sniffMime(fileName: string, buffer: Buffer): AssetMimeType | null {
  const b = buffer.subarray(0, 12);
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return 'image/png';
  }
  if (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return null;
}

export async function saveAsset(workspaceId: string, file: UploadedAssetFile): Promise<AssetRef> {
  if (!file.buffer || file.buffer.length === 0) throw new AssetValidationError('上传文件为空');
  if (file.buffer.length > MAX_ASSET_BYTES) {
    throw new AssetValidationError(
      `图片超过大小上限 ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)}MB`,
    );
  }

  const mime: AssetMimeType | null = isAllowedMimeType(file.mimeType)
    ? file.mimeType
    : sniffMime(file.name, file.buffer);
  if (!mime) throw new AssetValidationError('仅支持 JPEG / PNG / WebP 图片');

  let meta;
  try {
    meta = await readImageMeta(file.buffer);
  } catch {
    throw new AssetValidationError('文件不是有效的图片');
  }

  const id = crypto.randomUUID();
  const ext = EXT_BY_MIME[mime];
  await writeBuffer(workspaceRuntimePath(workspaceId, 'assets', id, `original.${ext}`), file.buffer);
  const thumb = await makeThumbnail(file.buffer, 320);
  await writeBuffer(workspaceRuntimePath(workspaceId, 'assets', id, 'thumb.png'), thumb);

  const asset: AssetRef = {
    id,
    name: file.name || `${id}.${ext}`,
    mimeType: mime,
    width: meta.width,
    height: meta.height,
    role: 'unknown',
    createdAt: new Date().toISOString(),
  };
  await writeJson(workspaceRuntimePath(workspaceId, 'assets', id, 'asset.json'), asset);
  return asset;
}

export async function getAsset(workspaceId: string, id: string): Promise<AssetRef | null> {
  assertSafeId(id);
  return readJson<AssetRef>(workspaceRuntimePath(workspaceId, 'assets', id, 'asset.json'));
}

export async function listAssets(workspaceId: string): Promise<AssetRef[]> {
  const dir = workspaceRuntimePath(workspaceId, 'assets');
  const names = await fs.readdir(dir).catch(() => []);
  const assets: AssetRef[] = [];
  for (const name of names) {
    if (!UUID_RE.test(name)) continue;
    const asset = await readJson<AssetRef>(
      workspaceRuntimePath(workspaceId, 'assets', name, 'asset.json'),
    );
    if (asset) assets.push(asset);
  }
  return assets.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function setAssetRole(
  workspaceId: string,
  id: string,
  role: AssetRole,
): Promise<AssetRef | null> {
  assertSafeId(id);
  const asset = await getAsset(workspaceId, id);
  if (!asset) return null;
  const next: AssetRef = { ...asset, role };
  await writeJson(workspaceRuntimePath(workspaceId, 'assets', id, 'asset.json'), next);
  return next;
}

/** 约定：第一个上传的资源自动设为 primary（资源角色可被用户修正） */
export async function ensurePrimaryAsset(workspaceId: string): Promise<void> {
  const all = await listAssets(workspaceId);
  if (all.length === 0) return;
  const hasPrimary = all.some((a) => a.role === 'primary');
  if (!hasPrimary) {
    await setAssetRole(workspaceId, all[all.length - 1].id, 'primary');
  }
}

export interface AssetFileResult {
  buffer: Buffer;
  mimeType: string;
  filePath: string;
}

export async function assetFile(
  workspaceId: string,
  id: string,
  variant: 'original' | 'thumb',
): Promise<AssetFileResult | null> {
  assertSafeId(id);
  const asset = await getAsset(workspaceId, id);
  if (!asset) return null;
  const ext = EXT_BY_MIME[asset.mimeType];
  const filePath =
    variant === 'thumb'
      ? workspaceRuntimePath(workspaceId, 'assets', id, 'thumb.png')
      : workspaceRuntimePath(workspaceId, 'assets', id, `original.${ext}`);
  const buffer = await readBuffer(filePath);
  if (!buffer) return null;
  return {
    buffer,
    mimeType: variant === 'thumb' ? 'image/png' : asset.mimeType,
    filePath,
  };
}

export function isKnownRole(value: unknown): value is AssetRole {
  return (ASSET_ROLES as readonly string[]).includes(value as string);
}
