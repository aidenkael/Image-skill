import type { AssetRole } from '@/core/assets';
import type {
  HeroCreativeLevel,
  HeroDisplayMode,
  HeroHumanPolicy,
  HeroPlanV2,
  HeroReview,
} from '@/core/hero-workflow';
import type { HeroRuntimePlan, ProductIntelligencePayload } from '@/core/intelligence';

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

export interface HeroPlanningInput {
  workspaceId: string;
  workspaceName: string;
  asset: VisionAssetInput;
  creativeIntent?: string;
}

export interface HeroPlanV2Input {
  workspaceId: string;
  workspaceName: string;
  asset: VisionAssetInput;
  humanPolicy: HeroHumanPolicy;
  creativeLevel: HeroCreativeLevel;
  creativeIntent?: string;
  /** 新鲜 Product Intelligence 的商品理解（仅作策划上下文，不作为生成入口） */
  productUnderstanding?: string;
}

export interface HeroReviewInput {
  workspaceId: string;
  source: VisionAssetInput;
  generated: VisionAssetInput;
  displayMode: HeroDisplayMode;
  humanPolicy: HeroHumanPolicy;
  preserve: readonly string[];
  flexible: readonly string[];
}

export interface ProductIntelligenceProvider {
  analyze(input: ProductIntelligenceInput): Promise<ProductIntelligencePayload>;
  planHero(input: HeroPlanningInput): Promise<HeroRuntimePlan>;
  planHeroV2(input: HeroPlanV2Input): Promise<HeroPlanV2>;
  reviewHero(input: HeroReviewInput): Promise<HeroReview>;
}
