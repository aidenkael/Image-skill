import { z } from 'zod';
import { TaskResultSchema } from './results';

/**
 * 任务领域契约（V1 单一应用内共享）。
 * 校验规则集中在 zod schema，运行时以 schema 为准，不维护第二套独立校验。
 */

export const TASK_KINDS = ['hero', 'collage', 'detail', 'optimize'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const EXECUTABLE_TASK_KINDS: readonly TaskKind[] = ['hero', 'collage', 'optimize'];

export const HeroRatioSchema = z.enum(['1:1', '3:4', '4:3']);
export type HeroRatio = z.infer<typeof HeroRatioSchema>;

export const HeroCreativeModeSchema = z.enum(['free', 'concept', 'custom']);
export type HeroCreativeMode = z.infer<typeof HeroCreativeModeSchema>;

export const HeroHumanPresenceSchema = z.enum(['auto', 'none', 'involved']);
export type HeroHumanPresence = z.infer<typeof HeroHumanPresenceSchema>;

export const HeroTaskOptionsSchema = z.object({
  sourceAssetId: z.string().min(1),
  ratio: HeroRatioSchema,
  creativeMode: HeroCreativeModeSchema.default('free'),
  conceptId: z.string().max(40).optional(),
  creativeIntent: z.string().trim().max(500).optional(),
  humanPresence: HeroHumanPresenceSchema.default('auto'),
}).superRefine((value, ctx) => {
  if (value.creativeMode === 'concept' && !value.conceptId) {
    ctx.addIssue({
      code: 'custom',
      path: ['conceptId'],
      message: '请选择一个商品专属创意方向',
    });
  }
  if (value.creativeMode === 'custom' && !value.creativeIntent?.trim()) {
    ctx.addIssue({
      code: 'custom',
      path: ['creativeIntent'],
      message: '请填写你的创作想法',
    });
  }
});
export type HeroTaskOptions = z.infer<typeof HeroTaskOptionsSchema>;

export const CollageTaskOptionsSchema = z.object({
  templateId: z.string().min(1),
  includeTitle: z.boolean(),
  title: z.string().max(60).optional(),
  includeSellingPoints: z.boolean(),
  sellingPoints: z.array(z.string().max(40)).max(3).optional(),
});
export type CollageTaskOptions = z.infer<typeof CollageTaskOptionsSchema>;

export const OptimizeRatioSchema = z.enum(['original', '1:1', '3:4', '4:3']);
export const OptimizeFitSchema = z.enum(['contain', 'cover']);
export const OptimizeBackgroundSchema = z.enum(['white', 'light-gray']);
export const OptimizeFormatSchema = z.enum(['jpg', 'png', 'webp']);

export const OptimizeTaskOptionsSchema = z.object({
  sourceAssetId: z.string().min(1),
  ratio: OptimizeRatioSchema,
  fit: OptimizeFitSchema,
  background: OptimizeBackgroundSchema,
  maxEdge: z.union([z.literal(1024), z.literal(1600), z.literal(2000)]),
  quality: z.number().int().min(70).max(100),
  format: OptimizeFormatSchema,
});
export type OptimizeTaskOptions = z.infer<typeof OptimizeTaskOptionsSchema>;

/** 各任务类型的输出数量上限（count 按任务类型校验） */
export const TASK_COUNT_LIMITS: Record<'hero' | 'collage' | 'optimize', { min: number; max: number }> = {
  hero: { min: 1, max: 4 },
  collage: { min: 1, max: 3 },
  optimize: { min: 1, max: 1 },
};

export const TaskStatusSchema = z.enum(['queued', 'running', 'succeeded', 'failed']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const CreateTaskRequestSchema = z.object({
  kind: z.enum(TASK_KINDS),
  assetIds: z.array(z.string().min(1)).min(1).max(9),
  count: z.number().int().min(1).max(4),
  options: z.union([
    HeroTaskOptionsSchema,
    CollageTaskOptionsSchema,
    OptimizeTaskOptionsSchema,
    z.record(z.string(), z.unknown()),
  ]),
});
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;

export const TaskRecordSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  request: CreateTaskRequestSchema,
  status: TaskStatusSchema,
  result: TaskResultSchema.optional(),
  error: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export class TaskValidationError extends Error {}

export interface TaskValidationContext {
  /** 可用拼图模板 id 列表；由服务端注入（core 不读文件系统） */
  availableCollageTemplates?: readonly string[];
}

/**
 * 任务请求运行时校验（zod 为唯一事实来源）。
 * - count 按任务类型校验：hero 1..4、collage 1..3、optimize 固定 1
 * - detail 明确拒绝（后续阶段能力）
 * - collage 校验模板存在且 count 不超过可用模板数（避免生成无意义重复布局）
 */
export function validateCreateTaskRequest(
  input: unknown,
  ctx: TaskValidationContext = {},
): CreateTaskRequest {
  const parsed = CreateTaskRequestSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
      .join('; ');
    throw new TaskValidationError(`任务请求不合法：${detail}`);
  }
  const req = parsed.data;

  if (!EXECUTABLE_TASK_KINDS.includes(req.kind)) {
    throw new TaskValidationError('“详情页图”为后续阶段能力，当前不可执行');
  }

  // 可执行任务按 kind 做严格 options 校验（zod 唯一事实来源）
  if (req.kind === 'hero') {
    const parsed = HeroTaskOptionsSchema.safeParse(req.options);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || 'options'}: ${i.message}`)
        .join('; ');
      throw new TaskValidationError(`氛围主图选项不合法：${detail}`);
    }
    req.options = parsed.data;
    const [onlyAssetId] = req.assetIds;
    if (req.assetIds.length !== 1 || onlyAssetId !== parsed.data.sourceAssetId) {
      throw new TaskValidationError(
        '氛围主图必须且只能提交一张源商品图片，并与 sourceAssetId 一致',
      );
    }
  } else if (req.kind === 'collage') {
    const parsed = CollageTaskOptionsSchema.safeParse(req.options);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || 'options'}: ${i.message}`)
        .join('; ');
      throw new TaskValidationError(`组合卖点图选项不合法：${detail}`);
    }
    req.options = parsed.data;
  } else if (req.kind === 'optimize') {
    const parsed = OptimizeTaskOptionsSchema.safeParse(req.options);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || 'options'}: ${i.message}`)
        .join('; ');
      throw new TaskValidationError(`简单优化选项不合法：${detail}`);
    }
    req.options = parsed.data;
    const [onlyAssetId] = req.assetIds;
    if (req.assetIds.length !== 1 || onlyAssetId !== parsed.data.sourceAssetId) {
      throw new TaskValidationError(
        '简单优化必须且只能提交一张源商品图片，并与 sourceAssetId 一致',
      );
    }
  }

  const limits = TASK_COUNT_LIMITS[req.kind as 'hero' | 'collage' | 'optimize'];
  if (req.count < limits.min || req.count > limits.max) {
    throw new TaskValidationError(`${req.kind} 任务的输出数量必须为 ${limits.min}..${limits.max}`);
  }

  if (req.kind === 'collage') {
    const opts = req.options as CollageTaskOptions;
    const templateIds = ctx.availableCollageTemplates ?? [];
    if (templateIds.length > 0 && !templateIds.includes(opts.templateId)) {
      throw new TaskValidationError(`未知拼图模板：${opts.templateId}`);
    }
    if (templateIds.length > 0 && req.count > templateIds.length) {
      throw new TaskValidationError(
        `组合卖点图输出数量(${req.count})超过可用模板数(${templateIds.length})，已拒绝生成重复布局`,
      );
    }
  }

  return req;
}
