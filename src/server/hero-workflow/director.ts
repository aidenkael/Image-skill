import type { HeroBrief } from '@/core/hero-workflow';
import { createActiveVisionProvider } from '@/server/providers/factory';
import type { HeroWorkflowInput } from './contracts';

/**
 * Hero Director：生成前调用一次活动 Vision Provider，产出 HeroBrief。
 * 只消费源商品图本身，不读取/创建 Product Intelligence。
 * HTTP 级诊断日志由 Provider adapter 按请求写入。
 */
export async function createHeroBrief(
  input: HeroWorkflowInput,
): Promise<HeroBrief> {
  const provider = await createActiveVisionProvider();
  return provider.directHero({
    workspaceId: input.workspaceId,
    taskId: input.taskId,
    workspaceName: input.workspaceName,
    asset: {
      assetId: input.sourceAssetId,
      role: input.sourceAssetRole,
      mimeType: 'image/jpeg',
      buffer: input.sourcePreview,
    },
    humanPolicy: input.humanPolicy,
    creativeIntent: input.creativeIntent,
  });
}
