import { describe, expect, it } from 'vitest';
import { TaskResultSchema } from './results';

describe('任务结果客户端契约', () => {
  it('图片结果只保留客户端 URL，不包含 localPath', () => {
    const result = TaskResultSchema.parse({
      outputs: [
        {
          kind: 'image',
          url: '/api/tasks/task-1/outputs/result.png',
          localPath: 'C:\\private\\runtime\\result.png',
        },
      ],
    });

    expect(result.outputs[0]).toEqual({
      kind: 'image',
      url: '/api/tasks/task-1/outputs/result.png',
    });
    expect(result.outputs[0]).not.toHaveProperty('localPath');
  });
});
