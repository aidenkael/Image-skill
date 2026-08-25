import fs from 'node:fs/promises';
import path from 'node:path';
import { CreateTaskRequest, HeroTaskOptions } from '@/core/tasks';
import { isIntelligenceFresh, type ProductIntelligenceRecord } from '@/core/intelligence';
import { TaskResult, taskOutputUrl } from '@/core/results';
import { assetFile, listAssets } from '@/server/assets/service';
import { getWorkspaceIntelligence } from '@/server/intelligence/service';
import { AliyunQwenImageProvider } from '@/server/providers/aliyun-qwen-image';
import { ensureDir } from '@/server/storage/fs-store';
import { readImageMeta } from '@/server/image/sharp';

/**
 * 氛围主图（hero）任务执行。
 * 固定商品保真指令 + 用户方向；不引入大 prompt 模板库。
 */

const PRODUCT_FIDELITY_INSTRUCTION =
  'Keep the referenced product unchanged in shape, color, material, pattern, ' +
  'logo/text, structure, count and accessories. Change only scene, lighting, ' +
  'composition and human interaction when requested.';

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

const PERSON_INSTRUCTIONS: Record<string, string> = {
  none: 'Do not include any person in the scene.',
  hand: 'A real human hand naturally holds or interacts with the product.',
  person: 'A complete real person naturally uses or wears the product, fully visible.',
};

type HeroDirection = ProductIntelligenceRecord['plan']['heroDirections'][number];

export function buildHeroPrompt(
  request: CreateTaskRequest,
  direction?: HeroDirection,
): string {
  const opts = request.options as HeroTaskOptions;
  const parts: string[] = [PRODUCT_FIDELITY_INSTRUCTION];
  if (opts.sceneMode === 'prompt' && opts.scenePrompt?.trim()) {
    parts.push(`Scene: ${opts.scenePrompt.trim()}`);
  } else {
    if (!direction) throw new Error('AI 推荐方向不存在，请重新分析商品');
    parts.push(
      `Direction: ${direction.prompt}`,
      `Composition: ${direction.composition}`,
      `Lighting: ${direction.lighting}`,
    );
  }
  const resolvedPerson = opts.person === 'auto' ? direction?.person : opts.person;
  if (resolvedPerson) {
    const person = PERSON_INSTRUCTIONS[resolvedPerson];
    if (person) parts.push(person);
  }
  return parts.join(' ');
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`下载生成图片失败 HTTP ${res.status}`);
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

  let direction: HeroDirection | undefined;
  if (opts.sceneMode === 'auto') {
    const intelligence = await getWorkspaceIntelligence(workspaceId);
    if (!intelligence) throw new Error('请先分析商品获取 AI 推荐方向');
    const assets = await listAssets(workspaceId);
    if (!isIntelligenceFresh(intelligence, assets)) {
      throw new Error('商品素材已变化，请重新分析后再使用 AI 推荐方向');
    }
    direction = opts.directionId
      ? intelligence.plan.heroDirections.find((item) => item.id === opts.directionId)
      : intelligence.plan.heroDirections[0];
    if (!direction) throw new Error('所选 AI 推荐方向不存在，请重新选择');
  } else if (!opts.scenePrompt?.trim()) {
    throw new Error('请填写自定义场景方向');
  }

  const provider = new AliyunQwenImageProvider();
  const generated = await provider.generate({
    imagePath: source.filePath,
    prompt: buildHeroPrompt(request, direction),
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
