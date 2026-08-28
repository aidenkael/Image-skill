import type { AssetRole } from '@/core/assets';
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

export interface ProductIntelligenceProvider {
  analyze(input: ProductIntelligenceInput): Promise<ProductIntelligencePayload>;
  planHero(input: HeroPlanningInput): Promise<HeroRuntimePlan>;
}
