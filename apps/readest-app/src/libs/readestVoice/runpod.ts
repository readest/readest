// RunPod Serverless client for the Readest Voice worker: one job per window
// of sentences, read back incrementally from /stream. Every detail of the
// /stream envelope lives in streamJob so a correction is one edit (the local
// emulator in the readest-voice worker repo mirrors it; verify against real RunPod
// before deploy).

export interface RunPodConfig {
  apiKey: string;
  endpointId: string;
  base: string;
}

export type TerminalStatus = 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'TIMED_OUT';
export type StreamEvent = { output: unknown } | { status: TerminalStatus; error?: string };

const DEFAULT_RUNPOD_API_BASE = 'https://api.runpod.ai/v2';
const TERMINAL: readonly string[] = ['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
// /stream long-polls; after an empty reply, wait briefly before asking again.
const EMPTY_POLL_DELAY_MS = 100;

// Unset key or endpoint is the kill switch: the routes answer 503.
// RUNPOD_API_BASE points the routes at the local emulator in development.
export const getRunPodConfig = (): RunPodConfig | null => {
  const apiKey = process.env['RUNPOD_API_KEY'];
  const endpointId = process.env['RUNPOD_TTS_ENDPOINT_ID'];
  if (!apiKey || !endpointId) return null;
  return { apiKey, endpointId, base: process.env['RUNPOD_API_BASE'] || DEFAULT_RUNPOD_API_BASE };
};

const headers = (cfg: RunPodConfig) => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${cfg.apiKey}`,
});

const url = (cfg: RunPodConfig, path: string) => `${cfg.base}/${cfg.endpointId}/${path}`;

export const startJob = async (cfg: RunPodConfig, input: unknown): Promise<string> => {
  const res = await fetch(url(cfg, 'run'), {
    method: 'POST',
    headers: headers(cfg),
    body: JSON.stringify({ input }),
  });
  if (!res.ok) throw new Error(`RunPod run failed: ${res.status}`);
  const { id } = (await res.json()) as { id?: unknown };
  if (typeof id !== 'string' || !id) throw new Error('RunPod run returned no job id');
  return id;
};

export async function* streamJob(
  cfg: RunPodConfig,
  jobId: string,
  signal: AbortSignal,
): AsyncGenerator<StreamEvent> {
  for (;;) {
    const res = await fetch(url(cfg, `stream/${jobId}`), { headers: headers(cfg), signal });
    if (!res.ok) throw new Error(`RunPod stream failed: ${res.status} (job: ${jobId})`);
    const body = (await res.json()) as {
      status?: string;
      stream?: { output?: unknown }[];
      error?: string;
    };
    const items = body.stream ?? [];
    for (const item of items) yield { output: item.output };
    if (body.status && TERMINAL.includes(body.status)) {
      yield { status: body.status as TerminalStatus, error: body.error };
      return;
    }
    if (!items.length) await new Promise((resolve) => setTimeout(resolve, EMPTY_POLL_DELAY_MS));
  }
}

// Best effort: a failed cancel only means the worker finishes the window.
export const cancelJob = async (cfg: RunPodConfig, jobId: string): Promise<void> => {
  try {
    await fetch(url(cfg, `cancel/${jobId}`), { method: 'POST', headers: headers(cfg) });
  } catch (error) {
    console.warn(`RunPod cancel failed (job: ${jobId}):`, error);
  }
};

// Voice-picker-open warmup: boots a worker and loads Kokoro so the first
// window hits a warm engine. Fire-and-forget via the async /run endpoint.
export const warmup = async (cfg: RunPodConfig): Promise<void> => {
  try {
    await fetch(url(cfg, 'run'), {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify({ input: { warmup: true } }),
    });
  } catch (error) {
    console.warn('RunPod warmup failed:', error);
  }
};
