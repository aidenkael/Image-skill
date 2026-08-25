import { NextResponse } from 'next/server';
import {
  createTask,
  listTasks,
  TaskValidationError,
} from '@/server/tasks/service';
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
    const task = await createTask(workspaceId, await request.json());
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    if (
      err instanceof WorkspaceValidationError ||
      err instanceof TaskValidationError ||
      err instanceof SyntaxError
    ) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspace tasks] create failed', err);
    return NextResponse.json({ error: '任务创建失败' }, { status: 500 });
  }
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    return NextResponse.json({ tasks: await listTasks(workspaceId) });
  } catch (err) {
    if (err instanceof WorkspaceValidationError || err instanceof TaskValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspace tasks] list failed', err);
    return NextResponse.json({ error: '读取任务失败' }, { status: 500 });
  }
}
