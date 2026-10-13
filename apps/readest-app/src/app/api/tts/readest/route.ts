import { NextRequest, NextResponse } from 'next/server';
import { getCatalog, offeredVoices, voicesForPlan } from '@/libs/readestVoice/catalog';
import { errorResponse, gateReadestVoice } from '@/libs/readestVoice/gate';
import { getSubscriptionPlan, isTTSInPlan, validateUserAndToken } from '@/utils/access';

// Readest Voice voices, read from the catalog alone. The service is always on
// as a premium feature: listing never asks the voice worker, which only
// synthesis needs, so a worker that is briefly unreachable never hides the
// engine. Without `all`, the caller's plan's voices (released apps); with
// `?all=1`, every offered voice with its plan, for any reader, signed in or
// not, and the app greys out the ones the reader's plan lacks.
export async function GET(request: NextRequest) {
  const all = request.nextUrl.searchParams.get('all') === '1';
  let plan = null;
  if (!all) {
    const { user, token } = await validateUserAndToken(request.headers.get('authorization'));
    if (!user || !token) return errorResponse('NOT_AUTHENTICATED', 403);
    plan = getSubscriptionPlan(token);
    if (!isTTSInPlan(plan)) return errorResponse('PLAN_REQUIRED', 403);
  }
  const catalog = await getCatalog();
  if (!catalog) return errorResponse('CATALOG_UNAVAILABLE', 503);
  return NextResponse.json({
    voices: plan ? voicesForPlan(catalog, plan) : offeredVoices(catalog),
  });
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
