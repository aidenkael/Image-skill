import fs from 'node:fs/promises';
import path from 'node:path';
import { CreateTaskRequest, HeroTaskOptions } from '@/core/tasks';
import { isIntelligenceFresh, type ProductIntelligenceRecord } from '@/core/intelligence';
import { TaskResult, taskOutputUrl } from '@/core/results';
import { assetFile, listAssets } from '@/server/assets/service';
import { getWorkspaceIntelligence } from '@/server/intelligence/service';
import { AliyunQwenImageProvider } from '@/server/providers/aliyun-qwen-image';
import { providerFetchError, providerHttpError } from '@/server/providers/provider-errors';
import { ensureDir } from '@/server/storage/fs-store';
import { readImageMeta } from '@/server/image/sharp';

/**
 * 氛围主图（hero）任务执行。
 * 固定商品保真指令 + 用户方向；不引入大 prompt 模板库。
 */

const PRODUCT_FIDELITY_INSTRUCTION =
  'Preserve the referenced product exactly: keep its identity, shape, proportions, ' +
  'color, visible material appearance, pattern, logo/text, structure, count and accessories unchanged.';

const FREE_CREATIVE_INSTRUCTION =
  'Create a high-quality ecommerce atmosphere hero image centered on the referenced product. ' +
  'Freely decide the creative concept, environment, framing, camera perspective, lighting, styling, ' +
  'spatial treatment and whether or how human presence is useful. Make the visual treatment fit this ' +
  'specific product rather than a generic template.';

/** ratio → V1 固定输出尺寸（单一映射函数，UI 不暴露原始 size） */
export function heroSizeForRatio(ratio: string): string {
  switch (ratio) {
    case '3:4':
      return '768*1344';
    case '4:3':
      return '1344*768';
    default:
      return '1024*1024';
  }
}

type HeroConcept = ProductIntelligenceRecord['plan']['heroConcepts'][number];

export function buildHeroPrompt(
  request: CreateTaskRequest,
  concept?: HeroConcept,
): string {
  const opts = request.options as HeroTaskOptions;
  const parts: string[] = [PRODUCT_FIDELITY_INSTRUCTION];
  if (opts.creativeMode === 'free') {
    parts.push(FREE_CREATIVE_INSTRUCTION);
  } else if (opts.creativeMode === 'concept') {
    if (!concept) throw new Error('商品专属创意方向不存在，请重新分析商品');
    parts.push(concept.prompt);
  } else {
    parts.push(
      `Interpret and expand the following user intent creatively into an effective commercial hero image ` +
        `while preserving the product exactly: ${opts.creativeIntent?.trim()}`,
    );
  }
  if (opts.humanPresence === 'none') {
    parts.push('Do not show any person, hand, body part, silhouette or human figure anywhere in the image.');
  } else if (opts.humanPresence === 'involved') {
    parts.push(
      'Include meaningful, natural human presence that participates in the scene. Choose the most appropriate ' +
        'person, hand or body framing and product interaction for this product and concept.',
    );
  }
  return parts.join(' ');
}

async function downloadImage(url: string): Promise<Buffer> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    throw providerFetchError(error);
  }
  if (!res.ok) throw providerHttpError(res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length === 0) throw new Error('下载的生成图片为空');
  return buf;
}

export async function runHeroTask(
  workspaceId: string,
  request: CreateTaskRequest,
  taskId: string,
): Promise<TaskResult> {
  const opts = request.options as HeroTaskOptions;
  const source = await assetFile(workspaceId, opts.sourceAssetId, 'original');
  if (!source) throw new Error('源商品图片不存在或已被删除');

  let concept: HeroConcept | undefined;
  if (opts.creativeMode === 'concept') {
    const intelligence = await getWorkspaceIntelligence(workspaceId);
    if (!intelligence) throw new Error('请先分析商品获取专属创意方向');
    const assets = await listAssets(workspaceId);
    if (!isIntelligenceFresh(intelligence, assets)) {
      throw new Error('商品素材已变化，请重新分析后再使用商品专属方向');
    }
    concept = intelligence.plan.heroConcepts.find((item) => item.id === opts.conceptId);
    if (!concept) throw new Error('所选商品专属创意方向不存在，请重新选择');
  }

  const provider = new AliyunQwenImageProvider();
  const generated = await provider.generate({
    imagePath: source.filePath,
    prompt: buildHeroPrompt(request, concept),
    size: heroSizeForRatio(opts.ratio),
    count: request.count,
  });

  const outDir = await ensureDir('workspaces', workspaceId, 'outputs', taskId);
  const outputs: TaskResult['outputs'] = [];
  let idx = 0;
  for (const g of generated) {
    if (!g.url) continue;
    const buf = await downloadImage(g.url);
    const meta = await readImageMeta(buf).catch(() => null);
    if (!meta) throw new Error('生成的图片下载后无法解析为有效图片');
    const ext = meta.format === 'jpeg' ? 'jpg' : meta.format === 'webp' ? 'webp' : 'png';
    const fileName = `result-${String(idx + 1).padStart(2, '0')}.${ext}`;
    const localPath = path.join(outDir, fileName);
    await fs.writeFile(localPath, buf);
    outputs.push({ kind: 'image', url: taskOutputUrl(workspaceId, taskId, fileName) });
    idx += 1;
  }
  if (outputs.length !== request.count) {
    throw new Error(
      `模型返回结果数量不完整：要求 ${request.count} 张，实际 ${outputs.length} 张`,
    );
  }
  return { outputs };
}
