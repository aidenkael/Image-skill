import { NextResponse } from 'next/server';
import { saveAsset, listAssets, ensurePrimaryAsset, AssetValidationError } from '@/server/assets/service';

/**
 * POST /api/assets —— multipart 图片上传（字段名 files，可多张）
 * GET  /api/assets —— 资源列表（会话内保持可见）
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: '未收到上传文件（字段名 files）' }, { status: 400 });
    }
    const assets = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      assets.push(await saveAsset({ buffer, name: file.name, mimeType: file.type }));
    }
    await ensurePrimaryAsset();
    return NextResponse.json({ assets }, { status: 201 });
  } catch (err) {
    if (err instanceof AssetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[assets] upload failed', err);
    return NextResponse.json({ error: '上传失败，请重试' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ assets: await listAssets() });
}
