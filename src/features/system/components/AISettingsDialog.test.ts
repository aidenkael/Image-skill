import { describe, expect, it } from 'vitest';
import { normalizeImageCompatibilityForDriver } from './AISettingsDialog';
import type { ImageCompatibility } from '@/core/system';

const fullCompat: ImageCompatibility = {
  referenceImage: true,
  batchMode: 'native',
  sizeMode: 'mapped',
  sizeByRatio: { '1:1': '1024*1024', '3:4': '768*1344', '4:3': '1344*768' },
  promptEnhancement: 'on',
  promptEnhancementSupported: true,
  maxReferenceImages: 2,
};

describe('normalizeImageCompatibilityForDriver', () => {
  it('dashscope + native/on → 保持 native/on', () => {
    const result = normalizeImageCompatibilityForDriver('dashscope-image', fullCompat);
    expect(result.batchMode).toBe('native');
    expect(result.promptEnhancement).toBe('on');
  });

  it('切 Ark: native → single, on → off, 新能力字段归零', () => {
    const result = normalizeImageCompatibilityForDriver('volcengine-ark-image', fullCompat);
    expect(result.batchMode).toBe('single');
    expect(result.promptEnhancement).toBe('off');
    expect(result.promptEnhancementSupported).toBe(false);
    expect(result.maxReferenceImages).toBe(0);
  });

  it('Ark: auto → off（Ark 强制关闭扩写）', () => {
    const compat: ImageCompatibility = { ...fullCompat, batchMode: 'auto', promptEnhancement: 'auto' };
    const result = normalizeImageCompatibilityForDriver('volcengine-ark-image', compat);
    expect(result.batchMode).toBe('auto');
    expect(result.promptEnhancement).toBe('off');
    expect(result.promptEnhancementSupported).toBe(false);
    expect(result.maxReferenceImages).toBe(0);
  });

  it('Ark: single/off → single/off，新能力字段归零', () => {
    const compat: ImageCompatibility = { ...fullCompat, batchMode: 'single', promptEnhancement: 'off' };
    const result = normalizeImageCompatibilityForDriver('volcengine-ark-image', compat);
    expect(result.batchMode).toBe('single');
    expect(result.promptEnhancement).toBe('off');
    expect(result.promptEnhancementSupported).toBe(false);
    expect(result.maxReferenceImages).toBe(0);
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

  it('切回 dashscope: 不根据 model 名恢复 Qwen 能力值', () => {
    const afterArk: ImageCompatibility = {
      ...fullCompat,
      batchMode: 'single',
      promptEnhancement: 'off',
      promptEnhancementSupported: false,
      maxReferenceImages: 0,
    };
    const result = normalizeImageCompatibilityForDriver('dashscope-image', afterArk);
    expect(result.batchMode).toBe('single');
    expect(result.promptEnhancement).toBe('off');
    expect(result.promptEnhancementSupported).toBe(false);
    expect(result.maxReferenceImages).toBe(0);
  });

  it('dashscope: 保留显式 Wan capability（false/8）', () => {
    const wanCompat: ImageCompatibility = {
      ...fullCompat,
      promptEnhancementSupported: false,
      maxReferenceImages: 8,
    };
    const result = normalizeImageCompatibilityForDriver('dashscope-image', wanCompat);
    expect(result.promptEnhancementSupported).toBe(false);
    expect(result.maxReferenceImages).toBe(8);
  });

  it('Ark: 强制多参考图归零（不允许 Ark + maxReferenceImages>0）', () => {
    const compat: ImageCompatibility = {
      ...fullCompat,
      promptEnhancementSupported: true,
      maxReferenceImages: 8,
    };
    const result = normalizeImageCompatibilityForDriver('volcengine-ark-image', compat);
    expect(result.promptEnhancementSupported).toBe(false);
    expect(result.maxReferenceImages).toBe(0);
    expect(result.promptEnhancement).toBe('off');
  });
});
