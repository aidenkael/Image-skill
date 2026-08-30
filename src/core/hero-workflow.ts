import { z } from 'zod';

/**
 * 一键氛围主图工作流领域契约（全品类共用，不做类别模板）。
 * 编排：Vision Director → 确定性 Prompt Compiler → Image Provider → 批量 Vision QA → 至多一次反馈补生。
 *
 * HeroBrief 是 Director 的摄影决策结果：只描述展示方式与保真边界，
 * 不包含最终生成 prompt（prompt 由确定性编译器生成）、评分或创意等级。
 */

export const HeroRatioSchema = z.enum(['1:1', '3:4', '4:3']);
export type HeroRatio = z.infer<typeof HeroRatioSchema>;

export const HeroDisplayModeSchema = z.enum(['scene-staging', 'human-interaction']);
export type HeroDisplayMode = z.infer<typeof HeroDisplayModeSchema>;

export const HeroHumanPolicySchema = z.enum(['auto', 'avoid', 'require']);
export type HeroHumanPolicy = z.infer<typeof HeroHumanPolicySchema>;

/**
 * 可动物理部件（背带/链条/提手/织物部件等）。
 * 分离「不可改变的身份/拓扑」与「允许的自然物理状态变化」，
 * 避免把关节部件冻结为源图的 2D 姿态，也避免结构幻觉。
 */
export const HeroMovablePartSchema = z.object({
  name: z.string().trim().min(1).max(80),
  /** 该部件物理上是什么，以及哪些可见身份特征保持不变 */
  fixedIdentity: z.string().trim().min(1).max(240),
  /** 连接点、连续性、近似长度/比例、数量/拓扑关系 */
  fixedRelations: z.array(z.string().trim().min(1).max(160)).min(1).max(6),
  /** 重力/使用/人体交互下物理上合理的姿态/状态变化 */
  allowedMotion: z.array(z.string().trim().min(1).max(160)).min(1).max(6),
  /** 禁止：断裂、复制、脱离、明显缩短/加长、接到错误位置、穿透物体等 */
  forbiddenChanges: z.array(z.string().trim().min(1).max(160)).min(1).max(8),
});
export type HeroMovablePart = z.infer<typeof HeroMovablePartSchema>;

/**
 * Director 的摄影策划结果。
 * 刚性商品无有效可动部件时 movableParts = []。
 */
export const HeroBriefSchema = z.object({
  title: z.string().trim().min(1).max(80),

  productIdentity: z.object({
    summary: z.string().trim().min(1).max(240),
    fixedTraits: z.array(z.string().trim().min(1).max(160)).min(3).max(12),
    movableParts: z.array(HeroMovablePartSchema).max(8),
  }),

  presentation: z.object({
    mode: HeroDisplayModeSchema,
    reason: z.string().trim().min(1).max(240),
    interaction: z.string().trim().min(1).max(240).nullable(),
    scene: z.string().trim().min(1).max(300),
    camera: z.string().trim().min(1).max(240),
    lighting: z.string().trim().min(1).max(200),
    depthOfField: z.string().trim().min(1).max(180),
    scaleCue: z.string().trim().min(1).max(200).nullable(),
  }),

  forbiddenChanges: z.array(z.string().trim().min(1).max(160)).min(3).max(12),
});
export type HeroBrief = z.infer<typeof HeroBriefSchema>;

/**
 * 按人物政策收窄 HeroBrief 的结构校验：
 * require/avoid 的人物政策在 Schema 层硬强制，使 Director 的 structured output、
 * 协议 fallback 与 schema retry 自动遵守同一业务不变量；auto 保持自由决策。
 */
export function heroBriefSchemaForHumanPolicy(
  policy: HeroHumanPolicy,
) {
  if (policy === 'require') {
    return HeroBriefSchema.extend({
      presentation: HeroBriefSchema.shape.presentation.extend({
        mode: z.enum(['human-interaction']),
        interaction: z.string().trim().min(1).max(240),
      }),
    });
  }

  if (policy === 'avoid') {
    return HeroBriefSchema.extend({
      presentation: HeroBriefSchema.shape.presentation.extend({
        mode: z.enum(['scene-staging']),
        interaction: z.null(),
      }),
    });
  }

  return HeroBriefSchema;
}

/** 硬性结构失败：任一存在即该候选图不可用（服务端确定性判定）。 */
export const HeroHardFailureSchema = z.enum([
  'product_identity_changed',
  'part_missing',
  'part_added',
  'topology_broken',
  'attachment_wrong',
  'quantity_changed',
  'proportion_wrong',
  'text_logo_pattern_corrupted',
  'impossible_human_contact',
  /** 人物政策违反：require 缺少有意义人物互动，或 avoid 出现任何人物/人体部位 */
  'human_policy_violated',
  'severe_generation_artifact',
]);
export type HeroHardFailure = z.infer<typeof HeroHardFailureSchema>;

/** 软性质量问题：影响排序但不直接判定不可用。 */
export const HeroSoftIssueSchema = z.enum([
  'scene_mismatch',
  'scale_unconvincing',
  'excessive_bokeh',
  'unnatural_dof',
  'lighting_mismatch',
  'weak_composition',
  'minor_ai_look',
]);
export type HeroSoftIssue = z.infer<typeof HeroSoftIssueSchema>;

export const HeroCandidateAssessmentSchema = z.object({
  candidateIndex: z.number().int().min(0).max(7),
  hardFailures: z.array(HeroHardFailureSchema).max(10),
  softIssues: z.array(HeroSoftIssueSchema).max(7),
  /** 针对该候选的具体修复指令，供一次反馈补生使用 */
  repairInstruction: z.string().trim().min(1).max(500).nullable(),
});
export type HeroCandidateAssessment = z.infer<typeof HeroCandidateAssessmentSchema>;

/**
 * 批量 QA 结果：一次 Vision 调用评审全部候选图。
 * usable 由服务端从 hardFailures 推导，不信任模型自报的布尔。
 */
export const HeroBatchReviewSchema = z.object({
  assessments: z.array(HeroCandidateAssessmentSchema).min(1).max(8),
  /** 偏好顺序（可用候选在前），元素为候选索引 */
  preferredOrder: z.array(z.number().int().min(0).max(7)).min(1).max(8),
});
export type HeroBatchReview = z.infer<typeof HeroBatchReviewSchema>;
