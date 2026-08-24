import { NextResponse } from 'next/server';
import { createTask, listTasks, TaskValidationError } from '@/server/tasks/service';

/**
 * POST /api/tasks —— 创建并执行任务（hero / collage；detail / optimize 明确拒绝）
 * GET  /api/tasks —— 任务列表
 */
export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const task = await createTask(raw);
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    if (err instanceof TaskValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[tasks] create failed', err);
    return NextResponse.json({ error: '任务创建失败' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ tasks: await listTasks() });
}
