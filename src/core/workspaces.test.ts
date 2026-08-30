import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WORKSPACE_DRAFT,
  WorkspaceDraftSchema,
  WorkspaceSchema,
} from './workspaces';

describe('商品工作区契约', () => {
  it('WorkspaceSchema 校验 UUID、名称与时间字段', () => {
    const workspace = WorkspaceSchema.parse({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      name: '  夏季连衣裙  ',
      createdAt: '2026-08-25T00:00:00.000Z',
      updatedAt: '2026-08-25T00:00:00.000Z',
    });
    expect(workspace.name).toBe('夏季连衣裙');
    expect(() => WorkspaceSchema.parse({ ...workspace, id: 'bad' })).toThrow();
    expect(() => WorkspaceSchema.parse({ ...workspace, name: '' })).toThrow();
  });

  it('WorkspaceDraftSchema 生成并校验完整默认草稿', () => {
    expect(WorkspaceDraftSchema.parse({})).toEqual(DEFAULT_WORKSPACE_DRAFT);
    expect(DEFAULT_WORKSPACE_DRAFT.heroOptions.sourceAssetId).toBe('');
    expect(DEFAULT_WORKSPACE_DRAFT.heroOptions).toMatchObject({
      creativeMode: 'recommended',
      creativeIntent: '',
      humanPresence: 'auto',
      creativeLevel: 'balanced',
    });
    expect(DEFAULT_WORKSPACE_DRAFT.collageVariants).toEqual([]);
    expect(DEFAULT_WORKSPACE_DRAFT.latestHeroTaskId).toBeNull();
  });

  it('旧 Hero 草稿字段被丢弃并补入新默认值，历史枚举值被归一化', () => {
    const draft = WorkspaceDraftSchema.parse({
      heroOptions: {
        sourceAssetId: '',
        ratio: '1:1',
        person: 'hand',
        sceneMode: 'prompt',
        directionId: 'old',
        scenePrompt: '旧场景',
        creativeMode: 'free',
        humanPresence: 'involved',
      },
    });
    expect(draft.heroOptions).toEqual({
      sourceAssetId: '',
      ratio: '1:1',
      creativeMode: 'recommended',
      creativeIntent: '',
      humanPresence: 'require',
      creativeLevel: 'balanced',
      planId: null,
    });
  });

  it('活动客户端源码不再引用全局资源或任务 API', () => {
    const root = path.resolve(process.cwd(), 'src', 'features');
    const pending = [root];
    const sourceFiles: string[] = [];
    while (pending.length > 0) {
      const current = pending.pop();
      if (!current) continue;
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const next = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(next);
        else if (/\.tsx?$/.test(entry.name)) sourceFiles.push(next);
      }
    }
    const source = sourceFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    expect(source).not.toMatch(/['"]\/api\/assets(?:['"/])/);
    expect(source).not.toMatch(/['"]\/api\/tasks(?:['"/])/);
  });
});
