import { describe, expect, it } from 'vitest';
import type { CreateTaskRequest } from '@/core/tasks';
import { runCollageTask } from './collage';

function request(count: number): CreateTaskRequest {
  return {
    kind: 'collage',
    assetIds: ['asset-1'],
    count,
    options: {
      templateId: 'left-hero-right-three',
      includeTitle: false,
      includeSellingPoints: false,
    },
  };
}

describe('组合卖点图输出数量', () => {
  it.each([1, 2, 3])('count=%i 返回同等数量的可用变体', async (count) => {
    const result = await runCollageTask(request(count));
    expect(result.outputs).toHaveLength(count);
    expect(result.outputs.every((output) => output.kind === 'collage')).toBe(true);
  });
});
