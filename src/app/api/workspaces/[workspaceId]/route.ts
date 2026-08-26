import { NextResponse } from 'next/server';
import {
  deleteWorkspace,
  getWorkspace,
  WorkspaceValidationError,
} from '@/server/workspaces/service';
import { getPaidActivity } from '@/server/activity/service';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    return NextResponse.json({ workspace });
  } catch (err) {
    if (err instanceof WorkspaceValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspaces] get failed', err);
    return NextResponse.json({ error: '读取商品失败' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    if ((await getPaidActivity(workspaceId)).running) {
      return NextResponse.json({ error: 'AI 正在使用当前商品，请等待完成后再删除' }, { status: 409 });
    }
    await deleteWorkspace(workspaceId);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof WorkspaceValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspaces] delete failed', err);
    return NextResponse.json({ error: '删除商品失败' }, { status: 500 });
  }
}
