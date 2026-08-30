import crypto from 'node:crypto';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { BenchmarkRunRequestSchema } from '@/core/benchmark-lab';
import { benchmarkFileUrl } from '@/server/benchmark-lab/run';
import { planReferencePack } from '@/server/benchmark-lab/reference-pack';
import { readImageMeta } from '@/server/image/sharp';
import { createActiveVisionProvider, createVisionProviderForProfile } from '@/server/providers/factory';
import { ProviderCapabilityError, ProviderConfigError, ProviderRequestError } from '@/server/providers/provider-errors';
import { ensureDir } from '@/server/storage/fs-store';
import fs from 'node:fs/promises';

/**
 * Benchmark Lab Reference Pack 预览：上传源图 → 规划并裁剪参考图 → 返回预览。
 * 仅用于运行前查看参考包；完整运行会重新创建自己的 Reference Pack。
 */

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('source');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '未收到源图文件（字段名 source）' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const meta = await readImageMeta(buffer).catch(() => null);
    if (!meta) {
      return NextResponse.json({ error: '上传的文件不是可识别的图片' }, { status: 400 });
    }

    const visionProfileRaw = form.get('visionProfileId');
    const visionProfileId = BenchmarkRunRequestSchema.shape.visionProfileId.safeParse(
      typeof visionProfileRaw === 'string' && visionProfileRaw ? visionProfileRaw : null,
    );
    if (!visionProfileId.success) {
      return NextResponse.json({ error: 'Vision 配置 ID 不合法' }, { status: 400 });
    }

    const runId = crypto.randomUUID();
    const sourceDir = await ensureDir('benchmark-lab', runId, 'source');
    const refsDir = await ensureDir('benchmark-lab', runId, 'refs');
    const extension = (path.extname(file.name).slice(1).toLowerCase() || 'png').replace(/[^a-z0-9]/g, '') || 'png';
    const sourcePath = path.join(sourceDir, `source.${['jpg', 'jpeg', 'png', 'webp'].includes(extension) ? extension : 'png'}`);
    await fs.writeFile(sourcePath, buffer);

    const visionProvider = visionProfileId.data
      ? await createVisionProviderForProfile(visionProfileId.data)
      : await createActiveVisionProvider();

    const pack = await planReferencePack({
      runId,
      sourcePath,
      sourceBuffer: buffer,
      refsDir,
      visionProvider,
      cropUrl: (fileName) => benchmarkFileUrl(runId, 'refs', fileName),
    });

    return NextResponse.json({
      runId,
      referencePack: {
        summary: pack.plan.summary,
        sourceUrl: benchmarkFileUrl(runId, 'source', path.basename(sourcePath)),
        crops: pack.crops.map((item) => ({ ...item.crop, url: item.url })),
      },
    });
  } catch (err) {
    if (
      err instanceof ProviderConfigError
      || err instanceof ProviderCapabilityError
      || err instanceof ProviderRequestError
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[benchmark reference-pack] failed', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Reference Pack 规划失败' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
