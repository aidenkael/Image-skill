'use client';

import type { AssetRef } from '@/core/assets';
import type { TemplateDocument } from '@/core/templates';
import { parseTemplateDocument } from '@/core/templates';
import leftHeroRightThree from '@templates/collage/left-hero-right-three.json';
import topHeroBottomThree from '@templates/collage/top-hero-bottom-three.json';
import fourGrid from '@templates/collage/four-grid.json';

/**
 * 拼图模板（客户端侧）：模板 JSON 是数据，导入后经 core schema 校验。
 */

const RAW_TEMPLATES = [leftHeroRightThree, topHeroBottomThree, fourGrid] as const;

let cached: TemplateDocument[] | null = null;

export function listCollageTemplates(): TemplateDocument[] {
  if (!cached) {
    cached = RAW_TEMPLATES.map((raw) => parseTemplateDocument(raw));
  }
  return cached;
}

export function getCollageTemplate(id: string): TemplateDocument | null {
  return listCollageTemplates().find((t) => t.id === id) ?? null;
}

export interface CollageTextOptions {
  title: string;
  includeTitle: boolean;
  sellingPoints: string[];
  includeSellingPoints: boolean;
}

function sellingPointIndex(id: string): number {
  const m = /^sp-(\d+)$/.exec(id);
  return m ? Number(m[1]) - 1 : 0;
}

/** 由模板 + 选中资产 + 文本选项构建可编辑文档（不修改原模板） */
export function buildCollageDocument(
  template: TemplateDocument,
  assetIds: string[],
  opts: CollageTextOptions,
): TemplateDocument {
  const layers = template.layers.map((layer) => ({ ...layer }));
  for (const layer of layers) {
    if (layer.type === 'image') {
      const assetId = assetIds[layer.slotIndex] ?? null;
      layer.assetId = assetId;
    } else if (layer.type === 'text') {
      if (layer.tag === 'headline') {
        layer.text = opts.includeTitle ? opts.title : '';
      } else if (layer.tag === 'selling-point') {
        const idx = sellingPointIndex(layer.id);
        layer.text = opts.includeSellingPoints ? (opts.sellingPoints[idx] ?? '') : '';
      }
    }
  }
  return { ...template, layers };
}

/** 切换方案前，把当前正在编辑的方案序列化结果合并回方案列表（保留现场编辑） */
export function mergeActiveVariantEdit(
  variants: TemplateDocument[],
  activeIndex: number,
  edited: TemplateDocument | null,
): TemplateDocument[] {
  return variants.map((doc, index) =>
    index === activeIndex && edited ? edited : doc,
  );
}

function allowedCollageAssetIds(assets: AssetRef[]): Set<string> {
  return new Set(
    assets
      .filter((asset) => asset.role !== 'reference')
      .map((asset) => asset.id),
  );
}

/** 清除不存在或已成为参考图的图片内容，保留方案结构与其他编辑。 */
export function sanitizeCollageDocumentAssets(
  doc: TemplateDocument,
  assets: AssetRef[],
): TemplateDocument {
  const allowed = allowedCollageAssetIds(assets);
  let changed = false;
  const layers = doc.layers.map((layer) => {
    if (
      layer.type !== 'image' ||
      !layer.assetId ||
      allowed.has(layer.assetId)
    ) {
      return layer;
    }

    changed = true;
    return {
      ...layer,
      assetId: null,
      contentTransform: undefined,
    };
  });

  return changed ? { ...doc, layers } : doc;
}

/** 从方案中移除指定图片资产，供角色变更后的定向同步使用。 */
export function removeAssetFromCollageDocument(
  doc: TemplateDocument,
  assetId: string,
): TemplateDocument {
  let changed = false;
  const layers = doc.layers.map((layer) => {
    if (layer.type !== 'image' || layer.assetId !== assetId) return layer;

    changed = true;
    return {
      ...layer,
      assetId: null,
      contentTransform: undefined,
    };
  });

  return changed ? { ...doc, layers } : doc;
}

/** 导出前检测当前实际文档是否引用参考图或已不存在的资产。 */
export function collageDocumentUsesForbiddenAsset(
  doc: TemplateDocument,
  assets: AssetRef[],
): boolean {
  const allowed = allowedCollageAssetIds(assets);
  return doc.layers.some(
    (layer) =>
      layer.type === 'image' &&
      Boolean(layer.assetId) &&
      !allowed.has(layer.assetId!),
  );
}
