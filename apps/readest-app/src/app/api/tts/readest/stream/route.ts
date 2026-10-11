import { NextRequest } from 'next/server';
import type { TTSWordBoundary } from '@/libs/edgeTTS';
import { getTTSQuota } from '@/utils/access';
import { USAGE_TYPES, UsageStatsManager } from '@/utils/usage';
import {
  acquireSlot,
  releaseSlot,
  setSlotJob,
  SLOT_TTL_SECONDS,
} from '@/libs/readestVoice/admission';
import { runAfterResponse } from '@/libs/readestVoice/bindings';
import { errorResponse, gateReadestVoice } from '@/libs/readestVoice/gate';
import { cancelJob, startJob, streamJob } from '@/libs/readestVoice/runpod';
import { checkVoices, parseWindow, type WindowRequest } from '@/libs/readestVoice/window';

// Readest Voice window route: one RunPod job per window of sentences, streamed
// back as NDJSON, one line per sentence as soon as it is ready, then a
// terminal {done, charged} line. Quota is checked before the window starts
// and charged once, for delivered sentences only, when the stream ends or the
// client goes away (stop, seek, voice change); the RunPod job is cancelled
// then too.

const WINDOW_DEADLINE_MS = SLOT_TTL_SECONDS * 1000;
const BUSY_RETRY_AFTER_SEC = 5;

interface WorkerFrame {
  id?: unknown;
  audio?: unknown;
  boundaries?: unknown;
  failed?: unknown;
}

const encoder = new TextEncoder();
const ndjsonLine = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);

export async function POST(request: NextRequest) {
  const gate = await gateReadestVoice(request);
  if (!gate.ok) return gate.response;
  const { user, plan, config, catalog } = gate.ctx;

  let window: WindowRequest | null = null;
  try {
    window = parseWindow(await request.json());
  } catch {
    // Unparseable body: same flat code as an invalid window.
  }
  if (!window) return errorResponse('INVALID_INPUT', 400);
  const { clientId, lane, lang, segments } = window;

  const voices = checkVoices(catalog, plan, segments);
  if ('error' in voices) return errorResponse(voices.error, voices.status);

  // Every round trip before the job starts is heard as delay, so the quota
  // check and the slot run together. Check before starting; charge only what
  // is delivered (below). The slot may wait for this user's turn; a client
  // that goes away meanwhile withdraws the window.
  const windowChars = segments.reduce((sum, s) => sum + s.text.length, 0);
  const token = crypto.randomUUID();
  const withdraw = () => runAfterResponse(releaseSlot(token));
  request.signal.addEventListener('abort', withdraw, { once: true });
  const [used, slot] = await Promise.all([
    UsageStatsManager.getCurrentUsage(user.id, USAGE_TYPES.TTS_CHARS, 'daily'),
    acquireSlot(user.id, clientId, lane, token),
  ]);
  request.signal.removeEventListener('abort', withdraw);
  if (request.signal.aborted) {
    if (slot.acquired) runAfterResponse(releaseSlot(token));
    return errorResponse('CANCELLED', 499);
  }
  if (used + windowChars > getTTSQuota(plan)) {
    if (slot.acquired) runAfterResponse(releaseSlot(token));
    return errorResponse('DAILY_QUOTA_EXCEEDED', 429);
  }
  if (!slot.acquired) {
    return errorResponse('BUSY', 429, { 'Retry-After': String(BUSY_RETRY_AFTER_SEC) });
  }
  // A new listen window replaced this client's previous one (seek, voice
  // change). Best effort, so the new job does not wait on it.
  if (slot.previousJobId) runAfterResponse(cancelJob(config, slot.previousJobId));

  let jobId: string;
  try {
    jobId = await startJob(config, { lang, segments });
  } catch (error) {
    console.error('Readest Voice job start failed:', error);
    await releaseSlot(token);
    return errorResponse('UPSTREAM_FAILED', 502);
  }
  const headers = { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' };
  // Recorded while the job already streams; resolves false when another
  // window from this user took the slot meanwhile (handled in the stream).
  const slotRecorded = setSlotJob(token, jobId);

  const textLength = new Map(segments.map((s) => [s.id, s.text.length]));
  const upstream = new AbortController();
  let delivered = 0;
  let settled = false;
  let clientGone = false;
  let lostSlot = false;

  // Charge once, free the slot once, whatever ends the window.
  const settle = async (cancel: boolean) => {
    if (settled) return;
    settled = true;
    if (cancel) await cancelJob(config, jobId);
    if (delivered > 0) {
      try {
        await UsageStatsManager.trackUsage(user.id, USAGE_TYPES.TTS_CHARS, delivered, {
          plan,
          lane,
          segments: segments.length,
        });
      } catch (error) {
        console.error(`Readest Voice usage charge failed (job: ${jobId}):`, error);
      }
    }
    await releaseSlot(token);
  };

  const onClientGone = () => {
    if (clientGone) return;
    clientGone = true;
    upstream.abort();
    runAfterResponse(settle(true));
  };
  request.signal.addEventListener('abort', onClientGone, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (value: unknown) => {
        if (!clientGone) controller.enqueue(ndjsonLine(value));
      };
      const finish = async (error?: string, cancel = false) => {
        await settle(cancel);
        if (clientGone) return;
        send(
          error ? { done: true, charged: delivered, error } : { done: true, charged: delivered },
        );
        controller.close();
      };
      const deadline = setTimeout(() => upstream.abort(), WINDOW_DEADLINE_MS);
      void slotRecorded.then((recorded) => {
        if (recorded) return;
        lostSlot = true;
        upstream.abort();
      });
      try {
        for await (const event of streamJob(config, jobId, upstream.signal)) {
          if ('status' in event) {
            const error =
              event.status === 'COMPLETED'
                ? undefined
                : event.status === 'CANCELLED'
                  ? 'CANCELLED'
                  : 'UPSTREAM_FAILED';
            await finish(error);
            return;
          }
          const frame = (event.output ?? {}) as WorkerFrame;
          const length = typeof frame.id === 'string' ? textLength.get(frame.id) : undefined;
          if (length === undefined) continue;
          if (typeof frame.audio === 'string') {
            delivered += length;
            const boundaries = Array.isArray(frame.boundaries)
              ? (frame.boundaries as TTSWordBoundary[])
              : [];
            send({ id: frame.id, audio: frame.audio, boundaries });
          } else {
            // Worker frames say {id, failed}: a top-level `error` would end the
            // RunPod job. The app-facing line uses `error`.
            send({ id: frame.id, error: 'synthesis failed' });
          }
        }
        await finish('UPSTREAM_FAILED', true);
      } catch (error) {
        if (clientGone) return;
        if (lostSlot) {
          // Superseded by another window of this user: end quietly.
          await finish(undefined, true);
          return;
        }
        console.error(`Readest Voice stream failed (job: ${jobId}):`, error);
        await finish('UPSTREAM_FAILED', true);
      } finally {
        clearTimeout(deadline);
        request.signal.removeEventListener('abort', onClientGone);
      }
    },
    cancel() {
      onClientGone();
    },
  });

  return new Response(body, { headers });
}
