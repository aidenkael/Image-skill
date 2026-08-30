import { NextResponse } from 'next/server';
import { z } from 'zod';
import { HeroCreativeLevelSchema, HeroHumanPolicySchema, HeroRatioSchema } from '@/core/hero-workflow';
import { assetFile, listAssets } from '@/server/assets/service';
import {
  createHeroPlanRecord,
  getHeroPlanRecord,
  isHeroPlanRecordFresh,
  planHeroWorkflow,
} from '@/server/hero-workflow';
import type { HeroWorkflowContext, HeroWorkflowInput } from '@/server/hero-workflow';
import { getWorkspaceIntelligence } from '@/server/intelligence/service';
import { makeVisionPreview } from '@/server/image/sharp';
import { ProviderConfigError, ProviderRequestError } from '@/server/providers/provider-errors';
import { getWorkspace } from '@/server/workspaces/service';

type Context = { params: Promise<{ workspaceId: string }> };

const HeroPlanRequestSchema = z.object({
  sourceAssetId: z.string().uuid(),
  ratio: HeroRatioSchema,
  creativeMode: z.enum(['recommended', 'custom']),
  creativeIntent: z.string().trim().max(500).optional(),
  humanPresence: HeroHumanPolicySchema,
  creativeLevel: HeroCreativeLevelSchema,
});

export async function POST(request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params;
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) return NextResponse.json({ error: '商品不存在' }, { status: 404 });

    const body = HeroPlanRequestSchema.parse(await request.json());
    const assets = await listAssets(workspaceId);
    const sourceAsset = assets.find((asset) => asset.id === body.sourceAssetId);
    if (!sourceAsset) {
      return NextResponse.json({ error: '源商品图片不存在或已被删除' }, { status: 400 });
    }
    if (sourceAsset.role === 'reference') {
      return NextResponse.json({ error: '参考图不能作为氛围主图商品源图' }, { status: 400 });
    }

    const source = await assetFile(workspaceId, sourceAsset.id, 'original');
    if (!source) return NextResponse.json({ error: '源商品图片不存在或已被删除' }, { status: 400 });

    const intelligence = await getWorkspaceIntelligence(workspaceId);
    const context: HeroWorkflowContext = { intelligence, assets };

    const input: HeroWorkflowInput = {
      workspaceId,
      workspaceName: workspace.name,
      taskId: 'plan-preview',
      sourceImagePath: source.filePath,
      sourcePreview: await makeVisionPreview(source.buffer),
      sourceAssetId: sourceAsset.id,
      sourceAssetRole: sourceAsset.role,
      ratio: body.ratio,
      count: 1,
      humanPolicy: body.humanPresence,
      creativeLevel: body.creativeLevel,
      creativeIntent: body.creativeMode === 'custom' ? body.creativeIntent?.trim() : undefined,
    };

    const plan = await planHeroWorkflow(input, context);
    const record = await createHeroPlanRecord({
      workspaceId,
      sourceAssetId: sourceAsset.id,
      sourceAssetRole: sourceAsset.role,
      ratio: body.ratio,
      creativeMode: body.creativeMode,
      creativeIntent: body.creativeMode === 'custom' ? body.creativeIntent?.trim() : undefined,
      humanPolicy: body.humanPresence,
      creativeLevel: body.creativeLevel,
      plan,
    });

    return NextResponse.json({ record });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const detail = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return NextResponse.json({ error: `方案请求参数不合法：${detail}` }, { status: 400 });
    }
    if (error instanceof ProviderConfigError) {
      return NextResponse.json({ error: error.message }, { status: 503 });
    }
    if (error instanceof ProviderRequestError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error('[hero plan] create failed', error);
    return NextResponse.json({ error: '生成 AI 方案失败' }, { status: 500 });
  }
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { workspaceId } = await params;
    const workspace = await getWorkspace(workspaceId);
    if (!workspace) return NextResponse.json({ error: '商品不存在' }, { status: 404 });

    const record = await getHeroPlanRecord(workspaceId);
    if (!record) return NextResponse.json({ record: null });

    const assets = await listAssets(workspaceId);
    const fresh = isHeroPlanRecordFresh(record, {
      sourceAssetId: record.sourceAssetId,
      sourceAssetRole: record.sourceAssetRole,
      ratio: record.ratio,
      creativeMode: record.creativeMode,
      creativeIntent: record.creativeIntent,
      humanPolicy: record.humanPolicy,
      creativeLevel: record.creativeLevel,
    }, assets);

    return NextResponse.json({ record: fresh ? record : null });
  } catch (error) {
    console.error('[hero plan] read failed', error);
    return NextResponse.json({ error: '读取方案失败' }, { status: 500 });
  }
}
