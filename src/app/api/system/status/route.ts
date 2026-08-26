import { NextResponse } from 'next/server';
import { getAISettingsPublic } from '@/server/settings/ai';

export async function GET() {
  return NextResponse.json(await getAISettingsPublic());
}
