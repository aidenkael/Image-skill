import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_WORKSPACE_DRAFT,
  Workspace,
  WorkspaceDraft,
  WorkspaceDraftSchema,
  WorkspaceSchema,
} from '@/core/workspaces';
import {
  exists,
  readJson,
  runtimePath,
  UUID_RE,
  writeJson,
} from '@/server/storage/fs-store';

export class WorkspaceValidationError extends Error {}

/** 构造并约束单个商品工作区内的运行时路径。 */
export function workspaceRuntimePath(workspaceId: string, ...segments: string[]): string {
  if (!UUID_RE.test(workspaceId)) {
    throw new WorkspaceValidationError(`非法 workspace id: ${workspaceId}`);
  }
  const root = runtimePath('workspaces', workspaceId);
  const target = runtimePath('workspaces', workspaceId, ...segments);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new WorkspaceValidationError(`非法 workspace 路径: ${target}`);
  }
  return target;
}

function invalidState(label: string): WorkspaceValidationError {
  return new WorkspaceValidationError(`${label} 数据损坏或格式不合法`);
}

export async function listWorkspaces(): Promise<Workspace[]> {
  const root = runtimePath('workspaces');
  const names = await fs.readdir(root).catch(() => []);
  const workspaces: Workspace[] = [];
  for (const name of names) {
    if (!UUID_RE.test(name)) continue;
    const filePath = workspaceRuntimePath(name, 'workspace.json');
    const raw = await readJson<unknown>(filePath);
    const parsed = WorkspaceSchema.safeParse(raw);
    if (parsed.success) workspaces.push(parsed.data);
  }
  return workspaces.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getWorkspace(workspaceId: string): Promise<Workspace | null> {
  const filePath = workspaceRuntimePath(workspaceId, 'workspace.json');
  if (!(await exists(filePath))) return null;
  const parsed = WorkspaceSchema.safeParse(await readJson<unknown>(filePath));
  if (!parsed.success) throw invalidState('商品工作区');
  return parsed.data;
}

export async function createWorkspace(name: string): Promise<Workspace> {
  const validName = WorkspaceSchema.shape.name.safeParse(name);
  if (!validName.success) {
    throw new WorkspaceValidationError('商品名称需为 1..80 个字符');
  }
  const now = new Date().toISOString();
  const workspace: Workspace = {
    id: crypto.randomUUID(),
    name: validName.data,
    createdAt: now,
    updatedAt: now,
  };
  await writeJson(workspaceRuntimePath(workspace.id, 'workspace.json'), workspace);
  await writeJson(
    workspaceRuntimePath(workspace.id, 'draft.json'),
    DEFAULT_WORKSPACE_DRAFT,
  );
  return workspace;
}

export async function deleteWorkspace(workspaceId: string): Promise<boolean> {
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) return false;
  await fs.rm(workspaceRuntimePath(workspaceId), { recursive: true, force: false });
  return true;
}

export async function readWorkspaceDraft(workspaceId: string): Promise<WorkspaceDraft> {
  const filePath = workspaceRuntimePath(workspaceId, 'draft.json');
  if (!(await exists(filePath))) return WorkspaceDraftSchema.parse({});
  const parsed = WorkspaceDraftSchema.safeParse(await readJson<unknown>(filePath));
  if (!parsed.success) throw invalidState('商品草稿');
  return parsed.data;
}

export async function writeWorkspaceDraft(
  workspaceId: string,
  draft: unknown,
): Promise<WorkspaceDraft> {
  const parsed = WorkspaceDraftSchema.safeParse(draft);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new WorkspaceValidationError(`商品草稿不合法：${detail}`);
  }
  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new WorkspaceValidationError('商品工作区不存在');

  const updatedWorkspace = WorkspaceSchema.parse({
    ...workspace,
    updatedAt: new Date().toISOString(),
  });
  await writeJson(workspaceRuntimePath(workspaceId, 'draft.json'), parsed.data);
  await writeJson(
    workspaceRuntimePath(workspaceId, 'workspace.json'),
    updatedWorkspace,
  );
  return parsed.data;
}
