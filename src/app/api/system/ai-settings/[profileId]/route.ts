import { NextResponse } from 'next/server';
import {
  AIProfileNotFoundError,
  AISettingsValidationError,
  deleteAIProfile,
  updateAIProfile,
} from '@/server/settings/ai';

function settingsError(error: unknown, fallback: string) {
  if (error instanceof AISettingsValidationError || error instanceof AIProfileNotFoundError || error instanceof SyntaxError) {
    return NextResponse.json({ error: error.message }, { status: error instanceof AIProfileNotFoundError ? 404 : 400 });
  }
  console.error('[ai profile] request failed', error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

type ProfileContext = { params: Promise<{ profileId: string }> };

export async function PUT(request: Request, context: ProfileContext) {
  try {
    const { profileId } = await context.params;
    return NextResponse.json(await updateAIProfile(profileId, await request.json()));
  } catch (error) { return settingsError(error, '更新 AI 配置失败'); }
}

export async function DELETE(_request: Request, context: ProfileContext) {
  try {
    const { profileId } = await context.params;
    return NextResponse.json(await deleteAIProfile(profileId));
  } catch (error) { return settingsError(error, '删除 AI 配置失败'); }
}
