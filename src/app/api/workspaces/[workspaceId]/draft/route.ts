import { NextResponse } from 'next/server';
import {
  getWorkspace,
  readWorkspaceDraft,
  WorkspaceValidationError,
  writeWorkspaceDraft,
} from '@/server/workspaces/service';

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    return NextResponse.json({ draft: await readWorkspaceDraft(workspaceId) });
  } catch (err) {
    if (err instanceof WorkspaceValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspaces] read draft failed', err);
    return NextResponse.json({ error: '读取商品草稿失败' }, { status: 500 });
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    const draft = await writeWorkspaceDraft(workspaceId, await request.json());
    return NextResponse.json({ draft });
  } catch (err) {
    if (err instanceof WorkspaceValidationError || err instanceof SyntaxError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspaces] write draft failed', err);
    return NextResponse.json({ error: '保存商品草稿失败' }, { status: 500 });
  }
}
