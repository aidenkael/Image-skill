import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  parseTemplateDocument,
  TemplateValidationError,
  COLLAGE_TEMPLATE_IDS,
} from './templates';

const templatesDir = path.resolve(process.cwd(), 'templates', 'collage');

function loadTemplate(id: string): unknown {
  const raw = fs.readFileSync(path.join(templatesDir, `${id}.json`), 'utf8');
  return JSON.parse(raw);
}

describe('模板文档校验', () => {
  it('三个拼图模板均通过 schema 校验且 id 在允许列表', () => {
    for (const id of COLLAGE_TEMPLATE_IDS) {
      const doc = parseTemplateDocument(loadTemplate(id));
      expect(doc.id).toBe(id);
      expect(doc.width).toBeGreaterThan(0);
      expect(doc.height).toBeGreaterThan(0);
      expect(doc.layers.length).toBeGreaterThan(0);
      expect(doc.layers.every((l) => l.type === 'image' || l.type === 'text' || l.type === 'shape')).toBe(
        true,
      );
    }
  });

  it('left-hero-right-three：1 大图 + 3 小图槽位 + 主标题', () => {
    const doc = parseTemplateDocument(loadTemplate('left-hero-right-three'));
    const images = doc.layers.filter((l) => l.type === 'image');
    expect(images).toHaveLength(4);
    const hero = images.find((l) => l.type === 'image' && l.slotIndex === 0);
    expect(hero?.type === 'image' && hero.width > 600).toBe(true);
    expect(doc.layers.some((l) => l.type === 'text' && l.tag === 'headline')).toBe(true);
    expect(doc.layers.filter((l) => l.type === 'text' && l.tag === 'selling-point')).toHaveLength(3);
  });

  it('top-hero-bottom-three：1 大图 + 3 小图槽位', () => {
    const doc = parseTemplateDocument(loadTemplate('top-hero-bottom-three'));
    expect(doc.layers.filter((l) => l.type === 'image')).toHaveLength(4);
    const hero = doc.layers.find((l) => l.type === 'image' && l.slotIndex === 0);
    expect(hero?.type === 'image' && hero.width > doc.width * 0.5).toBe(true);
  });

  it('four-grid：4 等大图 + 标题 + 卖点区', () => {
    const doc = parseTemplateDocument(loadTemplate('four-grid'));
    const images = doc.layers.filter((l) => l.type === 'image');
    expect(images).toHaveLength(4);
    const widths = new Set(images.map((l) => (l.type === 'image' ? l.width : 0)));
    expect(widths.size).toBe(1);
    expect(doc.layers.some((l) => l.type === 'text' && l.tag === 'headline')).toBe(true);
  });

  it('非法文档被拒绝（未知图层类型）', () => {
    const bad = {
      id: 'left-hero-right-three',
      name: 'bad',
      width: 1080,
      height: 1350,
      layers: [{ type: 'video', id: 'v1', x: 0, y: 0 }],
    };
    expect(() => parseTemplateDocument(bad)).toThrow(TemplateValidationError);
  });

  it('未知模板 id 被拒绝', () => {
    const doc = loadTemplate('four-grid') as Record<string, unknown>;
    expect(() => parseTemplateDocument({ ...doc, id: 'random-template' })).toThrow(
      /模板 id 不在允许列表/,
    );
  });
});
