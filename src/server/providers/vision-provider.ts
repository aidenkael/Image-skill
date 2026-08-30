import type { AssetRole } from '@/core/assets';
import type {
  HeroBatchReview,
  HeroBrief,
  HeroHumanPolicy,
} from '@/core/hero-workflow';
import type { ProductIntelligencePayload } from '@/core/intelligence';

export interface VisionAssetInput {
  assetId: string;
  role: AssetRole;
  mimeType: 'image/jpeg';
  buffer: Buffer;
}

export interface ProductIntelligenceInput {
  workspaceId: string;
  workspaceName: string;
  assets: VisionAssetInput[];
}

/**
 * Hero Director 输入：只依赖源商品图本身，不消费 Product Intelligence。
 * Product Intelligence 是独立的拼图文案/证据能力，不是 Hero 前置条件。
 */
export interface HeroDirectorInput {
  workspaceId: string;
  taskId: string;
  workspaceName: string;
  asset: VisionAssetInput;
  humanPolicy: HeroHumanPolicy;
  creativeIntent?: string;
}

/**
 * 批量 QA 输入：一次调用包含源图 + 全部候选图。
 */
export interface HeroBatchReviewInput {
  workspaceId: string;
  taskId: string;
  source: VisionAssetInput;
  generated: VisionAssetInput[];
  brief: HeroBrief;
  humanPolicy: HeroHumanPolicy;
}

/**
 * Vision 能力统一接口：商品分析、Hero 摄影策划（Director）、Hero 批量质检。
 */
export interface VisionProvider {
  analyze(input: ProductIntelligenceInput): Promise<ProductIntelligencePayload>;

  directHero(input: HeroDirectorInput): Promise<HeroBrief>;

  reviewHeroBatch(input: HeroBatchReviewInput): Promise<HeroBatchReview>;
}
