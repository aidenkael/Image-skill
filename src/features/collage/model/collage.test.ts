import { describe, expect, it } from 'vitest';
import type { AssetRef } from '@/core/assets';
import type { EditorLayer, TemplateDocument } from '@/core/templates';
import {
  buildCollageDocument,
  collageDocumentUsesForbiddenAsset,
  getCollageTemplate,
  listCollageTemplates,
  mergeActiveVariantEdit,
  removeAssetFromCollageDocument,
  sanitizeCollageDocumentAssets,
} from './collage';

/**
 * 拼图客户端模型测试（确定性，不涉及 AI）：
 * 资产按 slotIndex 确定性映射、标题/卖点开关、方案切换保留现场编辑。
 */

const TEXT_OPTS = {
  title: '夏季新品',
  includeTitle: true,
  sellingPoints: ['透气', '速干', '轻量'],
  includeSellingPoints: true,
};

describe('模板清单', () => {
  it('V1 固定 3 套拼图模板', () => {
    expect(listCollageTemplates().map((t) => t.id)).toEqual([
      'left-hero-right-three',
      'top-hero-bottom-three',
      'four-grid',
    ]);
    expect(getCollageTemplate('four-grid')?.id).toBe('four-grid');
    expect(getCollageTemplate('nope')).toBeNull();
  });
});

describe('buildCollageDocument：资产按 slotIndex 确定性映射', () => {
  it('第 i 个槽位映射第 i 个选中资产；缺少的资产保留占位（null）', () => {
    const template = getCollageTemplate('left-hero-right-three')!;
    const doc = buildCollageDocument(template, ['A', 'B'], TEXT_OPTS);
    const images = doc.layers.filter((l) => l.type === 'image');
    expect(images).toHaveLength(4);
    const bySlot = new Map(
      images.map((l) => [l.type === 'image' ? l.slotIndex : -1, l.type === 'image' ? l.assetId : null]),
    );
    expect(bySlot.get(0)).toBe('A');
    expect(bySlot.get(1)).toBe('B');
    expect(bySlot.get(2)).toBeNull();
    expect(bySlot.get(3)).toBeNull();
  });

  it('不修改原模板（每次构建独立）', () => {
    const template = getCollageTemplate('four-grid')!;
    const doc = buildCollageDocument(template, ['A', 'B', 'C', 'D'], TEXT_OPTS);
    const templateImages = template.layers.filter((l) => l.type === 'image');
    expect(templateImages.every((l) => l.type === 'image' && l.assetId === null)).toBe(true);
    expect(
      doc.layers
        .filter((l) => l.type === 'image')
        .every((l) => l.type === 'image' && typeof l.assetId === 'string'),
    ).toBe(true);
  });
});

describe('buildCollageDocument：标题 / 卖点开关', () => {
  it('开启标题时填充 headline 文本；关闭时置空', () => {
    const template = getCollageTemplate('left-hero-right-three')!;
    const on = buildCollageDocument(template, ['A'], TEXT_OPTS);
    const off = buildCollageDocument(template, ['A'], { ...TEXT_OPTS, includeTitle: false });
    const headline = (doc: TemplateDocument) =>
      doc.layers.find(
        (layer): layer is Extract<EditorLayer, { type: 'text' }> =>
          layer.type === 'text' && layer.tag === 'headline',
      );
    expect(headline(on)?.type === 'text' && headline(on)?.text).toBe('夏季新品');
    expect(headline(off)?.type === 'text' && headline(off)?.text).toBe('');
  });

  it('开启卖点时按 sp-N 顺序填充；关闭时全部置空', () => {
    const template = getCollageTemplate('left-hero-right-three')!;
    const on = buildCollageDocument(template, ['A'], TEXT_OPTS);
    const off = buildCollageDocument(template, ['A'], { ...TEXT_OPTS, includeSellingPoints: false });
    const points = (doc: TemplateDocument) =>
      doc.layers.filter((l) => l.type === 'text' && l.tag === 'selling-point');
    expect(points(on).map((l) => (l.type === 'text' ? l.text : ''))).toEqual([
      '透气',
      '速干',
      '轻量',
    ]);
    expect(points(off).every((l) => l.type === 'text' && l.text === '')).toBe(true);
  });
});

