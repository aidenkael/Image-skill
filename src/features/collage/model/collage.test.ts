import { describe, expect, it } from 'vitest';
import type { EditorLayer, TemplateDocument } from '@/core/templates';
import {
  buildCollageDocument,
  getCollageTemplate,
  listCollageTemplates,
  mergeActiveVariantEdit,
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
