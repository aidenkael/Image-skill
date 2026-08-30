import { describe, expect, it } from 'vitest';
import type { AssetRef } from '@/core/assets';
import type { ProductIntelligenceRecord } from '@/core/intelligence';
import { intelligenceMatchesSelection, intelligenceSelectionKey } from './match';

function asset(id: string, role: AssetRef['role'] = 'front'): AssetRef {
  return { id, name: `${id}.png`, mimeType: 'image/png', width: 10, height: 10, role, createdAt: '2026-08-30T00:00:00.000Z' };
}

function record(snapshots: Array<{ id: string; role: string }>): ProductIntelligenceRecord {
  return {
    schemaVersion: 4,
    analyzedAt: '2026-08-30T00:00:00.000Z',
    assetSnapshot: snapshots.map((item) => ({ id: item.id, role: item.role as 'front' })),
    analysis: {
      category: '包', visualSummary: '白色包', visibleFacts: [], visibleText: [],
      unverifiedFacts: [], assetObservations: snapshots.map((item) => ({ assetId: item.id, suggestedRole: 'front' as const, quality: 'good' as const, note: '清晰' })),
    },
    plan: { collage: { titleOptions: [], sellingPoints: [] } },
  };
}

describe('intelligenceMatchesSelection（精确选择匹配）', () => {
  it('选择的素材 id+角色集合完全一致 => 可复用', () => {
    const rec = record([{ id: 'a', role: 'front' }, { id: 'b', role: 'detail' }]);
    expect(intelligenceMatchesSelection(rec, [asset('b', 'detail'), asset('a', 'front')])).toBe(true);
  });

  it('不同选择（增/删素材）=> 需要重新分析', () => {
    const rec = record([{ id: 'a', role: 'front' }]);
    expect(intelligenceMatchesSelection(rec, [asset('a'), asset('b', 'detail')])).toBe(false);
    expect(intelligenceMatchesSelection(rec, [])).toBe(false);
    expect(intelligenceMatchesSelection(null, [asset('a')])).toBe(false);
  });

  it('素材角色变化 => 需要重新分析', () => {
    const rec = record([{ id: 'a', role: 'front' }]);
    expect(intelligenceMatchesSelection(rec, [asset('a', 'detail')])).toBe(false);
  });
});

describe('intelligenceSelectionKey（同一选择稳定同键）', () => {
  it('顺序无关且随角色变化', () => {
    expect(intelligenceSelectionKey([asset('a'), asset('b', 'detail')]))
      .toBe(intelligenceSelectionKey([asset('b', 'detail'), asset('a')]));
    expect(intelligenceSelectionKey([asset('a')]))
      .not.toBe(intelligenceSelectionKey([asset('a', 'detail')]));
    expect(intelligenceSelectionKey([])).toBe('');
  });
});
