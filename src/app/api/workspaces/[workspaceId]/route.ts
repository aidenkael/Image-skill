import { NextResponse } from 'next/server';
import {
  getWorkspace,
  WorkspaceValidationError,
} from '@/server/workspaces/service';

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
