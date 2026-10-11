import { NextRequest, NextResponse } from 'next/server';
import {
  getDispatcher,
  getResultBucket,
  resultKey,
  runAfterResponse,
} from '@/libs/readestVoice/bindings';
import { errorResponse, gateReadestVoice } from '@/libs/readestVoice/gate';

// One download job of the app's (see ../route.ts). GET long-polls until the
// job ends: 202 {state} while it runs, then its NDJSON result once (the same
// lines the stream route sends, ending in {done}), after which the job and
// its result are gone. DELETE cancels it.

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
  const userId = gate.ctx.user.id;
  const { id } = await params;
  if (!JOB_ID.test(id)) return errorResponse('INVALID_INPUT', 400);
  const dispatcher = getDispatcher();
  const bucket = getResultBucket();
  if (!dispatcher || !bucket) return errorResponse('JOBS_UNAVAILABLE', 503);

  const state = await dispatcher.waitJob(id, userId, WAIT_MS);
  if (state === 'queued' || state === 'leased') {
    return NextResponse.json({ state }, { status: 202 });
  }
  if (state && ENDED_ERRORS[state]) return errorResponse(...ENDED_ERRORS[state]);
  const result = state === 'done' ? await bucket.get(resultKey(id)) : null;
  if (!result) {
    if (state) await dispatcher.forgetJob(id, userId);
    return errorResponse('NOT_FOUND', 404);
  }
  // Read whole before dropping it; a result is a few MB at most.
  const body = await result.text();
  runAfterResponse(Promise.all([bucket.delete(resultKey(id)), dispatcher.forgetJob(id, userId)]));
  return new Response(body, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const gate = await gateReadestVoice(request);
  if (!gate.ok) return gate.response;
  const userId = gate.ctx.user.id;
  const { id } = await params;
  if (!JOB_ID.test(id)) return errorResponse('INVALID_INPUT', 400);
  const dispatcher = getDispatcher();
  const bucket = getResultBucket();
  if (!dispatcher || !bucket) return errorResponse('JOBS_UNAVAILABLE', 503);
  await dispatcher.cancelJob(id, userId);
  await Promise.all([dispatcher.forgetJob(id, userId), bucket.delete(resultKey(id))]);
  return new NextResponse(null, { status: 204 });
}
