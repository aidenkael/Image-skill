import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  workspaceRuntimePath,
  WorkspaceValidationError,
} from './service';

const workspaceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const previousRuntime = process.env.RUNTIME_DIR;
let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-service-'));
  process.env.RUNTIME_DIR = path.join(root, '.runtime');
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
afterAll(() => {
  if (previousRuntime === undefined) delete process.env.RUNTIME_DIR;
  else process.env.RUNTIME_DIR = previousRuntime;
});

describe('商品工作区运行时路径隔离', () => {
  it('拒绝非法 Workspace ID 与离开 Workspace 根目录的路径', () => {
    expect(() => workspaceRuntimePath('bad', 'assets')).toThrow(WorkspaceValidationError);
    expect(() => workspaceRuntimePath(workspaceA, '..', workspaceB, 'assets')).toThrow(
      WorkspaceValidationError,
    );
  });

  it('两个 Workspace 的资源、任务和输出根目录均不同', () => {
    for (const segment of ['assets', 'tasks', 'outputs']) {
      const rootA = workspaceRuntimePath(workspaceA, segment);
      const rootB = workspaceRuntimePath(workspaceB, segment);
      expect(rootA).not.toBe(rootB);
      expect(path.basename(path.dirname(rootA))).toBe(workspaceA);
      expect(path.basename(path.dirname(rootB))).toBe(workspaceB);
    }
  });

  it('删除只移除目标 Workspace 目录', async () => {
    const first = await createWorkspace('商品一');
    const second = await createWorkspace('商品二');
    await expect(deleteWorkspace(first.id)).resolves.toBe(true);
    await expect(getWorkspace(first.id)).resolves.toBeNull();
    await expect(getWorkspace(second.id)).resolves.toMatchObject({ id: second.id });
    await expect(fs.access(workspaceRuntimePath(second.id))).resolves.toBeUndefined();
  });
});
