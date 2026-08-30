import { NextResponse } from 'next/server';
import { readImageMeta } from '@/server/image/sharp';
import { runBenchmark } from '@/server/benchmark-lab/run';
import { BenchmarkRunRequestSchema } from '@/core/benchmark-lab';
import { ProviderCapabilityError, ProviderConfigError, ProviderRequestError } from '@/server/providers/provider-errors';

/**
 * Benchmark Lab 完整运行：上传源图 + 运行参数 → 编排器执行 → 返回聚合结果。
 * 独立 R&D 路由，不经过正式 Workspace/任务持久化。
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

    const optionsRaw = form.get('options');
    let optionsParsed: unknown;
    try {
      optionsParsed = JSON.parse(typeof optionsRaw === 'string' ? optionsRaw : '{}');
    } catch {
      return NextResponse.json({ error: '运行参数不是合法 JSON' }, { status: 400 });
    }
    const parsed = BenchmarkRunRequestSchema.safeParse(optionsParsed);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? '运行参数不合法' },
        { status: 400 },
      );
    }

    const summary = await runBenchmark({
      ...parsed.data,
      sourceBuffer: buffer,
      sourceFileName: file.name || 'source.png',
    });
    return NextResponse.json({ summary });
  } catch (err) {
    if (
      err instanceof ProviderConfigError
      || err instanceof ProviderCapabilityError
      || err instanceof ProviderRequestError
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[benchmark run] failed', err);
    return NextResponse.json({ error: 'Benchmark 运行失败，请查看服务端日志' }, { status: 500 });
  }
}

// 独立 R&D 路由：每次请求实时执行，不缓存。
export const dynamic = 'force-dynamic';
