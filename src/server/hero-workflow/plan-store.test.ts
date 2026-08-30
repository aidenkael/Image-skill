import { describe, expect, it } from 'vitest';
import type { AssetRef } from '@/core/assets';
import type { HeroPlanRecord } from '@/core/hero-workflow';
import { isHeroPlanRecordFresh } from './plan-store';

const SOURCE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const WORKSPACE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function baseRecord(overrides: Partial<HeroPlanRecord> = {}): HeroPlanRecord {
  return {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    workspaceId: WORKSPACE_ID,
    sourceAssetId: SOURCE_ID,
    sourceAssetRole: 'front',
    ratio: '1:1',
    creativeMode: 'recommended',
    humanPolicy: 'auto',
    creativeLevel: 'balanced',
    createdAt: '2026-08-30T00:00:00.000Z',
    plan: {
      title: '晨光桌面',
      displayMode: 'scene-staging',
      humanPolicy: 'auto',
      coreSellingAngle: '日常陪伴感',
      preserve: ['白色杯身', '单件', '陶瓷质感'],
      flexible: ['光线氛围'],
      scene: '清晨木桌',
      composition: '居中微俯',
      lighting: '柔和自然光',
      riskChecks: ['杯柄结构', '数量变化'],
      prompt: 'A warm morning tabletop hero.',
    },
    ...overrides,
  };
}

function baseInput(overrides: Partial<Parameters<typeof isHeroPlanRecordFresh>[1]> = {}) {
  return {
    sourceAssetId: SOURCE_ID,
    sourceAssetRole: 'front' as const,
    ratio: '1:1' as const,
    creativeMode: 'recommended' as const,
    creativeIntent: undefined,
    humanPolicy: 'auto' as const,
    creativeLevel: 'balanced' as const,
    ...overrides,
  };
}

function baseAssets(overrides: Partial<AssetRef>[] = []): AssetRef[] {
  const defaults: AssetRef = {
    id: SOURCE_ID,
    name: 'source.png',
    mimeType: 'image/png',
    width: 100,
    height: 100,
    role: 'front',
    createdAt: '2026-08-30T00:00:00.000Z',
  };
  if (overrides.length === 0) return [defaults];
  return overrides.map((o) => ({ ...defaults, ...o }));
}

describe('isHeroPlanRecordFresh', () => {
  it('完全相同输入 + source 存在且 role 一致 => true', () => {
    expect(isHeroPlanRecordFresh(baseRecord(), baseInput(), baseAssets())).toBe(true);
  });

  it('source role 改变 => false', () => {
    const record = baseRecord({ sourceAssetRole: 'front' });
    const input = baseInput({ sourceAssetRole: 'detail' });
    const assets = baseAssets([{ role: 'detail' }]);
    expect(isHeroPlanRecordFresh(record, input, assets)).toBe(false);
  });

  it('source 删除（assets 中找不到） => false', () => {
    expect(isHeroPlanRecordFresh(baseRecord(), baseInput(), [])).toBe(false);
  });

  it('ratio 改变 => false', () => {
    expect(isHeroPlanRecordFresh(baseRecord(), baseInput({ ratio: '3:4' }), baseAssets())).toBe(false);
  });

  it('humanPolicy 改变 => false', () => {
    expect(isHeroPlanRecordFresh(baseRecord(), baseInput({ humanPolicy: 'require' }), baseAssets())).toBe(false);
  });

  it('creativeLevel 改变 => false', () => {
    expect(isHeroPlanRecordFresh(baseRecord(), baseInput({ creativeLevel: 'creative' }), baseAssets())).toBe(false);
  });

  it('custom creativeIntent 改变 => false', () => {
    const record = baseRecord({ creativeMode: 'custom', creativeIntent: '雨夜归家' });
    const input = baseInput({ creativeMode: 'custom', creativeIntent: '阳光午后' });
    expect(isHeroPlanRecordFresh(record, input, baseAssets())).toBe(false);
  });

  it('custom creativeIntent 相同 => true', () => {
    const record = baseRecord({ creativeMode: 'custom', creativeIntent: '雨夜归家' });
    const input = baseInput({ creativeMode: 'custom', creativeIntent: '雨夜归家' });
    expect(isHeroPlanRecordFresh(record, input, baseAssets())).toBe(true);
  });

  it('recommended 模式忽略 creativeIntent 差异', () => {
    const record = baseRecord({ creativeMode: 'recommended' });
    const input = baseInput({ creativeMode: 'recommended', creativeIntent: '任意值' });
    expect(isHeroPlanRecordFresh(record, input, baseAssets())).toBe(true);
  });

  it('assets 中 source role 与 record 不一致（即使 input 匹配） => false', () => {
    const record = baseRecord({ sourceAssetRole: 'front' });
    const input = baseInput({ sourceAssetRole: 'front' });
    const assets = baseAssets([{ role: 'detail' }]);
    expect(isHeroPlanRecordFresh(record, input, assets)).toBe(false);
  });
});
