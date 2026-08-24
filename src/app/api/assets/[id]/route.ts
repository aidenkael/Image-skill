import { NextResponse } from 'next/server';
import { assetFile, setAssetRole, AssetValidationError } from '@/server/assets/service';
import { isKnownRole } from '@/server/assets/service';

/**
 * GET   /api/assets/:id —— 返回存储图片（?variant=thumb 取缩略图）
 * PATCH /api/assets/:id —— 修正资源角色（用户可纠正）
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const variant = new URL(request.url).searchParams.get('variant') === 'thumb' ? 'thumb' : 'original';
  const file = await assetFile(id, variant);
  if (!file) {
    return NextResponse.json({ error: '资源不存在' }, { status: 404 });
  }
  return new NextResponse(new Uint8Array(file.buffer), {
    headers: {
      'Content-Type': file.mimeType,
      'Cache-Control': 'public, max-age=3600',
    },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { role?: unknown };
    if (body.role === undefined || !isKnownRole(body.role)) {
      return NextResponse.json({ error: '缺少合法的 role 字段' }, { status: 400 });
    }
    const asset = await setAssetRole(id, body.role);
    if (!asset) {
      return NextResponse.json({ error: '资源不存在' }, { status: 404 });
    }
    return NextResponse.json({ asset });
  } catch (err) {
    if (err instanceof AssetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[assets] patch failed', err);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}
