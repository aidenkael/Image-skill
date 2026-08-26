import { NextResponse } from 'next/server';
import { getAISettingsStatus } from '@/server/settings/ai';

export async function GET() {
  return NextResponse.json(await getAISettingsStatus());
}
