import path from 'node:path';
import { NextResponse } from 'next/server';
import { readBuffer } from '@/server/storage/fs-store';
import { getTask, TaskValidationError } from '@/server/tasks/service';
import {
  getWorkspace,
  workspaceRuntimePath,
  WorkspaceValidationError,
} from '@/server/workspaces/service';

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ workspaceId: string; taskId: string; path: string[] }>;
  },
) {
  try {
    const { workspaceId, taskId, path: segments } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    if (!(await getTask(workspaceId, taskId))) {
      return NextResponse.json({ error: '任务不存在' }, { status: 404 });
    }
    if (segments.length === 0) {
      return NextResponse.json({ error: '路径不合法' }, { status: 400 });
    }
    const fileName = segments.join('/');
    if (!/^[A-Za-z0-9._/-]+$/.test(fileName) || fileName.includes('..')) {
      return NextResponse.json({ error: '路径不合法' }, { status: 400 });
    }
    const filePath = workspaceRuntimePath(workspaceId, 'outputs', taskId, fileName);
    const buffer = await readBuffer(filePath);
    if (!buffer) {
      return NextResponse.json({ error: '文件不存在' }, { status: 404 });
    }
    const ext = path.extname(fileName).slice(1).toLowerCase();
    const mime =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : 'image/png';
    return new NextResponse(new Uint8Array(buffer), {
      headers: { 'Content-Type': mime, 'Cache-Control': 'public, max-age=3600' },
    });
  } catch (err) {
    if (err instanceof WorkspaceValidationError || err instanceof TaskValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error('[workspace outputs] get failed', err);
    return NextResponse.json({ error: '读取结果失败' }, { status: 500 });
  }
}
