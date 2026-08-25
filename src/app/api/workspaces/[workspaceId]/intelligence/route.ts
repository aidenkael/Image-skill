import { NextResponse } from 'next/server';
import {
  analyzeWorkspace,
  getWorkspaceIntelligence,
  IntelligenceValidationError,
} from '@/server/intelligence/service';
import { ProviderConfigError, ProviderRequestError } from '@/server/providers/provider-errors';
import { getWorkspace, WorkspaceValidationError } from '@/server/workspaces/service';

type Context = { params: Promise<{ workspaceId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    return NextResponse.json({
      intelligence: await getWorkspaceIntelligence(workspaceId),
    });
  } catch (error) {
    if (
      error instanceof WorkspaceValidationError ||
      error instanceof IntelligenceValidationError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[product intelligence] read failed', error);
    return NextResponse.json({ error: '读取商品分析失败' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params;
    if (!(await getWorkspace(workspaceId))) {
      return NextResponse.json({ error: '商品不存在' }, { status: 404 });
    }
    const body = (await request.json()) as { assetIds?: unknown };
    return NextResponse.json({
      intelligence: await analyzeWorkspace(workspaceId, body.assetIds),
    });
  } catch (error) {
    if (error instanceof ProviderConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof ProviderRequestError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    if (
      error instanceof WorkspaceValidationError ||
      error instanceof IntelligenceValidationError ||
      error instanceof SyntaxError
    ) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[product intelligence] analyze failed', error);
    return NextResponse.json({ error: '商品分析失败' }, { status: 500 });
  }
}
