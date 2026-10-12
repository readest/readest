import { NextRequest, NextResponse } from 'next/server';
import { voicesForPlan } from '@/libs/readestVoice/catalog';
import { errorResponse, gateReadestVoice } from '@/libs/readestVoice/gate';

// Readest Voice voices for the caller's plan. Doubles as the capability
// probe: 403/503 hide the engine in the app (kill switch, lapsed plan).
export async function GET(request: NextRequest) {
  const gate = await gateReadestVoice(request);
  if (!gate.ok) return gate.response;
  const { plan, catalog } = gate.ctx;
  return NextResponse.json({ voices: voicesForPlan(catalog, plan) });
}

// Voice-picker-open warmup: boots a worker so the first window is warm.
export async function POST(request: NextRequest) {
  const gate = await gateReadestVoice(request);
  if (!gate.ok) return gate.response;
  const body = (await request.json().catch(() => null)) as { warmup?: unknown } | null;
  if (body?.warmup !== true) return errorResponse('INVALID_INPUT', 400);
  // Best effort: the voice picker does not wait on it.
  try {
    await gate.ctx.service.warmup();
  } catch (error) {
    console.warn('Readest Voice warmup failed:', error);
  }
  return NextResponse.json({ ok: true });
}
