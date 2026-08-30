import crypto from 'node:crypto';
import type { AssetRef } from '@/core/assets';
import {
  HeroPlanRecordSchema,
  type HeroPlanRecord,
  type HeroPlanV2,
} from '@/core/hero-workflow';
import type { HeroCreativeLevel, HeroHumanPolicy } from '@/core/hero-workflow';
import type { HeroRatio } from '@/core/tasks';
import { readJson, writeJson } from '@/server/storage/fs-store';
import { workspaceRuntimePath } from '@/server/workspaces/service';

/**
 * Hero 执行方案持久化存储。
 * 每个 Workspace 只保存当前一个计划；旧计划被新计划覆盖。
 * 用于保证“用户看到的方案 == 服务器持久化的 == 实际执行方案”。
 */

function heroPlanFile(workspaceId: string): string {
  return workspaceRuntimePath(workspaceId, 'hero-plan.json');
}

export async function getHeroPlanRecord(
  workspaceId: string,
): Promise<HeroPlanRecord | null> {
  const raw = await readJson<unknown>(heroPlanFile(workspaceId));
  if (raw === null) return null;
  const parsed = HeroPlanRecordSchema.safeParse(raw);
  if (!parsed.success) return null;
  return parsed.data;
}

export interface CreateHeroPlanRecordInput {
  workspaceId: string;
  sourceAssetId: string;
  sourceAssetRole: AssetRef['role'];
  ratio: HeroRatio;
  creativeMode: 'recommended' | 'custom';
  creativeIntent?: string;
  humanPolicy: HeroHumanPolicy;
  creativeLevel: HeroCreativeLevel;
  plan: HeroPlanV2;
}

export async function createHeroPlanRecord(
  input: CreateHeroPlanRecordInput,
): Promise<HeroPlanRecord> {
  const record = HeroPlanRecordSchema.parse({
    id: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    sourceAssetId: input.sourceAssetId,
    sourceAssetRole: input.sourceAssetRole,
    ratio: input.ratio,
    creativeMode: input.creativeMode,
    creativeIntent: input.creativeIntent,
    humanPolicy: input.humanPolicy,
    creativeLevel: input.creativeLevel,
    createdAt: new Date().toISOString(),
    plan: input.plan,
  });
  await writeJson(heroPlanFile(input.workspaceId), record);
  return record;
}

/**
 * 判定已持久化的 HeroPlanRecord 是否仍然有效。
 * 任一关键参数变化 => 旧 plan 失效，必须重新策划。
 */
export function isHeroPlanRecordFresh(
  record: HeroPlanRecord,
  currentInput: {
    sourceAssetId: string;
    sourceAssetRole: AssetRef['role'];
    ratio: HeroRatio;
    creativeMode: 'recommended' | 'custom';
    creativeIntent?: string;
    humanPolicy: HeroHumanPolicy;
    creativeLevel: HeroCreativeLevel;
  },
  currentAssets: AssetRef[],
): boolean {
  if (record.sourceAssetId !== currentInput.sourceAssetId) return false;
  if (record.sourceAssetRole !== currentInput.sourceAssetRole) return false;
  if (record.ratio !== currentInput.ratio) return false;
  if (record.creativeMode !== currentInput.creativeMode) return false;
  if (record.humanPolicy !== currentInput.humanPolicy) return false;
  if (record.creativeLevel !== currentInput.creativeLevel) return false;
  if (record.creativeMode === 'custom') {
    const recordIntent = record.creativeIntent ?? '';
    const currentIntent = currentInput.creativeIntent?.trim() ?? '';
    if (recordIntent !== currentIntent) return false;
  }
  const sourceAsset = currentAssets.find((asset) => asset.id === record.sourceAssetId);
  if (!sourceAsset) return false;
  if (sourceAsset.role !== record.sourceAssetRole) return false;
  return true;
}
