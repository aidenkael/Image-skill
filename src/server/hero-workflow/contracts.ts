import type { AssetRole } from '@/core/assets';
import type { HeroCreativeLevel, HeroHumanPolicy, HeroPlanV2, HeroReview } from '@/core/hero-workflow';
import type { AssetRef } from '@/core/assets';
import type { ProductIntelligenceRecord } from '@/core/intelligence';

/**
 * 通用氛围主图工作流内部契约。
 * 编排：策划（planner）→ 执行（executor）→ 审片（reviewer）。
 */

export interface HeroWorkflowInput {
  workspaceId: string;
  workspaceName: string;
  taskId: string;
  /** 源商品图本地路径（图片生成 Provider 输入） */
  sourceImagePath: string;
  /** 源商品图 vision 预览（jpeg，策划与审片共用） */
  sourcePreview: Buffer;
  sourceAssetId: string;
  sourceAssetRole: AssetRole;
  ratio: '1:1' | '3:4' | '4:3';
  count: number;
  humanPolicy: HeroHumanPolicy;
  creativeLevel: HeroCreativeLevel;
  creativeIntent?: string;
}

/** 策划阶段上下文：仅消费新鲜 Product Intelligence 的商品理解 */
export interface HeroWorkflowContext {
  intelligence: ProductIntelligenceRecord | null;
  assets: AssetRef[];
}

export interface HeroWorkflowCandidate {
  url?: string;
  localPath: string;
  review: HeroReview;
}

export interface HeroWorkflowOutcome {
  plan: HeroPlanV2;
  /** 通过审片的结果，按 score 降序 */
  candidates: HeroWorkflowCandidate[];
}
