import { NextRequest, NextResponse } from 'next/server';
import { getTTSQuota } from '@/utils/access';
import { USAGE_TYPES, UsageStatsManager } from '@/utils/usage';
import { getDispatcher, getResultBucket } from '@/libs/readestVoice/bindings';
import { errorResponse, gateReadestVoice } from '@/libs/readestVoice/gate';
import { checkVoices, parseWindow, type Segment } from '@/libs/readestVoice/window';

// Readest Voice download jobs: the app submits a window of a chapter download
// and collects it later (jobs/[id]); any worker may synthesize it (workers
// route). Jobs live in the TTSDispatcher Durable Object, results in the
// TTS_JOBS_R2 bucket. Without either (Node dev, self-hosting) the route says
// JOBS_UNAVAILABLE and the app downloads through the stream route instead.
// Quota counts the user's unfinished jobs; delivered sentences are charged
// when a worker completes the job.

const BUSY_RETRY_AFTER_SEC = 5;

// Stable per user and window, so a resubmitted window finds its job.
const jobId = async (userId: string, lang: string, segments: Segment[]) => {
  const data = new TextEncoder().encode(JSON.stringify([userId, lang, segments]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
};

export async function POST(request: NextRequest) {
  const gate = await gateReadestVoice(request);
  if (!gate.ok) return gate.response;
  const { user, plan, catalog } = gate.ctx;

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

  const dispatcher = getDispatcher();
  if (!dispatcher || !getResultBucket()) return errorResponse('JOBS_UNAVAILABLE', 503);
  const used = await UsageStatsManager.getCurrentUsage(user.id, USAGE_TYPES.TTS_CHARS, 'daily');
  const id = await jobId(user.id, lang, segments);
  let result;
  try {
    result = await dispatcher.submitJob({
      id,
      userId: user.id,
      plan,
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
  return NextResponse.json({ jobId: id, state: result.state });
}
