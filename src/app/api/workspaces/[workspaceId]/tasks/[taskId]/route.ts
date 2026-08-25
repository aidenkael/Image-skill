import { NextResponse } from 'next/server';
import { getTask, TaskValidationError } from '@/server/tasks/service';
import {
  getWorkspace,
  WorkspaceValidationError,
} from '@/server/workspaces/service';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string; taskId: string }> },
) {
  try {
    const { workspaceId, taskId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    const task = await getTask(workspaceId, taskId);
    if (!task) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }
    return NextResponse.json({ task });
  } catch (err) {
    if (err instanceof WorkspaceValidationError || err instanceof TaskValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspace tasks] get failed', err);
    return NextResponse.json({ error: '读取任务失败' }, { status: 500 });
  }
}
