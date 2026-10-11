import { NextRequest, NextResponse } from 'next/server';
import { USAGE_TYPES, UsageStatsManager } from '@/utils/usage';
import { getDispatcher, getResultBucket, resultKey } from '@/libs/readestVoice/bindings';
import { errorResponse } from '@/libs/readestVoice/gate';

// Readest Voice workers pull download jobs here (see ../jobs/route.ts), one
// JSON body per call, by `action`:
// - lease {engines, version}: long-polls for a job the worker can run. Needs
//   a worker token (READEST_VOICE_WORKER_TOKENS: "name:token,...") and the
//   deployed worker version (READEST_VOICE_WORKER_VERSION, when set), so a
//   download sounds like listening.
// - job {lease}: the leased window (a RunPod job started by the dispatcher's
//   bridge holds only the lease).
// - heartbeat {lease}: renews the lease; live false means stop.
// - complete {lease, frames}: the worker's frames ({id, audio, boundaries} or
//   {id, failed}), stored as the NDJSON lines the app reads, then charged.
// A lease is the credential for its own job and nothing else.

const LEASE_WAIT_MS = 25_000;

interface WorkerFrame {
  id?: unknown;
  audio?: unknown;
  boundaries?: unknown;
}

const sameSecret = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

const workerName = (request: NextRequest): string | null => {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  for (const entry of (process.env['READEST_VOICE_WORKER_TOKENS'] ?? '').split(',')) {
    const separator = entry.indexOf(':');
    const name = entry.slice(0, separator).trim();
    const secret = entry.slice(separator + 1).trim();
    if (separator > 0 && secret && sameSecret(secret, token)) return name;
  }
  return null;
};

export async function POST(request: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = ((await request.json()) ?? {}) as Record<string, unknown>;
  } catch {
    // Falls through to INVALID_INPUT.
  }
  const { action, lease } = body;
  if (action !== 'lease' && typeof lease !== 'string') return errorResponse('INVALID_INPUT', 400);
  const dispatcher = getDispatcher();
  const bucket = getResultBucket();
  if (!dispatcher || !bucket) return errorResponse('JOBS_UNAVAILABLE', 503);

  switch (action) {
    case 'lease': {
      const worker = workerName(request);
      if (!worker) return errorResponse('NOT_AUTHENTICATED', 401);
      const version = process.env['READEST_VOICE_WORKER_VERSION'];
      if (version && body['version'] !== version) return errorResponse('VERSION_MISMATCH', 409);
      const engines = body['engines'];
      if (!Array.isArray(engines) || !engines.every((e) => typeof e === 'string')) {
        return errorResponse('INVALID_INPUT', 400);
      }
      const job = await dispatcher.leaseJob(worker, engines, LEASE_WAIT_MS);
      return job ? NextResponse.json(job) : new NextResponse(null, { status: 204 });
    }
    case 'job': {
      const job = await dispatcher.leasedJob(lease as string);
      return job ? NextResponse.json(job) : errorResponse('GONE', 410);
    }
    case 'heartbeat':
      return NextResponse.json({ live: await dispatcher.heartbeat(lease as string) });
    case 'complete': {
      const job = await dispatcher.leasedJob(lease as string);
      if (!job) return errorResponse('GONE', 410);
      const frames = new Map<unknown, WorkerFrame>(
        (Array.isArray(body['frames']) ? (body['frames'] as WorkerFrame[]) : []).map((f) => [
          f?.id,
          f,
        ]),
      );
      let charged = 0;
      const lines: unknown[] = job.segments.map(({ id, text }) => {
        const frame = frames.get(id);
        if (typeof frame?.audio !== 'string') return { id, error: 'synthesis failed' };
        charged += text.length;
        const boundaries = Array.isArray(frame.boundaries) ? frame.boundaries : [];
        return { id, audio: frame.audio, boundaries };
      });
      lines.push({ done: true, charged });
      const key = resultKey(job.jobId);
      await bucket.put(key, lines.map((line) => `${JSON.stringify(line)}\n`).join(''));
      const owner = await dispatcher.completeJob(lease as string);
      if (!owner) {
        // Cancelled or re-leased while the result uploaded.
        await bucket.delete(key);
        return errorResponse('GONE', 410);
      }
      if (charged > 0) {
        try {
          await UsageStatsManager.trackUsage(owner.userId, USAGE_TYPES.TTS_CHARS, charged, {
            plan: owner.plan,
            lane: 'download',
            segments: job.segments.length,
          });
        } catch (error) {
          console.error(`Readest Voice usage charge failed (job: ${job.jobId}):`, error);
        }
      }
      return NextResponse.json({ charged });
    }
    default:
      return errorResponse('INVALID_INPUT', 400);
  }
}
