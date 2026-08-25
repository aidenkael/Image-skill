import { NextResponse } from 'next/server';
import {
  createWorkspace,
  listWorkspaces,
  WorkspaceValidationError,
} from '@/server/workspaces/service';

export async function GET() {
  return NextResponse.json({ workspaces: await listWorkspaces() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { name?: unknown };
    const workspace = await createWorkspace(typeof body.name === 'string' ? body.name : '');
    return NextResponse.json({ workspace }, { status: 201 });
  } catch (err) {
    if (err instanceof WorkspaceValidationError || err instanceof SyntaxError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspaces] create failed', err);
    return NextResponse.json({ error: '新建商品失败' }, { status: 500 });
  }
}
