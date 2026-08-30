import { z } from 'zod';

/**
 * 通用氛围主图工作流契约（全品类共用，不做类别模板）。
 * 硬保真：锁商品身份；软联想：放展示方式。
 */

export const HeroDisplayModeSchema = z.enum(['scene-staging', 'human-interaction']);
export type HeroDisplayMode = z.infer<typeof HeroDisplayModeSchema>;

export const HeroCreativeLevelSchema = z.enum(['conservative', 'balanced', 'creative']);
export type HeroCreativeLevel = z.infer<typeof HeroCreativeLevelSchema>;

export const HeroHumanPolicySchema = z.enum(['auto', 'avoid', 'require']);
export type HeroHumanPolicy = z.infer<typeof HeroHumanPolicySchema>;

export const HeroPlanV2Schema = z.object({
  title: z.string().trim().min(1).max(80),
  displayMode: HeroDisplayModeSchema,
  humanPolicy: HeroHumanPolicySchema,
  coreSellingAngle: z.string().trim().min(1).max(200),
  preserve: z.array(z.string().trim().min(1).max(120)).min(3).max(12),
  flexible: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  scene: z.string().trim().min(1).max(240),
  composition: z.string().trim().min(1).max(240),
  lighting: z.string().trim().min(1).max(160),
  riskChecks: z.array(z.string().trim().min(1).max(120)).min(2).max(8),
  prompt: z.string().trim().min(1).max(1200),
  altPrompt: z.string().trim().min(1).max(1200).optional(),
});
export type HeroPlanV2 = z.infer<typeof HeroPlanV2Schema>;

export const HeroReviewSchema = z.object({
  passed: z.boolean(),
  score: z.number().int().min(0).max(100),
  issues: z.array(z.string().trim().min(1).max(160)).max(8),
  summary: z.string().trim().min(1).max(240),
});
export type HeroReview = z.infer<typeof HeroReviewSchema>;

/** 审片通过阈值：分数达标且不存在严重结构/身份错误。 */
export const HERO_REVIEW_PASS_SCORE = 70;
