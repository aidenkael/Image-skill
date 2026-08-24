import { z } from 'zod';

/**
 * 任务结果领域契约。
 */

export const TaskOutputImageSchema = z.object({
  kind: z.literal('image'),
  url: z.string().optional(),
  localPath: z.string().optional(),
});

export const TaskOutputCollageSchema = z.object({
  kind: z.literal('collage'),
  templateId: z.string(),
});

export const TaskOutputSchema = z.discriminatedUnion('kind', [
  TaskOutputImageSchema,
  TaskOutputCollageSchema,
]);
export type TaskOutput = z.infer<typeof TaskOutputSchema>;

export const TaskResultSchema = z.object({
  outputs: z.array(TaskOutputSchema),
});
export type TaskResult = z.infer<typeof TaskResultSchema>;

/** 生成结果对客户端安全的 URL（服务端流式提供） */
export function taskOutputUrl(taskId: string, fileName: string): string {
  return `/api/tasks/${encodeURIComponent(taskId)}/outputs/${encodeURIComponent(fileName)}`;
}

/** 资源对客户端安全的 URL */
export function assetUrl(assetId: string, variant: 'original' | 'thumb' = 'original'): string {
  return `/api/assets/${encodeURIComponent(assetId)}?variant=${variant}`;
}
