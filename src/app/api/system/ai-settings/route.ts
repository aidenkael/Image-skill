import { NextResponse } from 'next/server';
import { ProviderConfigError, ProviderRequestError } from '@/server/providers/provider-errors';
import { testVisionConnection } from '@/server/providers/aliyun-qwen-vision';
import {
  clearRuntimeAIKey,
  getAISettingsStatus,
  saveRuntimeAIKey,
  AISettingsValidationError,
} from '@/server/settings/ai';

export async function GET() {
  return NextResponse.json(await getAISettingsStatus());
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as { apiKey?: unknown };
    return NextResponse.json(await saveRuntimeAIKey(body.apiKey));
  } catch (error) {
    if (error instanceof AISettingsValidationError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error('[ai settings] save failed', error);
    return NextResponse.json({ error: '保存 AI 设置失败' }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    return NextResponse.json(await clearRuntimeAIKey());
  } catch (error) {
    console.error('[ai settings] clear failed', error);
    return NextResponse.json({ error: '清除工作台 Key 失败' }, { status: 500 });
  }
}

export async function POST() {
  try {
    await testVisionConnection();
    return NextResponse.json({ ok: true, message: '商品分析连接测试成功' });
  } catch (error) {
    if (error instanceof ProviderConfigError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ProviderRequestError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error('[ai settings] connection test failed', error);
    return NextResponse.json({ error: '商品分析连接测试失败' }, { status: 500 });
  }
}
