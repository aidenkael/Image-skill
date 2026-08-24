import { describe, expect, it } from 'vitest';
import type { ImageSlotLayer } from '@/core/templates';
import { imageFitGeometry } from './render';

describe('Fabric 槽位 cover 几何', () => {
  it('宽图在竖槽位内从中心裁切', () => {
    const slot: ImageSlotLayer = {
      type: 'image',
      id: 'slot-1',
      x: 100,
      y: 200,
      width: 300,
      height: 600,
      fit: 'cover',
      slotIndex: 0,
    };

    expect(imageFitGeometry(1200, 600, slot)).toEqual({
      left: -350,
      top: 200,
      scaleX: 1,
      scaleY: 1,
    });
  });
});
