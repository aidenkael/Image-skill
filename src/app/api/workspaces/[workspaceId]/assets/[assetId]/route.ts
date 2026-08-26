import { NextResponse } from 'next/server';
import {
  assetFile,
  AssetValidationError,
  deleteAsset,
  isKnownRole,
  setAssetRole,
} from '@/server/assets/service';
import {
  getWorkspace,
  WorkspaceValidationError,
} from '@/server/workspaces/service';
import { getPaidActivity } from '@/server/activity/service';

type Context = { params: Promise<{ workspaceId: string; assetId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const { workspaceId, assetId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    const variant =
      new URL(request.url).searchParams.get('variant') === 'thumb' ? 'thumb' : 'original';
    const file = await assetFile(workspaceId, assetId, variant);
    if (!file) {
      return NextResponse.json({ error: '资源不存在' }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(file.buffer), {
      headers: {
        'Content-Type': file.mimeType,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (err) {
    if (err instanceof WorkspaceValidationError || err instanceof AssetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspace assets] get failed', err);
    return NextResponse.json({ error: '读取图片失败' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const { workspaceId, assetId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    const body = (await request.json()) as { role?: unknown };
    if (body.role === undefined || !isKnownRole(body.role)) {
      return NextResponse.json({ error: '缺少合法的 role 字段' }, { status: 400 });
    }
    if ((await getPaidActivity(workspaceId)).lockedAssetIds.has(assetId)) {
      return NextResponse.json({ error: 'AI 正在使用此图片' }, { status: 409 });
    }
    const assets = await setAssetRole(workspaceId, assetId, body.role);
    if (!assets) {
      return NextResponse.json({ error: '资源不存在' }, { status: 404 });
    }
    return NextResponse.json({ assets });
  } catch (err) {
    if (
      err instanceof WorkspaceValidationError ||
      err instanceof AssetValidationError ||
      err instanceof SyntaxError
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspace assets] patch failed', err);
    return NextResponse.json({ error: '更新失败' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Context) {
  try {
    const { workspaceId, assetId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    if ((await getPaidActivity(workspaceId)).lockedAssetIds.has(assetId)) {
      return NextResponse.json({ error: 'AI 正在使用此图片' }, { status: 409 });
    }
    const assets = await deleteAsset(workspaceId, assetId);
    if (!assets) {
      return NextResponse.json({ error: '资源不存在' }, { status: 404 });
    }
    return NextResponse.json({ assets });
  } catch (err) {
    if (err instanceof WorkspaceValidationError || err instanceof AssetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspace assets] delete failed', err);
    return NextResponse.json({ error: '移除图片失败' }, { status: 500 });
  }
}
