import { describe, expect, it } from 'vitest';
import { TaskResultSchema, assetUrl, taskOutputUrl } from './results';

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const taskId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const assetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

describe('任务结果客户端契约', () => {
  it('图片结果只保留客户端 URL，不包含 localPath', () => {
    const result = TaskResultSchema.parse({
      outputs: [
        {
          kind: 'image',
          url: `/api/workspaces/${workspaceId}/tasks/${taskId}/outputs/result.png`,
          localPath: 'C:\\private\\runtime\\result.png',
        },
      ],
    });

    expect(result.outputs[0]).toEqual({
      kind: 'image',
      url: `/api/workspaces/${workspaceId}/tasks/${taskId}/outputs/result.png`,
    });
    expect(result.outputs[0]).not.toHaveProperty('localPath');
  });

  it('客户端 URL 始终为同源相对路径，不含 .runtime / 绝对路径', () => {
    const url = taskOutputUrl(workspaceId, taskId, 'result-01.png');
    expect(url).toBe(
      `/api/workspaces/${workspaceId}/tasks/${taskId}/outputs/result-01.png`,
    );
    expect(url.startsWith('/')).toBe(true);
    expect(url).not.toContain('.runtime');
    expect(assetUrl(workspaceId, assetId, 'thumb')).toBe(
      `/api/workspaces/${workspaceId}/assets/${assetId}?variant=thumb`,
    );
    // id 中的特殊字符被转义，无法构造路径穿越
    expect(taskOutputUrl('../x', taskId, 'a.png')).toContain('%2F');
  });
});
