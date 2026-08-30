import { describe, expect, it } from 'vitest';
import { normalizeImageCompatibilityForDriver } from './AISettingsDialog';
import type { ImageCompatibility } from '@/core/system';

const fullCompat: ImageCompatibility = {
  referenceImage: true,
  batchMode: 'native',
  sizeMode: 'mapped',
  sizeByRatio: { '1:1': '1024*1024', '3:4': '768*1344', '4:3': '1344*768' },
  promptEnhancement: 'on',
};

describe('normalizeImageCompatibilityForDriver', () => {
  it('dashscope + native/on → 保持 native/on', () => {
    const result = normalizeImageCompatibilityForDriver('dashscope-image', fullCompat);
    expect(result.batchMode).toBe('native');
    expect(result.promptEnhancement).toBe('on');
  });

  it('切 Ark: native → single', () => {
    const result = normalizeImageCompatibilityForDriver('volcengine-ark-image', fullCompat);
    expect(result.batchMode).toBe('single');
  });

  it('切 Ark: on → off', () => {
    const result = normalizeImageCompatibilityForDriver('volcengine-ark-image', fullCompat);
    expect(result.promptEnhancement).toBe('off');
  });

  it('Ark: auto → auto', () => {
    const compat: ImageCompatibility = { ...fullCompat, batchMode: 'auto', promptEnhancement: 'auto' };
    const result = normalizeImageCompatibilityForDriver('volcengine-ark-image', compat);
    expect(result.batchMode).toBe('auto');
    expect(result.promptEnhancement).toBe('auto');
  });

  it('Ark: single → single', () => {
    const compat: ImageCompatibility = { ...fullCompat, batchMode: 'single', promptEnhancement: 'off' };
    const result = normalizeImageCompatibilityForDriver('volcengine-ark-image', compat);
    expect(result.batchMode).toBe('single');
    expect(result.promptEnhancement).toBe('off');
  });

  it('Ark: off → off', () => {
    const compat: ImageCompatibility = { ...fullCompat, batchMode: 'single', promptEnhancement: 'off' };
    const result = normalizeImageCompatibilityForDriver('volcengine-ark-image', compat);
    expect(result.promptEnhancement).toBe('off');
  });

  it('切回 dashscope: 不自动恢复历史 native/on，保留当前值', () => {
    // After switching to Ark, values were coerced to single/off.
    // Switching back should keep single/off, not restore native/on.
    const afterArk: ImageCompatibility = { ...fullCompat, batchMode: 'single', promptEnhancement: 'off' };
    const result = normalizeImageCompatibilityForDriver('dashscope-image', afterArk);
    expect(result.batchMode).toBe('single');
    expect(result.promptEnhancement).toBe('off');
  });

  it('归一化不修改无关字段', () => {
    const result = normalizeImageCompatibilityForDriver('volcengine-ark-image', fullCompat);
    expect(result.referenceImage).toBe(true);
    expect(result.sizeMode).toBe('mapped');
    expect(result.sizeByRatio).toEqual({ '1:1': '1024*1024', '3:4': '768*1344', '4:3': '1344*768' });
  });
});
