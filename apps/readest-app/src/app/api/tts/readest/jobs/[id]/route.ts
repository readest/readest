import { NextRequest, NextResponse } from 'next/server';
import { USAGE_TYPES, UsageStatsManager } from '@/utils/usage';
import { errorResponse, gateReadestVoice } from '@/libs/readestVoice/gate';
import { runAfterResponse } from '@/libs/readestVoice/service';

// One download job of the app's (see ../route.ts). GET long-polls until the
// job ends: 202 {state} while it runs, then its NDJSON result once (the same
// lines the stream route sends, ending in {done, charged}), charged now;
// after that the job and its result are gone. DELETE cancels it.

interface RouteParams {
  params: Promise<{ id: string }>;
}

const JOB_ID = /^[0-9a-f]{32}$/;
// Under the time proxies wait for a reply.
const WAIT_MS = 25_000;

const ENDED_ERRORS: Record<string, [string, number]> = {
  failed: ['UPSTREAM_FAILED', 502],
  cancelled: ['CANCELLED', 409],
};

export async function GET(request: NextRequest, { params }: RouteParams) {
  const gate = await gateReadestVoice(request);
  if (!gate.ok) return gate.response;
  const { user, plan, service } = gate.ctx;
  const { id } = await params;
  if (!JOB_ID.test(id)) return errorResponse('INVALID_INPUT', 400);

  const state = await service.waitJob(id, user.id, WAIT_MS);
  if (state === 'queued' || state === 'leased') {
    return NextResponse.json({ state }, { status: 202 });
  }
  if (state && ENDED_ERRORS[state]) return errorResponse(...ENDED_ERRORS[state]);
  const result = state === 'done' ? await service.takeResult(id, user.id) : null;
  if (!result) return errorResponse('NOT_FOUND', 404);
  if (result.charged > 0) {
    // One line per sentence, then {done}.
    const segments = result.body.trimEnd().split('\n').length - 1;
    runAfterResponse(
      UsageStatsManager.trackUsage(user.id, USAGE_TYPES.TTS_CHARS, result.charged, {
        plan,
        lane: 'download',
        segments,
      }).catch((error) => console.error(`Readest Voice usage charge failed (job: ${id}):`, error)),
    );
  }
  return new Response(result.body, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const gate = await gateReadestVoice(request);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!JOB_ID.test(id)) return errorResponse('INVALID_INPUT', 400);
  await gate.ctx.service.cancelJob(id, gate.ctx.user.id);
  return new NextResponse(null, { status: 204 });
}
