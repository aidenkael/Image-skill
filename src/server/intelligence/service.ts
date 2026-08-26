import crypto from 'node:crypto';
import { z } from 'zod';
import {
  ProductIntelligencePayloadSchema,
  ProductIntelligenceRecordSchema,
  ProductIntelligenceRunSchema,
  PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
  type ProductIntelligencePayload,
  type ProductIntelligenceRecord,
  type ProductIntelligenceRun,
} from '@/core/intelligence';
import { assetFile, listAssets } from '@/server/assets/service';
import { makeVisionPreview } from '@/server/image/sharp';
import { AliyunQwenVisionProvider } from '@/server/providers/aliyun-qwen-vision';
import { readJson, writeJson } from '@/server/storage/fs-store';
import { getWorkspace, workspaceRuntimePath } from '@/server/workspaces/service';

const AssetIdsSchema = z.array(z.string().uuid()).min(1).max(9);
const STALE_ANALYSIS_MS = 5 * 60 * 1000;
const inFlightWorkspaces = new Map<string, string[]>();

export class IntelligenceValidationError extends Error {}
export class IntelligenceConflictError extends Error {}

export function getInFlightAnalysisAssetIds(workspaceId: string): readonly string[] {
  return inFlightWorkspaces.get(workspaceId) ?? [];
}

function intelligenceFile(workspaceId: string): string {
  return workspaceRuntimePath(workspaceId, 'intelligence.json');
}

function intelligenceRunFile(workspaceId: string): string {
  return workspaceRuntimePath(workspaceId, 'intelligence-run.json');
}

function safeRunError(error: unknown): string {
  const message = error instanceof Error ? error.message : '商品分析失败，请重试';
  return message.slice(0, 300);
}

export async function getWorkspaceIntelligence(
  workspaceId: string,
): Promise<ProductIntelligenceRecord | null> {
  const raw = await readJson<unknown>(intelligenceFile(workspaceId));
  if (raw === null) return null;
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as { schemaVersion?: unknown }).schemaVersion !==
      PRODUCT_INTELLIGENCE_SCHEMA_VERSION
  ) {
    return null;
  }
  const parsed = ProductIntelligenceRecordSchema.safeParse(raw);
  if (!parsed.success) throw new IntelligenceValidationError('商品分析记录损坏或格式不合法');
  return parsed.data;
}

export async function getWorkspaceIntelligenceRun(
  workspaceId: string,
): Promise<ProductIntelligenceRun | null> {
  const parsed = ProductIntelligenceRunSchema.safeParse(
    await readJson<unknown>(intelligenceRunFile(workspaceId)),
  );
  if (!parsed.success) return null;
  const run = parsed.data;
  if (
    run.status === 'running' &&
    Date.now() - new Date(run.updatedAt).getTime() > STALE_ANALYSIS_MS
  ) {
    const recovered = ProductIntelligenceRunSchema.parse({
      ...run,
      status: 'failed',
      updatedAt: new Date().toISOString(),
      error: '上次商品分析已中断，请重新分析',
    });
    await writeJson(intelligenceRunFile(workspaceId), recovered);
    return recovered;
  }
  return run;
}

function allEvidenceIds(payload: ProductIntelligencePayload): string[] {
  return [
    ...payload.analysis.visibleFacts.flatMap((claim) => claim.evidenceAssetIds),
    ...payload.analysis.visibleText.flatMap((claim) => claim.evidenceAssetIds),
    ...payload.analysis.assetObservations.map((item) => item.assetId),
    ...payload.plan.heroConcepts.map((item) => item.recommendedSourceAssetId),
    ...payload.plan.collage.titleOptions.flatMap((claim) => claim.evidenceAssetIds),
    ...payload.plan.collage.sellingPoints.flatMap((claim) => claim.evidenceAssetIds),
  ];
}

function factualEvidenceIds(payload: ProductIntelligencePayload): string[] {
  return [
    ...payload.analysis.visibleFacts.flatMap((claim) => claim.evidenceAssetIds),
    ...payload.analysis.visibleText.flatMap((claim) => claim.evidenceAssetIds),
    ...payload.plan.collage.titleOptions.flatMap((claim) => claim.evidenceAssetIds),
    ...payload.plan.collage.sellingPoints.flatMap((claim) => claim.evidenceAssetIds),
  ];
}

