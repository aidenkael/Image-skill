import { describe, expect, it } from 'vitest';
import { TaskRecordSchema, validateCreateTaskRequest, TaskValidationError } from './tasks';
import { COLLAGE_TEMPLATE_IDS } from './templates';

const validHero = {
  kind: 'hero',
  assetIds: ['a1'],
  count: 2,
  options: { sourceAssetId: 'a1', ratio: '1:1', person: 'auto', sceneMode: 'auto' },
};

const validCollage = {
  kind: 'collage',
  assetIds: ['a1', 'a2', 'a3', 'a4'],
  count: 1,
  options: {
    templateId: 'left-hero-right-three',
    includeTitle: true,
    title: '夏季新品',
    includeSellingPoints: true,
    sellingPoints: ['透气', '速干'],
  },
};

const ctx = { availableCollageTemplates: COLLAGE_TEMPLATE_IDS };

describe('任务请求校验（count 按任务类型限制）', () => {
  it('合法 hero 请求通过', () => {
    const req = validateCreateTaskRequest(validHero, ctx);
    expect(req.kind).toBe('hero');
    expect(req.count).toBe(2);
  });

  it('hero count 允许 1..4', () => {
    for (const n of [1, 2, 3, 4]) {
      expect(validateCreateTaskRequest({ ...validHero, count: n }, ctx).count).toBe(n);
    }
  });

  it('hero count 越界（0 / 5）被拒绝', () => {
    expect(() => validateCreateTaskRequest({ ...validHero, count: 0 }, ctx)).toThrow(
      TaskValidationError,
    );
    expect(() => validateCreateTaskRequest({ ...validHero, count: 5 }, ctx)).toThrow(
      TaskValidationError,
    );
  });

  it('collage count 允许 1..3 且不超过模板数', () => {
    expect(validateCreateTaskRequest({ ...validCollage, count: 3 }, ctx).count).toBe(3);
    expect(() => validateCreateTaskRequest({ ...validCollage, count: 4 }, ctx)).toThrow(
      TaskValidationError,
    );
  });

  it('optimize 可执行且固定单源单输出，detail 保持拒绝', () => {
    const optimize = {
      kind: 'optimize', assetIds: ['a1'], count: 1,
      options: {
        sourceAssetId: 'a1', ratio: 'original', fit: 'contain', background: 'white',
        maxEdge: 1600, quality: 90, format: 'jpg',
      },
    };
    expect(validateCreateTaskRequest(optimize, ctx).kind).toBe('optimize');
    expect(() => validateCreateTaskRequest({ ...optimize, count: 2 }, ctx)).toThrow();
    expect(() => validateCreateTaskRequest({ ...optimize, assetIds: ['a1', 'a2'] }, ctx)).toThrow(/只能提交一张/);
    expect(() =>
      validateCreateTaskRequest({ ...validHero, kind: 'detail' }, ctx),
    ).toThrow(/后续阶段/);
  });

  it('collage 未知模板被拒绝', () => {
    expect(() =>
      validateCreateTaskRequest(
        { ...validCollage, options: { ...validCollage.options, templateId: 'nope' } },
        ctx,
      ),
    ).toThrow(TaskValidationError);
  });

  it('空 assetIds 被拒绝', () => {
    expect(() => validateCreateTaskRequest({ ...validHero, assetIds: [] }, ctx)).toThrow(
      TaskValidationError,
    );
  });

  it('hero sourceAssetId 必须属于且等于唯一提交资产', () => {
    expect(() =>
      validateCreateTaskRequest(
        { ...validHero, options: { ...validHero.options, sourceAssetId: 'a2' } },
        ctx,
      ),
    ).toThrow(/sourceAssetId/);
    expect(() =>
      validateCreateTaskRequest({ ...validHero, assetIds: ['a1', 'a2'] }, ctx),
    ).toThrow(/只能提交一张/);
  });

  it('非法 options（缺必填字段）被拒绝', () => {
    expect(() =>
      validateCreateTaskRequest(
        { ...validHero, options: { ratio: '1:1' } },
        ctx,
      ),
    ).toThrow(TaskValidationError);
  });
});

describe('任务记录归属商品工作区', () => {
  const record = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    request: validHero,
    status: 'succeeded',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
  };

  it('必须包含合法 Workspace ID', () => {
    expect(TaskRecordSchema.parse(record).workspaceId).toBe(record.workspaceId);
    const { workspaceId: _workspaceId, ...missing } = record;
    expect(() => TaskRecordSchema.parse(missing)).toThrow();
    expect(() => TaskRecordSchema.parse({ ...record, workspaceId: 'bad' })).toThrow();
  });
});
