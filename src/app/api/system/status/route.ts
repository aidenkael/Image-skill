import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ aiConfigured: Boolean(process.env.DASHSCOPE_API_KEY) });
}
