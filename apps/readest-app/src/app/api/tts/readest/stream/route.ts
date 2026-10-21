import { NextRequest } from 'next/server';
import { getTTSQuota } from '@/utils/access';
import { readNDJSON } from '@/utils/ndjson';
import { USAGE_TYPES, UsageStatsManager } from '@/utils/usage';
import { errorResponse, gateReadestVoice } from '@/libs/readestVoice/gate';
import { runAfterResponse } from '@/libs/readestVoice/service';
import { checkVoices, parseWindow, type WindowRequest } from '@/libs/readestVoice/window';

// Readest Voice window route: the Readest Voice service synthesizes the
// window and streams it as NDJSON, one line per sentence as soon as it is
// ready; this route relays the lines and ends with {done, charged}. Quota is
// checked before the window starts and charged once, for delivered sentences
// only, when the stream ends or the client goes away (stop, seek, voice
// change). A window this route gives up on (client gone, stream broken) is
// ended in the service with releaseWindow, which stops its synthesis: a
// stream cancelled across the service binding may not reach the service.

const BUSY_RETRY_AFTER_SEC = 5;

interface Line {
  id?: unknown;
  audio?: unknown;
  done?: unknown;
  error?: unknown;
}

const encoder = new TextEncoder();
const ndjsonLine = (value: unknown) => encoder.encode(`${JSON.stringify(value)}\n`);

export async function POST(request: NextRequest) {
  const gate = await gateReadestVoice(request);
  if (!gate.ok) return gate.response;
  const { user, plan, service, catalog } = gate.ctx;

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

  // Every round trip before the window starts is heard as delay, so the
  // quota check and the slot run together. Check before starting; charge
  // only what is delivered (below). The slot may wait for this user's turn;
  // a client that goes away meanwhile withdraws the window.
  const windowChars = segments.reduce((sum, s) => sum + s.text.length, 0);
  const token = crypto.randomUUID();
  const release = () => runAfterResponse(service.releaseWindow(token));
  request.signal.addEventListener('abort', release, { once: true });
  let used: number;
  let admitted: { acquired: boolean; pendingChars: number };
  try {
    [used, admitted] = await Promise.all([
      UsageStatsManager.getCurrentUsage(user.id, USAGE_TYPES.TTS_CHARS, 'daily'),
      service.admitWindow({ token, userId: user.id, clientId, lane }),
    ]);
  } catch (error) {
    console.error('Readest Voice admission failed:', error);
    release();
    return errorResponse('UPSTREAM_FAILED', 502);
  } finally {
    request.signal.removeEventListener('abort', release);
  }
  if (request.signal.aborted) {
    if (admitted.acquired) release();
    return errorResponse('CANCELLED', 499);
  }
  if (used + admitted.pendingChars + windowChars > getTTSQuota(plan)) {
    if (admitted.acquired) release();
    return errorResponse('DAILY_QUOTA_EXCEEDED', 429);
  }
  if (!admitted.acquired) {
    return errorResponse('BUSY', 429, { 'Retry-After': String(BUSY_RETRY_AFTER_SEC) });
  }

  let opened;
  try {
    opened = await service.streamWindow(token, { lang, segments });
  } catch (error) {
    console.error('Readest Voice window failed to start:', error);
    release();
    return errorResponse('UPSTREAM_FAILED', 502);
  }
  // The service frees the slot of a window that did not start.
  if (!opened.ok) {
    return errorResponse(opened.error, opened.error === 'NOT_CONFIGURED' ? 503 : 502);
  }

  const textLength = new Map(segments.map((s) => [s.id, s.text.length]));
  const stop = new AbortController();
  let delivered = 0;
  let charged = false;

  // Charge once, whatever ends the window.
  const charge = async () => {
    if (charged) return;
    charged = true;
    if (delivered === 0) return;
    try {
      await UsageStatsManager.trackUsage(user.id, USAGE_TYPES.TTS_CHARS, delivered, {
        plan,
        lane,
        segments: segments.length,
      });
    } catch (error) {
      console.error('Readest Voice usage charge failed:', error);
    }
  };

  const onClientGone = () => {
    stop.abort();
    release();
    runAfterResponse(charge());
  };
  request.signal.addEventListener('abort', onClientGone, { once: true });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      // A stream that ends without its {done} line was cut off.
      let error: unknown = 'UPSTREAM_FAILED';
      let ended = false;
      try {
        for await (const value of readNDJSON(opened.stream, stop.signal)) {
          const line = value as Line;
          if (line.done) {
            error = line.error;
            ended = true;
            break;
          }
          const length = typeof line.id === 'string' ? textLength.get(line.id) : undefined;
          if (length !== undefined && typeof line.audio === 'string') delivered += length;
          if (!stop.signal.aborted) controller.enqueue(ndjsonLine(line));
        }
      } catch (streamError) {
        if (!stop.signal.aborted) console.error('Readest Voice stream failed:', streamError);
      } finally {
        request.signal.removeEventListener('abort', onClientGone);
      }
      await charge();
      if (stop.signal.aborted) return;
      if (!ended) release();
      controller.enqueue(
        ndjsonLine(
          typeof error === 'string'
            ? { done: true, charged: delivered, error }
            : { done: true, charged: delivered },
        ),
      );
      controller.close();
    },
    cancel() {
      onClientGone();
    },
  });

  return new Response(body, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' },
  });
}
