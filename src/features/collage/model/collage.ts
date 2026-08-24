'use client';

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
