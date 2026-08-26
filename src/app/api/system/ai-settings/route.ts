import { NextResponse } from 'next/server';
import {
  AIProfileNotFoundError,
  AISettingsValidationError,
  createAIProfile,
  getAISettingsPublic,
  setActiveAIProfiles,
} from '@/server/settings/ai';

function settingsError(error: unknown, fallback: string) {
  if (error instanceof AISettingsValidationError || error instanceof AIProfileNotFoundError || error instanceof SyntaxError) {
    return NextResponse.json({ error: error.message }, { status: error instanceof AIProfileNotFoundError ? 404 : 400 });
  }
  console.error('[ai settings] request failed', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

export async function GET() {
  try { return NextResponse.json(await getAISettingsPublic()); }
  catch (error) { return settingsError(error, '读取 AI 设置失败'); }
}

export async function POST(request: Request) {
  try { return NextResponse.json(await createAIProfile(await request.json()), { status: 201 }); }
  catch (error) { return settingsError(error, '创建 AI 配置失败'); }
}

export async function PATCH(request: Request) {
  try { return NextResponse.json(await setActiveAIProfiles(await request.json())); }
  catch (error) { return settingsError(error, '保存当前 AI 配置失败'); }
}
