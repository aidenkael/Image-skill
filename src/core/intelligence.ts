import { z } from 'zod';
import { ASSET_ROLES, type AssetRef } from './assets';

export const EvidenceClaimSchema = z.object({
  text: z.string().trim().min(1).max(100),
  evidenceAssetIds: z.array(z.string().uuid()).min(1).max(4),
});

export const CollageTitleClaimSchema = EvidenceClaimSchema.extend({
  text: z.string().trim().min(1).max(60),
});

export const CollageSellingPointClaimSchema = EvidenceClaimSchema.extend({
  text: z.string().trim().min(1).max(40),
});

export const AssetObservationSchema = z.object({
  assetId: z.string().uuid(),
  suggestedRole: z.enum(ASSET_ROLES),
  quality: z.enum(['good', 'usable', 'weak']),
  note: z.string().trim().min(1).max(120),
});

export const ProductAnalysisSchema = z.object({
  category: z.string().trim().min(1).max(60),
  visualSummary: z.string().trim().min(1).max(240),
  visibleFacts: z.array(EvidenceClaimSchema).max(8),
  visibleText: z.array(EvidenceClaimSchema).max(5),
  unverifiedFacts: z.array(z.string().trim().min(1).max(100)).max(8),
  assetObservations: z.array(AssetObservationSchema).min(1).max(9),
});

export const HeroDirectionSchema = z.object({
  id: z.enum(['hero-1', 'hero-2', 'hero-3']),
  title: z.string().trim().min(1).max(40),
  sourceAssetId: z.string().uuid(),
  scene: z.string().trim().min(1).max(140),
  composition: z.string().trim().min(1).max(120),
  lighting: z.string().trim().min(1).max(100),
  person: z.enum(['none', 'hand', 'person']),
  prompt: z.string().trim().min(1).max(700),
  reason: z.string().trim().min(1).max(140),
});

export const CollageCopyPlanSchema = z.object({
  titleOptions: z.array(CollageTitleClaimSchema).max(3),
  sellingPoints: z.array(CollageSellingPointClaimSchema).max(6),
});

export const VisualPlanSchema = z.object({
  heroDirections: z.array(HeroDirectionSchema).min(1).max(3),
  collage: CollageCopyPlanSchema,
});

export const ProductIntelligencePayloadSchema = z.object({
  analysis: ProductAnalysisSchema,
  plan: VisualPlanSchema,
});

export const IntelligenceAssetSnapshotSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(ASSET_ROLES),
});

export const PRODUCT_INTELLIGENCE_SCHEMA_VERSION = 2 as const;

export const ProductIntelligenceRecordSchema = ProductIntelligencePayloadSchema.extend({
  schemaVersion: z.literal(PRODUCT_INTELLIGENCE_SCHEMA_VERSION),
  analyzedAt: z.string(),
  assetSnapshot: z.array(IntelligenceAssetSnapshotSchema).min(1).max(9),
});

export type ProductIntelligencePayload = z.infer<typeof ProductIntelligencePayloadSchema>;
export type ProductIntelligenceRecord = z.infer<typeof ProductIntelligenceRecordSchema>;

export function isIntelligenceFresh(
  record: ProductIntelligenceRecord,
  assets: AssetRef[],
): boolean {
  const current = new Map(assets.map((asset) => [asset.id, asset.role]));
  return record.assetSnapshot.every(
    (snapshot) => current.get(snapshot.id) === snapshot.role,
  );
}
