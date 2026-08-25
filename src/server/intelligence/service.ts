import { z } from 'zod';
import {
  ProductIntelligencePayloadSchema,
  ProductIntelligenceRecordSchema,
  type ProductIntelligencePayload,
  type ProductIntelligenceRecord,
} from '@/core/intelligence';
import { assetFile, listAssets } from '@/server/assets/service';
import { makeVisionPreview } from '@/server/image/sharp';
import { AliyunQwenVisionProvider } from '@/server/providers/aliyun-qwen-vision';
import { readJson, writeJson } from '@/server/storage/fs-store';
import { getWorkspace, workspaceRuntimePath } from '@/server/workspaces/service';

const AssetIdsSchema = z.array(z.string().uuid()).min(1).max(9);

export class IntelligenceValidationError extends Error {}

function intelligenceFile(workspaceId: string): string {
  return workspaceRuntimePath(workspaceId, 'intelligence.json');
}

export async function getWorkspaceIntelligence(
  workspaceId: string,
): Promise<ProductIntelligenceRecord | null> {
  const raw = await readJson<unknown>(intelligenceFile(workspaceId));
  if (raw === null) return null;
  const parsed = ProductIntelligenceRecordSchema.safeParse(raw);
  if (!parsed.success) throw new IntelligenceValidationError('商品分析记录损坏或格式不合法');
  return parsed.data;
}

function allEvidenceIds(payload: ProductIntelligencePayload): string[] {
  return [
    ...payload.analysis.visibleFacts.flatMap((claim) => claim.evidenceAssetIds),
    ...payload.analysis.visibleText.flatMap((claim) => claim.evidenceAssetIds),
    ...payload.analysis.assetObservations.map((item) => item.assetId),
    ...payload.plan.heroDirections.map((item) => item.sourceAssetId),
    ...payload.plan.collage.sellingPoints.flatMap((claim) => claim.evidenceAssetIds),
  ];
}

function factualEvidenceIds(payload: ProductIntelligencePayload): string[] {
  return [
    ...payload.analysis.visibleFacts.flatMap((claim) => claim.evidenceAssetIds),
    ...payload.analysis.visibleText.flatMap((claim) => claim.evidenceAssetIds),
    ...payload.plan.collage.sellingPoints.flatMap((claim) => claim.evidenceAssetIds),
  ];
}

export async function analyzeWorkspace(
  workspaceId: string,
  rawAssetIds: unknown,
): Promise<ProductIntelligenceRecord> {
  const parsedIds = AssetIdsSchema.safeParse(rawAssetIds);
  if (!parsedIds.success) throw new IntelligenceValidationError('请选择 1–9 张有效商品图');
  const assetIds = parsedIds.data;
  if (new Set(assetIds).size !== assetIds.length) {
    throw new IntelligenceValidationError('商品分析素材不能重复');
  }

  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new IntelligenceValidationError('商品工作区不存在');
  const allAssets = await listAssets(workspaceId);
  const byId = new Map(allAssets.map((asset) => [asset.id, asset]));
  const assets = assetIds.map((id) => byId.get(id));
  if (assets.some((asset) => !asset)) {
    throw new IntelligenceValidationError('分析素材不存在或不属于当前商品');
  }

  const providerInputs = await Promise.all(
    assets.map(async (asset) => {
      if (!asset) throw new IntelligenceValidationError('分析素材元数据不存在');
      const source = await assetFile(workspaceId, asset.id, 'original');
      if (!source) throw new IntelligenceValidationError(`无法读取分析素材：${asset.name}`);
      return {
        assetId: asset.id,
        role: asset.role,
        mimeType: 'image/jpeg' as const,
        buffer: await makeVisionPreview(source.buffer),
      };
    }),
  );

  const rawPayload = await new AliyunQwenVisionProvider().analyze({
    workspaceName: workspace.name,
    assets: providerInputs,
  });
  const parsedPayload = ProductIntelligencePayloadSchema.safeParse(rawPayload);
  if (!parsedPayload.success) {
    throw new IntelligenceValidationError('商品分析响应不符合结构化数据要求');
  }
  const payload = parsedPayload.data;
  const allowedAssetIds = new Set(assetIds);
  if (allEvidenceIds(payload).some((id) => !allowedAssetIds.has(id))) {
    throw new IntelligenceValidationError('商品分析返回了未参与分析的图片依据');
  }
  if (factualEvidenceIds(payload).some((id) => byId.get(id)?.role === 'reference')) {
    throw new IntelligenceValidationError('参考图只能用于视觉方向，不能作为商品事实或卖点依据');
  }

  const observationIds = payload.analysis.assetObservations.map((item) => item.assetId);
  if (
    observationIds.length !== assetIds.length ||
    new Set(observationIds).size !== observationIds.length ||
    assetIds.some((id) => !observationIds.includes(id))
  ) {
    throw new IntelligenceValidationError('商品分析必须逐张返回且只能返回一条素材观察');
  }
  const directionIds = payload.plan.heroDirections.map((direction) => direction.id);
  if (new Set(directionIds).size !== directionIds.length) {
    throw new IntelligenceValidationError('商品分析返回了重复的视觉方向');
  }
  for (const direction of payload.plan.heroDirections) {
    if (byId.get(direction.sourceAssetId)?.role === 'reference') {
      throw new IntelligenceValidationError('参考图不能作为氛围主图的商品源图');
    }
  }

  const record = ProductIntelligenceRecordSchema.parse({
    ...payload,
    analyzedAt: new Date().toISOString(),
    assetSnapshot: assets.map((asset) => ({ id: asset!.id, role: asset!.role })),
  });
  await writeJson(intelligenceFile(workspaceId), record);
  return record;
}
