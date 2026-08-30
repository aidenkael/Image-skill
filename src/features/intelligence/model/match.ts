import type { AssetRef } from '@/core/assets';
import type { ProductIntelligenceRecord } from '@/core/intelligence';

/**
 * 判定已持久化的 Product Intelligence 是否恰好覆盖当前选择。
 * 以「素材 id + 角色」的精确集合比较；不含 reference 的选择才应进入分析。
 */
export function intelligenceMatchesSelection(
  record: ProductIntelligenceRecord | null,
  selectedAssets: AssetRef[],
): boolean {
  if (!record || selectedAssets.length === 0) return false;

  const wanted = [...selectedAssets]
    .map((asset) => `${asset.id}:${asset.role}`)
    .sort();

  const actual = record.assetSnapshot
    .map((asset) => `${asset.id}:${asset.role}`)
    .sort();

  return wanted.length === actual.length &&
    wanted.every((value, index) => value === actual[index]);
}

/** 当前选择中可参与分析的非参考素材键（稳定排序，用作去重键） */
export function intelligenceSelectionKey(selectedAssets: AssetRef[]): string {
  return selectedAssets
    .map((asset) => `${asset.id}:${asset.role}`)
    .sort()
    .join('|');
}
