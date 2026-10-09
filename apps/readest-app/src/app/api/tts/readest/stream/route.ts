import { NextRequest } from 'next/server';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { TTSWordBoundary } from '@/libs/edgeTTS';
import { getTTSQuota } from '@/utils/access';
import { USAGE_TYPES, UsageStatsManager } from '@/utils/usage';
import {
  acquireSlot,
  releaseSlot,
  setSlotJob,
  SLOT_TTL_SECONDS,
  type TTSLane,
} from '@/libs/readestVoice/admission';
import { findVoice, isVoiceInPlan } from '@/libs/readestVoice/catalog';
import { errorResponse, gateReadestVoice } from '@/libs/readestVoice/gate';
import { cancelJob, startJob, streamJob } from '@/libs/readestVoice/runpod';

// Readest Voice window route: one RunPod job per window of sentences, streamed
// back as NDJSON, one line per sentence as soon as it is ready, then a
// terminal {done, charged} line. Quota is checked before the window starts
// and charged once, for delivered sentences only, when the stream ends or the
// client goes away (stop, seek, voice change); the RunPod job is cancelled
// then too.

const LANE_LIMITS: Record<TTSLane, { segments: number; chars: number }> = {
  listen: { segments: 8, chars: 2000 },
  download: { segments: 64, chars: 12000 },
};
const MAX_SEGMENT_CHARS = 2000;
const WINDOW_DEADLINE_MS = SLOT_TTL_SECONDS * 1000;
const BUSY_RETRY_AFTER_SEC = 5;

interface Segment {
  id: string;
  text: string;
  voice: string;
}

interface WindowRequest {
  lane: TTSLane;
  lang: string;
  segments: Segment[];
}

interface WorkerFrame {
  id?: unknown;
  audio?: unknown;
  boundaries?: unknown;
  failed?: unknown;
}

const parseWindow = (body: unknown): WindowRequest | null => {
  const { lane, lang, segments } = (body ?? {}) as Record<string, unknown>;
  if (lane !== 'listen' && lane !== 'download') return null;
  if (typeof lang !== 'string' || !Array.isArray(segments)) return null;
  const limits = LANE_LIMITS[lane];
  if (segments.length === 0 || segments.length > limits.segments) return null;
  const ids = new Set<string>();
  let chars = 0;
  for (const raw of segments) {
    const { id, text, voice } = (raw ?? {}) as Record<string, unknown>;
    if (typeof id !== 'string' || !id || ids.has(id)) return null;
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_SEGMENT_CHARS) return null;
    if (typeof voice !== 'string') return null;
    ids.add(id);
    chars += text.length;
  }
  if (chars > limits.chars) return null;
  return { lane, lang: lang.slice(0, 35), segments: segments as Segment[] };
};

// Work that must finish after the response is gone (charging, cancelling):
// on Workers it has to be registered with waitUntil or it may be dropped.
const runAfterResponse = (task: Promise<unknown>) => {
  try {
    getCloudflareContext().ctx.waitUntil(task);
  } catch {
    // Not on Workers (tests, Node dev): the promise just runs.
  }
};

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
  const { lane, lang, segments } = window;

  for (const segment of segments) {
    const voice = findVoice(catalog, segment.voice);
    if (!voice) return errorResponse('UNKNOWN_VOICE', 400);
    if (!isVoiceInPlan(voice, plan)) return errorResponse('VOICE_TIER_REQUIRED', 403);
  }

  // Check before starting; charge only what is delivered (below).
  const windowChars = segments.reduce((sum, s) => sum + s.text.length, 0);
  const used = await UsageStatsManager.getCurrentUsage(user.id, USAGE_TYPES.TTS_CHARS, 'daily');
  if (used + windowChars > getTTSQuota(plan)) return errorResponse('DAILY_QUOTA_EXCEEDED', 429);

  const token = crypto.randomUUID();
  const slot = await acquireSlot(user.id, lane, token);
  if (!slot.acquired) {
    return errorResponse('BUSY', 429, { 'Retry-After': String(BUSY_RETRY_AFTER_SEC) });
  }
  // A new listen window supersedes the user's previous one (seek, voice change).
  if (slot.previousJobId) await cancelJob(config, slot.previousJobId);

  let jobId: string;
  try {
    jobId = await startJob(config, { lang, segments });
  } catch (error) {
    console.error('Readest Voice job start failed:', error);
    await releaseSlot(user.id, lane, token);
    return errorResponse('UPSTREAM_FAILED', 502);
  }
  const headers = { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' };
  if (!(await setSlotJob(user.id, lane, token, jobId))) {
    // Another window from this user took the slot while we were starting.
    await cancelJob(config, jobId);
    return new Response(ndjsonLine({ done: true, charged: 0 }), { headers });
  }

  const textLength = new Map(segments.map((s) => [s.id, s.text.length]));
  const upstream = new AbortController();
  let delivered = 0;
  let settled = false;
  let clientGone = false;

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
    await releaseSlot(user.id, lane, token);
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
