import { NextResponse } from 'next/server';
import { benchmarkFilePath } from '@/server/benchmark-lab/run';
import { UUID_RE, readBuffer } from '@/server/storage/fs-store';

/** Benchmark Lab 运行文件（源图/参考裁剪/候选图）只读服务。 */

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: segments } = await params;
    const [runId, ...rest] = segments;
    if (!runId || !UUID_RE.test(runId) || rest.length === 0) {
      return NextResponse.json({ error: '路径不合法' }, { status: 400 });
    }
    const filePath = benchmarkFilePath(runId, rest);
    const buffer = await readBuffer(filePath);
    if (!buffer) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }
    const ext = (segments[segments.length - 1] ?? '').split('.').pop()?.toLowerCase() ?? '';
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    if (err instanceof Error && err.message === '路径不合法') {
      return NextResponse.json({ error: '路径不合法' }, { status: 400 });
    }
    console.error('[benchmark files] get failed', err);
    return NextResponse.json({ error: '读取文件失败' }, { status: 500 });
  }
}
