import { NextResponse } from 'next/server';
import { AIConnectionCapabilitySchema } from '@/core/system';
import { AIConnectionTestError, testProfileConnection } from '@/server/providers/connection-test';
import { AIProfileNotFoundError, AISettingsValidationError } from '@/server/settings/ai';

type ProfileContext = { params: Promise<{ profileId: string }> };

export async function POST(request: Request, context: ProfileContext) {
  try {
    const body = await request.json() as { capability?: unknown };
    const parsed = AIConnectionCapabilitySchema.safeParse(body.capability);
    if (!parsed.success) return NextResponse.json({ error: '请选择有效的测试能力' }, { status: 400 });
    const { profileId } = await context.params;
    const message = await testProfileConnection(profileId, parsed.data);
    return NextResponse.json({ ok: true, message });
  } catch (error) {
    if (error instanceof AISettingsValidationError || error instanceof AIProfileNotFoundError || error instanceof SyntaxError) {
      return NextResponse.json({ error: error.message }, { status: error instanceof AIProfileNotFoundError ? 404 : 400 });
    }
    if (error instanceof AIConnectionTestError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    return NextResponse.json({ error: '连接失败' }, { status: 500 });
  }
}
