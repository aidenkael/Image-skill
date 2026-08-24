import { CreateTaskRequest, CollageTaskOptions } from '@/core/tasks';
import { TaskResult } from '@/core/results';
import { COLLAGE_TEMPLATE_IDS } from '@/core/templates';

/**
 * 组合卖点图（collage）任务执行。
 * 完全确定性：不调用任何图片生成 Provider；输出为布局模板变体集合，
 * 由客户端在 Fabric 画布上渲染/编辑/导出 PNG。
 */

export async function runCollageTask(request: CreateTaskRequest): Promise<TaskResult> {
  const opts = request.options as CollageTaskOptions;
  const startIdx = Math.max(
    0,
    COLLAGE_TEMPLATE_IDS.indexOf(opts.templateId as (typeof COLLAGE_TEMPLATE_IDS)[number]),
  );
  const variants: string[] = [];
  for (let i = 0; i < request.count; i++) {
    variants.push(COLLAGE_TEMPLATE_IDS[(startIdx + i) % COLLAGE_TEMPLATE_IDS.length]);
  }
  return { outputs: variants.map((templateId) => ({ kind: 'collage' as const, templateId })) };
}
