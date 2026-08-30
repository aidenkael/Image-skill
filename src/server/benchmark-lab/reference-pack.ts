import nodePath from 'node:path';
import type { ReferenceCrop, ReferencePackPlan } from '@/core/benchmark-lab';
import { makeVisionPreview } from '@/server/image/sharp';
import type { VisionProvider } from '@/server/providers/vision-provider';
import { cropReferenceRegions } from './cropper';

/**
 * Reference Pack 规划：Vision 识别商品身份风险区域 → 确定性裁剪落盘。
 * 1 张完整源图（隐式）+ 0..3 张细节裁剪。不按品类模板，只看身份风险。
 */

export interface BenchmarkReferencePack {
  plan: ReferencePackPlan;
  sourcePath: string;
  crops: Array<{ crop: ReferenceCrop; path: string; url: string }>;
}

export interface PlanReferencePackOptions {
  runId: string;
  sourcePath: string;
  sourceBuffer: Buffer;
  refsDir: string;
  visionProvider: VisionProvider;
  /** 归一化裁剪文件的对外 URL 生成器 */
  cropUrl: (fileName: string) => string;
}

export async function planReferencePack(options: PlanReferencePackOptions): Promise<BenchmarkReferencePack> {
  // Vision 输入统一用 jpeg 预览，避免大图与格式差异
  const visionBuffer = await makeVisionPreview(options.sourceBuffer);
  const plan = await options.visionProvider.planBenchmarkReferencePack({
    runId: options.runId,
    sourceBuffer: visionBuffer,
  });

  const cropped = await cropReferenceRegions(options.sourcePath, plan.crops, options.refsDir);
  return {
    plan,
    sourcePath: options.sourcePath,
    crops: cropped.map(({ crop, path: filePath }) => ({
      crop,
      path: filePath,
      url: options.cropUrl(nodePath.basename(filePath)),
    })),
  };
}
