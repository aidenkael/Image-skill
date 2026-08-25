import { NextResponse } from 'next/server';
import {
  AssetValidationError,
  ensurePrimaryAsset,
  listAssets,
  saveAsset,
} from '@/server/assets/service';
import {
  getWorkspace,
  WorkspaceValidationError,
} from '@/server/workspaces/service';

type Context = { params: Promise<{ workspaceId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    const form = await request.formData();
    const files = form.getAll('files').filter((file): file is File => file instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: '未收到上传文件（字段名 files）' }, { status: 400 });
    }
    const assets = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      assets.push(
        await saveAsset(workspaceId, { buffer, name: file.name, mimeType: file.type }),
      );
    }
    await ensurePrimaryAsset(workspaceId);
    return NextResponse.json({ assets }, { status: 201 });
  } catch (err) {
    if (err instanceof WorkspaceValidationError || err instanceof AssetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspace assets] upload failed', err);
    return NextResponse.json({ error: '上传失败，请重试' }, { status: 500 });
  }
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    return NextResponse.json({ assets: await listAssets(workspaceId) });
  } catch (err) {
    if (err instanceof WorkspaceValidationError || err instanceof AssetValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspace assets] list failed', err);
    return NextResponse.json({ error: '读取商品图片失败' }, { status: 500 });
  }
}