describe('mergeActiveVariantEdit：方案切换保留现场编辑', () => {
  const v0: TemplateDocument = { id: 'left-hero-right-three', name: 'v0', width: 1, height: 1, layers: [] };
  const v1: TemplateDocument = { id: 'four-grid', name: 'v1', width: 1, height: 1, layers: [] };

  it('当前方案的序列化结果被合并回列表，其他方案不受影响', () => {
    const edited: TemplateDocument = { ...v0, name: 'v0-edited' };
    const merged = mergeActiveVariantEdit([v0, v1], 0, edited);
    expect(merged[0]).toBe(edited);
    expect(merged[1]).toBe(v1);
  });

  it('无现场编辑（未创建画布）时保持原列表', () => {
    const merged = mergeActiveVariantEdit([v0, v1], 0, null);
    expect(merged).toEqual([v0, v1]);
  });
});

function asset(id: string, role: AssetRef['role']): AssetRef {
  return {
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    width: 100,
    height: 100,
    role,
    createdAt: '2026-08-25T00:00:00.000Z',
  };
}

describe('Collage 图片资产净化', () => {
  const validTransform = { left: 1, top: 2, scaleX: 1.1, scaleY: 1.2 };
  const removedTransform = { left: 3, top: 4, scaleX: 1.3, scaleY: 1.4 };
  const doc: TemplateDocument = {
    id: 'four-grid',
    name: '保留的方案名',
    width: 800,
    height: 800,
    layers: [
      {
        type: 'image', id: 'valid', x: 0, y: 0, width: 100, height: 100,
        fit: 'cover', slotIndex: 0, assetId: 'product', contentTransform: validTransform,
      },
      {
        type: 'image', id: 'reference', x: 100, y: 0, width: 100, height: 100,
        fit: 'cover', slotIndex: 1, assetId: 'reference', contentTransform: removedTransform,
      },
      {
        type: 'image', id: 'missing', x: 200, y: 0, width: 100, height: 100,
        fit: 'contain', slotIndex: 2, assetId: 'missing', contentTransform: removedTransform,
      },
      {
        type: 'text', id: 'title', x: 0, y: 120, width: 300,
        text: '保留用户文案', fontSize: 32, tag: 'headline',
      },
      {
        type: 'shape', id: 'background', x: 0, y: 0, width: 800, height: 800,
        fill: '#fff',
      },
    ],
  };
  const assets = [asset('product', 'front'), asset('reference', 'reference')];

  it('只清除参考图和缺失图，同时保留方案、有效图片、文字、形状与原输入', () => {
    const before = structuredClone(doc);
    const sanitized = sanitizeCollageDocumentAssets(doc, assets);

    expect(sanitized).not.toBe(doc);
    expect(sanitized).toMatchObject({
      id: doc.id,
      name: doc.name,
      width: doc.width,
      height: doc.height,
    });
    expect(sanitized.layers[0]).toEqual(doc.layers[0]);
    expect(sanitized.layers[1]).toMatchObject({ assetId: null });
    expect(sanitized.layers[2]).toMatchObject({ assetId: null });
    expect(sanitized.layers[1]).toHaveProperty('contentTransform', undefined);
    expect(sanitized.layers[2]).toHaveProperty('contentTransform', undefined);
    expect(sanitized.layers[3]).toBe(doc.layers[3]);
    expect(sanitized.layers[4]).toBe(doc.layers[4]);
    expect(doc).toEqual(before);
  });

  it('定向移除只影响指定图片，并清除属于该图片的变换', () => {
    const removed = removeAssetFromCollageDocument(doc, 'reference');

    expect(removed.layers[0]).toEqual(doc.layers[0]);
    expect(removed.layers[1]).toMatchObject({ assetId: null });
    expect(removed.layers[1]).toHaveProperty('contentTransform', undefined);
    expect(removed.layers[2]).toBe(doc.layers[2]);
    expect(removeAssetFromCollageDocument(doc, 'not-used')).toBe(doc);
  });

  it('禁止资产检测与净化语义一致', () => {
    expect(collageDocumentUsesForbiddenAsset(doc, assets)).toBe(true);
    const sanitized = sanitizeCollageDocumentAssets(doc, assets);
    expect(collageDocumentUsesForbiddenAsset(sanitized, assets)).toBe(false);
    expect(sanitizeCollageDocumentAssets(sanitized, assets)).toBe(sanitized);
  });
});
