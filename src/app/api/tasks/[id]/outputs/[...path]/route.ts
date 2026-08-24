import path from 'node:path';
import { NextResponse } from 'next/server';
import { runtimePath, readBuffer, UUID_RE } from '@/server/storage/fs-store';

/**
 * GET /api/tasks/:id/outputs/[...path] —— 流式返回 hero 生成结果图片。
 * 结果文件位于 .runtime/outputs/<taskId>/，仅供本应用内部路径访问。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path: segments } = await params;
  if (!UUID_RE.test(id) || segments.length === 0) {
    return NextResponse.json({ error: '路径不合法' }, { status: 400 });
  }
  const fileName = segments.join('/');
  if (!/^[A-Za-z0-9._/-]+$/.test(fileName) || fileName.includes('..')) {
    return NextResponse.json({ error: '路径不合法' }, { status: 400 });
  }
  const filePath = runtimePath('outputs', id, fileName);
  const buffer = await readBuffer(filePath);
  if (!buffer) {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }
  const ext = path.extname(fileName).slice(1).toLowerCase();
  const mime =
    ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return new NextResponse(new Uint8Array(buffer), {
    headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' },
  });
}
