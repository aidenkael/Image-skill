import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('组合卖点图输出数量', () => {
  it.each([1, 2, 3])('count=%i 返回同等数量的可用变体', async (count) => {
    const result = await runCollageTask(request(count));
    expect(result.outputs).toHaveLength(count);
    expect(result.outputs.every((output) => output.kind === 'collage')).toBe(true);
  });

  it('请求的 count 返回互不相同的模板 id', async () => {
    const result = await runCollageTask(request(3));
    const ids = result.outputs.map((o) => (o.kind === 'collage' ? o.templateId : ''));
    expect(new Set(ids).size).toBe(3);
  });

  it('以所选起始模板开始轮转', async () => {
    const req = request(2);
    (req.options as { templateId: string }).templateId = 'top-hero-bottom-three';
    const result = await runCollageTask(req);
    expect(
      result.outputs.map((o) => (o.kind === 'collage' ? o.templateId : '')),
    ).toEqual(['top-hero-bottom-three', 'four-grid']);
  });

  it('collage 链路不调用任何网络/Provider（完全确定性）', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await runCollageTask(request(3));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
