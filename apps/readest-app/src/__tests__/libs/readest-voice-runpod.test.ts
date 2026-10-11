import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelJob,
  getRunPodConfig,
  startJob,
  streamJob,
  warmup,
  type RunPodConfig,
  type StreamEvent,
} from '@/libs/readestVoice/runpod';

const fetchMock = vi.fn();
const cfg: RunPodConfig = { apiKey: 'rp-key', endpointId: 'ep1', base: 'https://rp.test/v2' };

const collect = async (gen: AsyncGenerator<StreamEvent>) => {
  const out: StreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe('getRunPodConfig', () => {
  it('is null unless both key and endpoint are set (kill switch)', () => {
    vi.stubEnv('RUNPOD_API_KEY', 'k');
    vi.stubEnv('RUNPOD_TTS_ENDPOINT_ID', '');
    expect(getRunPodConfig()).toBeNull();
    vi.stubEnv('RUNPOD_TTS_ENDPOINT_ID', 'ep');
    expect(getRunPodConfig()).toEqual({
      apiKey: 'k',
      endpointId: 'ep',
      base: 'https://api.runpod.ai/v2',
    });
    vi.stubEnv('RUNPOD_API_BASE', 'http://localhost:8801');
    expect(getRunPodConfig()?.base).toBe('http://localhost:8801');
  });
});

describe('startJob', () => {
  it('posts the input to /run with the bearer key and returns the job id', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'job-1', status: 'IN_QUEUE' }));
    expect(await startJob(cfg, { segments: [] })).toBe('job-1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://rp.test/v2/ep1/run');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer rp-key');
    expect(JSON.parse(init.body)).toEqual({ input: { segments: [] } });
  });

  it('throws on a non-OK response or a missing id', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 500 }));
    await expect(startJob(cfg, {})).rejects.toThrow('500');
    fetchMock.mockResolvedValueOnce(Response.json({}));
    await expect(startJob(cfg, {})).rejects.toThrow();
  });
});

describe('streamJob', () => {
  it('yields outputs across polls in order, then the terminal status', async () => {
    fetchMock
      .mockResolvedValueOnce(
        Response.json({ status: 'IN_PROGRESS', stream: [{ output: { id: 's0' } }] }),
      )
      .mockResolvedValueOnce(Response.json({ status: 'IN_PROGRESS', stream: [] }))
      .mockResolvedValueOnce(
        Response.json({ status: 'COMPLETED', stream: [{ output: { id: 's1' } }] }),
      );
    const events = await collect(streamJob(cfg, 'job-1', new AbortController().signal));
    expect(events).toEqual([
      { output: { id: 's0' } },
      { output: { id: 's1' } },
      { status: 'COMPLETED', error: undefined },
    ]);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://rp.test/v2/ep1/stream/job-1');
  });

  it.each(['FAILED', 'CANCELLED', 'TIMED_OUT'])('ends on %s', async (status) => {
    fetchMock.mockResolvedValueOnce(Response.json({ status, stream: [], error: 'boom' }));
    const events = await collect(streamJob(cfg, 'job-1', new AbortController().signal));
    expect(events).toEqual([{ status, error: 'boom' }]);
  });

  it('throws when a poll fails', async () => {
    fetchMock.mockResolvedValueOnce(new Response('x', { status: 502 }));
    await expect(collect(streamJob(cfg, 'j', new AbortController().signal))).rejects.toThrow('502');
  });

  it('passes the abort signal to every poll', async () => {
    const controller = new AbortController();
    fetchMock.mockResolvedValueOnce(Response.json({ status: 'COMPLETED', stream: [] }));
    await collect(streamJob(cfg, 'j', controller.signal));
    expect(fetchMock.mock.calls[0]![1].signal).toBe(controller.signal);
  });
});

describe('best-effort calls', () => {
  it('cancelJob posts /cancel and never throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(cancelJob(cfg, 'job-1')).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[0]![0]).toBe('https://rp.test/v2/ep1/cancel/job-1');
    expect(fetchMock.mock.calls[0]![1].method).toBe('POST');
  });

  it('warmup posts a warmup job to /run and never throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('down'));
    await expect(warmup(cfg)).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://rp.test/v2/ep1/run');
    expect(JSON.parse(init.body)).toEqual({ input: { warmup: true } });
  });
});
