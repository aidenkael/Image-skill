import { describe, expect, it } from 'vitest';
import { validateCreateTaskRequest, TaskValidationError } from './tasks';
import { COLLAGE_TEMPLATE_IDS } from './templates';

const validHero = {
  kind: 'hero',
  assetIds: ['a1'],
  count: 2,
  options: { ratio: '1:1', person: 'auto', sceneMode: 'auto' },
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

  it('detail / optimize 明确拒绝（V2 阶段）', () => {
    expect(() =>
      validateCreateTaskRequest({ ...validHero, kind: 'detail' }, ctx),
    ).toThrow(/V2 阶段/);
    expect(() =>
      validateCreateTaskRequest({ ...validHero, kind: 'optimize' }, ctx),
    ).toThrow(/V2 阶段/);
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

  it('非法 options（缺必填字段）被拒绝', () => {
    expect(() =>
      validateCreateTaskRequest(
        { ...validHero, options: { ratio: '1:1' } },
        ctx,
      ),
    ).toThrow(TaskValidationError);
  });
});
