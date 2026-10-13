import { NextRequest, NextResponse } from 'next/server';
import { getTTSQuota } from '@/utils/access';
import { USAGE_TYPES, UsageStatsManager } from '@/utils/usage';
import { errorResponse, gateReadestVoice } from '@/libs/readestVoice/gate';
import { checkVoices, parseWindow } from '@/libs/readestVoice/window';

// Readest Voice download jobs: the app submits a window of a chapter download
// and collects it later (jobs/[id]); the Readest Voice service queues it for
// any of its workers. Quota counts the user's uncharged jobs (the service
// checks it against quotaLeft); delivered sentences are charged when the app
// collects the result. JOBS_UNAVAILABLE makes the app download through the
// stream route instead.

const BUSY_RETRY_AFTER_SEC = 5;

export async function POST(request: NextRequest) {
  const gate = await gateReadestVoice(request);
  if (!gate.ok) return gate.response;
  const { user, plan, service, catalog } = gate.ctx;

  let window = null;
  try {
    window = parseWindow(await request.json());
  } catch {
    // Unparseable body: same flat code as an invalid window.
  }
  if (!window || window.lane !== 'download') return errorResponse('INVALID_INPUT', 400);
  const { lang, segments } = window;
  const voices = checkVoices(catalog, plan, segments);
  if ('error' in voices) return errorResponse(voices.error, voices.status);

  const used = await UsageStatsManager.getCurrentUsage(user.id, USAGE_TYPES.TTS_CHARS, 'daily');
  let result;
  try {
    result = await service.submitJob({
      userId: user.id,
      lang,
      segments,
      engines: voices.engines,
      quotaLeft: getTTSQuota(plan) - used,
    });
  } catch (error) {
    console.error('Readest Voice job submit failed:', error);
    return errorResponse('JOBS_UNAVAILABLE', 503);
  }
  if (!result.ok) {
    const headers =
      result.error === 'BUSY' ? { 'Retry-After': String(BUSY_RETRY_AFTER_SEC) } : undefined;
    return errorResponse(result.error, 429, headers);
  }
  return NextResponse.json({ jobId: result.jobId, state: result.state });
}