function validatePayload(
  payload: ProductIntelligencePayload,
  assetIds: string[],
  roles: Map<string, string>,
): void {
  const allowedAssetIds = new Set(assetIds);
  if (allEvidenceIds(payload).some((id) => !allowedAssetIds.has(id))) {
    throw new IntelligenceValidationError('商品分析返回了未参与分析的图片依据');
  }
  if (factualEvidenceIds(payload).some((id) => roles.get(id) === 'reference')) {
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
  const conceptIds = payload.plan.heroConcepts.map((concept) => concept.id);
  if (new Set(conceptIds).size !== conceptIds.length) {
    throw new IntelligenceValidationError('商品分析返回了重复的创意方向');
  }
  for (const concept of payload.plan.heroConcepts) {
    if (roles.get(concept.recommendedSourceAssetId) === 'reference') {
      throw new IntelligenceValidationError('参考图不能作为氛围主图的商品源图');
    }
  }
}

export async function analyzeWorkspace(
  workspaceId: string,
  rawAssetIds: unknown,
): Promise<{ intelligence: ProductIntelligenceRecord; run: ProductIntelligenceRun }> {
  const parsedIds = AssetIdsSchema.safeParse(rawAssetIds);
  if (!parsedIds.success) throw new IntelligenceValidationError('请选择 1–9 张有效商品图');
  const assetIds = parsedIds.data;
  if (new Set(assetIds).size !== assetIds.length) {
    throw new IntelligenceValidationError('商品分析素材不能重复');
  }

  const workspace = await getWorkspace(workspaceId);
  if (!workspace) throw new IntelligenceValidationError('商品工作区不存在');
  const initialAssets = await listAssets(workspaceId);
  const initialById = new Map(initialAssets.map((asset) => [asset.id, asset]));
  const assets = assetIds.map((id) => initialById.get(id));
  if (assets.some((asset) => !asset)) {
    throw new IntelligenceValidationError('分析素材不存在或不属于当前商品');
  }

  if (inFlightWorkspaces.has(workspaceId)) {
    throw new IntelligenceConflictError('当前商品正在分析，请等待完成');
  }
  inFlightWorkspaces.set(workspaceId, assetIds);

  const now = new Date().toISOString();
  let run = ProductIntelligenceRunSchema.parse({
    id: crypto.randomUUID(),
    workspaceId,
    assetIds,
    status: 'running',
    startedAt: now,
    updatedAt: now,
  });

  try {
    const persisted = await getWorkspaceIntelligenceRun(workspaceId);
    if (persisted?.status === 'running') {
      throw new IntelligenceConflictError('当前商品正在分析，请等待完成');
    }
    await writeJson(intelligenceRunFile(workspaceId), run);

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

    const currentAssets = await listAssets(workspaceId);
    const currentById = new Map(currentAssets.map((asset) => [asset.id, asset]));
    for (const asset of assets) {
      const current = currentById.get(asset!.id);
      if (!current || current.role !== asset!.role) {
        throw new IntelligenceValidationError('分析期间商品素材已变化，本次结果未保存，请重新分析');
      }
    }
    const roles = new Map(currentAssets.map((asset) => [asset.id, asset.role]));
    validatePayload(parsedPayload.data, assetIds, roles);

    const record = ProductIntelligenceRecordSchema.parse({
      ...parsedPayload.data,
      schemaVersion: PRODUCT_INTELLIGENCE_SCHEMA_VERSION,
      analyzedAt: new Date().toISOString(),
      assetSnapshot: assets.map((asset) => ({ id: asset!.id, role: asset!.role })),
    });
    await writeJson(intelligenceFile(workspaceId), record);
    run = ProductIntelligenceRunSchema.parse({
      ...run,
      status: 'succeeded',
      updatedAt: new Date().toISOString(),
    });
    await writeJson(intelligenceRunFile(workspaceId), run);
    return { intelligence: record, run };
  } catch (error) {
    if (!(error instanceof IntelligenceConflictError)) {
      run = ProductIntelligenceRunSchema.parse({
        ...run,
        status: 'failed',
        updatedAt: new Date().toISOString(),
        error: safeRunError(error),
      });
      await writeJson(intelligenceRunFile(workspaceId), run);
    }
    throw error;
  } finally {
    inFlightWorkspaces.delete(workspaceId);
  }
}
