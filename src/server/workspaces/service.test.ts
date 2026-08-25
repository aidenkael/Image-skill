import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { workspaceRuntimePath, WorkspaceValidationError } from './service';

const workspaceA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
});
