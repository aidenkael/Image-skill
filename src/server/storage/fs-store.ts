import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * V1 本地文件系统存储（.runtime/，不入 Git）。
 * 元数据与运行文件都放这里；不引入数据库。
 */

export function runtimeDir(): string {
  return process.env.RUNTIME_DIR
    ? path.resolve(process.env.RUNTIME_DIR)
    : path.join(process.cwd(), '.runtime');
}

/** 构造运行时路径并防止目录穿越 */
export function runtimePath(...segments: string[]): string {
  const base = runtimeDir();
  const target = path.resolve(base, ...segments);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`非法运行时路径: ${target}`);
  }
  return target;
}

export async function ensureDir(...segments: string[]): Promise<string> {
  const dir = runtimePath(...segments);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeBuffer(filePath: string, data: Buffer): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, data);
}

export async function readBuffer(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function listJsonFiles(dir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dir);
    return names.filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
