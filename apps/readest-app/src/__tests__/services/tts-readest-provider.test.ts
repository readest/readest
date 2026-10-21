import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
  getAccessToken: vi.fn(),
  getSubscriptionPlan: vi.fn(),
}));

vi.mock('@/utils/fetch', () => ({ fetchWithAuth: m.fetchWithAuth }));
vi.mock('@/services/environment', async (orig) => ({
  ...(await orig<typeof import('@/services/environment')>()),
  getAPIBaseUrl: () => 'https://dev.test/api',
  getReadestVoiceAPIBaseUrl: () => 'https://web.test/api',
}));
vi.mock('@/utils/access', async (orig) => ({
  ...(await orig<typeof import('@/utils/access')>()),
  getAccessToken: m.getAccessToken,
  getSubscriptionPlan: m.getSubscriptionPlan,
}));

import { ReadestVoiceProvider } from '@/services/tts/providers/readest';
import {
  SpeechSynthesisFatalError,
  SpeechSynthesisPermanentError,
  type SpeechSynthesisRequest,
} from '@/services/tts/providers/types';

const VOICES = [{ id: 'kokoro:af_heart', name: 'Heart', lang: 'en-US', tier: 'plus' }];
const B = [{ offset: 0, duration: 5_000_000, text: 'Hello' }];
const AUDIO_B64 = btoa('mp3!');

const req = (text: string, lang = 'en-US'): SpeechSynthesisRequest => ({
  lang,
  text,
  voice: 'kokoro:af_heart',
  pitch: 1,
});
const reqs = (n: number, prefix = 'S') =>
  Array.from({ length: n }, (_, i) => req(`${prefix}${i}.`));

const flush = async (times = 3) => {
  for (let i = 0; i < times; i++) await new Promise((r) => setTimeout(r, 0));
};

interface WindowCall {
  body: {
    client: string;
    lane: string;
    lang: string;
    segments: { id: string; text: string; voice: string }[];
  };
  signal: AbortSignal;
  // Push NDJSON lines into the response body; end closes it.
  send: (line: unknown) => void;
  end: () => void;
  // Answer every segment with audio, then done.
  completeAll: () => void;
}

interface JobCall {
  body: WindowCall['body'];
  id: string;
  polls: number;
  deleted: boolean;
  // Answers the poll in flight: still running, the result, or an error code.
  running: () => void;
  complete: () => void;
  fail: (code: string) => void;
}

// Download jobs (null: the server has none, as off Workers).
let jobs: JobCall[] | null;

const jobResult = (body: WindowCall['body']) =>
  new Response(
    [
      ...body.segments.map((s) => ({ id: s.id, audio: AUDIO_B64, boundaries: B })),
      { done: true, charged: 1 },
    ]
      .map((line) => `${JSON.stringify(line)}\n`)
      .join(''),
  );

const handleJobs = (url: string, init: RequestInit): Promise<Response> => {
  if (!jobs) return Promise.reject(new Error('JOBS_UNAVAILABLE'));
  const all = jobs;
  if (init.method === 'POST') {
    const body = JSON.parse(init.body as string);
    let poll: { resolve: (res: Response) => void; reject: (error: unknown) => void } | null = null;
    const job: JobCall = {
      body,
      id: `job${all.length}`,
      polls: 0,
      deleted: false,
      running: () => poll?.resolve(Response.json({ state: 'leased' }, { status: 202 })),
      complete: () => poll?.resolve(jobResult(body)),
      fail: (code) => poll?.reject(new Error(code)),
    };
    (job as JobCall & { setPoll: (p: typeof poll) => void }).setPoll = (p) => (poll = p);
    all.push(job);
    return Promise.resolve(Response.json({ jobId: job.id, state: 'queued' }));
  }
  const job = all.find((j) => url.endsWith(`/jobs/${j.id}`))!;
  if (init.method === 'DELETE') {
    job.deleted = true;
    return Promise.resolve(new Response(null, { status: 204 }));
  }
  job.polls += 1;
  return new Promise((resolve, reject) => {
    (job as JobCall & { setPoll: (p: unknown) => void }).setPoll({ resolve, reject });
    init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
};

// fetchWithAuth stand-in: GET voices answers at once; each window POST returns
// a streamed NDJSON body the test drives through the recorded WindowCall;
// download jobs go through handleJobs.
const installFetch = () => {
  const windows: WindowCall[] = [];
  m.fetchWithAuth.mockImplementation(async (url: string, init: RequestInit) => {
    if (url.includes('/tts/readest/jobs')) return handleJobs(url, init);
    if (!init.method || init.method === 'GET') return Response.json({ voices: VOICES });
    const body = JSON.parse(init.body as string);
    if (body.warmup) return Response.json({ ok: true });
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({ start: (c) => void (controller = c) });
    const encoder = new TextEncoder();
    const call: WindowCall = {
      body,
      signal: init.signal as AbortSignal,
      send: (line) => controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`)),
      end: () => controller.close(),
      completeAll: () => {
        for (const s of body.segments) call.send({ id: s.id, audio: AUDIO_B64, boundaries: B });
        call.send({ done: true, charged: 1 });
        call.end();
      },
    };
    call.signal?.addEventListener('abort', () =>
      controller.error(new DOMException('Aborted', 'AbortError')),
    );
    expect(url).toBe('https://web.test/api/tts/readest/stream');
    windows.push(call);
    return new Response(stream);
  });
  return windows;
};

const texts = (call: WindowCall) => call.body.segments.map((s) => s.text);

let windows: WindowCall[];
let events: EventTarget;
let provider: ReadestVoiceProvider;

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(m)) fn.mockReset();
  m.getAccessToken.mockResolvedValue('tok');
  m.getSubscriptionPlan.mockReturnValue('plus');
  windows = installFetch();
  jobs = null;
  events = new EventTarget();
  provider = new ReadestVoiceProvider(events);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('voices and init', () => {
  it('lists every voice to every reader, greying out what the plan lacks', async () => {
    const catalog = [
      ...VOICES,
      { id: 'omnivoice:clara', name: 'Clara', lang: 'en-US', tier: 'pro' },
    ];
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(Response.json({ voices: catalog }));
    m.fetchWithAuth.mockResolvedValue(Response.json({ voices: catalog }));
    // Signed out: no auth needed for the catalog, nothing playable, yet the
    // engine is available: a voice is gated only when it is picked.
    m.getAccessToken.mockResolvedValue(null);
    const signedOut = new ReadestVoiceProvider(events);
    expect((await signedOut.getAllVoices()).map((v) => [v.id, !!v.disabled])).toEqual([
      ['kokoro:af_heart', true],
      ['omnivoice:clara', true],
    ]);
    expect(await signedOut.init()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith('https://web.test/api/tts/readest?all=1');
    // Plus: the Pro voice stays visible but greyed out.
    m.getAccessToken.mockResolvedValue('tok');
    m.getSubscriptionPlan.mockReturnValue('plus');
    const plus = new ReadestVoiceProvider(events);
    expect((await plus.getAllVoices()).map((v) => [v.id, !!v.disabled])).toEqual([
      ['kokoro:af_heart', false],
      ['omnivoice:clara', true],
    ]);
    expect(await plus.init()).toBe(true);
    expect(m.fetchWithAuth).toHaveBeenCalledWith('https://web.test/api/tts/readest?all=1', {
      method: 'GET',
    });
  });

  it('fetches the voices once for getAllVoices + init', async () => {
    expect(await provider.getAllVoices()).toEqual(VOICES);
    expect(await provider.init()).toBe(true);
    expect(m.fetchWithAuth).toHaveBeenCalledTimes(1);
  });

  it('lists nothing when the server cannot answer and no voices were saved', async () => {
    m.fetchWithAuth.mockRejectedValueOnce(new Error('NOT_CONFIGURED'));
    expect(await provider.getAllVoices()).toEqual([]);
    expect(await provider.init()).toBe(true);
  });

  it('keeps the last voices when a later listing fails (offline, cold server)', async () => {
    expect(await provider.getAllVoices()).toEqual(VOICES);
    m.fetchWithAuth.mockRejectedValue(new TypeError('Failed to fetch'));
    const next = new ReadestVoiceProvider(events);
    expect(await next.getAllVoices()).toEqual(VOICES);
    expect(await next.init()).toBe(true);
  });

  it('answers from the saved voices at once and refreshes them in the background', async () => {
    await provider.getAllVoices();
    let answer!: (res: Response) => void;
    m.fetchWithAuth.mockImplementation(() => new Promise<Response>((r) => (answer = r)));
    const next = new ReadestVoiceProvider(events);
    // The server has not answered: the saved list still lists at once.
    expect(await next.getAllVoices()).toEqual(VOICES);
    const fresh = [...VOICES, { id: 'kokoro:am_adam', name: 'Adam', lang: 'en-US', tier: 'plus' }];
    answer(Response.json({ voices: fresh }));
    await flush();
    m.fetchWithAuth.mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await new ReadestVoiceProvider(events).getAllVoices()).toEqual(fresh);
  });

  it('keeps the saved voices whatever error the server answers', async () => {
    await provider.getAllVoices();
    m.fetchWithAuth.mockRejectedValue(new Error('NOT_CONFIGURED'));
    await new ReadestVoiceProvider(events).getAllVoices();
    await flush();
    expect(await new ReadestVoiceProvider(events).getAllVoices()).toEqual(VOICES);
  });

  it('orders voices Plus before Pro, each by name', () => {
    const v = (name: string, tier: 'plus' | 'pro', lang = 'en-US') => ({
      id: name,
      name,
      lang,
      tier,
    });
    const sorted = [
      v('Clara', 'pro'),
      v('Emma', 'plus', 'en-GB'),
      v('Arthur', 'pro', 'en-GB'),
      v('Bella', 'plus'),
    ]
      .sort((a, b) => provider.compareVoices(a, b))
      .map((voice) => voice.name);
    expect(sorted).toEqual(['Bella', 'Emma', 'Arthur', 'Clara']);
  });

  it('fires the warmup at most once', async () => {
    provider.warmup();
    provider.warmup();
    await flush();
    const posts = m.fetchWithAuth.mock.calls.filter(([, init]) => init.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]![1].body)).toEqual({ warmup: true });
  });
});

describe('listen windows', () => {
  it('grows windows 1 -> 4 -> 8 and keeps one listen window in flight', async () => {
    const signal = new AbortController().signal;
    provider.prefetch(reqs(21), 'listen', signal);
    await flush();
    expect(windows).toHaveLength(1);
    expect(texts(windows[0]!)).toEqual(['S0.']);
    provider.prefetch(reqs(21), 'listen', signal); // duplicates are ignored
    await flush();
    expect(windows).toHaveLength(1);
    for (const expected of [4, 8, 8]) {
      windows.at(-1)!.completeAll();
      await flush();
      expect(texts(windows.at(-1)!)).toHaveLength(expected);
    }
    expect(windows.map((w) => w.body.lane)).toEqual(['listen', 'listen', 'listen', 'listen']);
  });

  it('caps a listen window at about 20 s of estimated audio', async () => {
    // 150 Latin chars is about 10 s at the default estimate: two fit, three do
    // not. A due sentence waits behind the window in flight, so it stays short.
    const signal = new AbortController().signal;
    const long = Array.from({ length: 8 }, (_, i) => req(`${i}`.padEnd(150, 'a')));
    provider.prefetch(long, 'listen', signal);
    await flush();
    expect(texts(windows[0]!)).toHaveLength(1);
    for (const expected of [2, 2]) {
      windows.at(-1)!.completeAll();
      await flush();
      expect(texts(windows.at(-1)!)).toHaveLength(expected);
    }
  });

  it('lets a window of background preloads hold about a minute of audio', async () => {
    // Nobody is waiting on these sentences: a bigger window amortizes the
    // per-request overhead and lets the GPU batch them.
    const signal = new AbortController().signal;
    const long = Array.from({ length: 8 }, (_, i) => req(`${i}`.padEnd(150, 'a')));
    provider.prefetch(long, 'listen', signal, { background: true });
    await flush();
    expect(texts(windows[0]!)).toHaveLength(1);
    for (const expected of [4, 3]) {
      windows.at(-1)!.completeAll();
      await flush();
      expect(texts(windows.at(-1)!)).toHaveLength(expected);
    }
  });

  it('frees the lane once every sentence of the window has arrived', async () => {
    // The stream's terminal line waits on the job's final status, seconds
    // after the last audio: the next window must not wait for it.
    const signal = new AbortController().signal;
    provider.prefetch(reqs(3), 'listen', signal);
    await flush();
    windows[0]!.send({ id: windows[0]!.body.segments[0]!.id, audio: AUDIO_B64, boundaries: B });
    await flush();
    expect(windows).toHaveLength(2);
    expect(texts(windows[1]!)).toEqual(['S1.', 'S2.']);
  });

  it('resolves each sentence as its line arrives, before the stream ends', async () => {
    const signal = new AbortController().signal;
    provider.prefetch(reqs(1), 'listen', signal);
    const result = provider.synthesize(req('S0.'), signal);
    await flush();
    windows[0]!.send({ id: windows[0]!.body.segments[0]!.id, audio: AUDIO_B64, boundaries: B });
    const { audio, boundaries } = await result;
    expect(new TextDecoder().decode(audio)).toBe('mp3!');
    expect(boundaries).toEqual(B);
  });

  it('synthesize without a prefetch issues a one-sentence window', async () => {
    const result = provider.synthesize(req('Alone.'), new AbortController().signal);
    await flush();
    expect(texts(windows[0]!)).toEqual(['Alone.']);
    windows[0]!.completeAll();
    await expect(result).resolves.toBeTruthy();
  });

  it('maps an error line to a permanent failure for that sentence only', async () => {
    const signal = new AbortController().signal;
    const a = provider.synthesize(req('A.'), signal);
    await flush();
    windows[0]!.completeAll();
    await a;
    provider.prefetch([req('B.'), req('C.')], 'listen', signal);
    const b = provider.synthesize(req('B.'), signal);
    const c = provider.synthesize(req('C.'), signal);
    await flush();
    const [sb, sc] = windows[1]!.body.segments;
    windows[1]!.send({ id: sb!.id, error: 'synthesis failed' });
    windows[1]!.send({ id: sc!.id, audio: AUDIO_B64, boundaries: B });
    windows[1]!.send({ done: true, charged: 2 });
    windows[1]!.end();
    await expect(b).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
    await expect(c).resolves.toBeTruthy();
  });

  it('fails unanswered sentences transiently when the window ends early', async () => {
    const result = provider.synthesize(req('A.'), new AbortController().signal);
    await flush();
    windows[0]!.send({ done: true, charged: 0, error: 'UPSTREAM_FAILED' });
    windows[0]!.end();
    const error = await result.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SpeechSynthesisPermanentError);
    expect(error).not.toBeInstanceOf(SpeechSynthesisFatalError);
  });

  it('never mixes languages in one window', async () => {
    const signal = new AbortController().signal;
    provider.synthesize(req('First.'), signal).catch(() => {});
    await flush();
    provider.prefetch([req('A.'), req('Bonjour.', 'fr-FR'), req('C.')], 'listen', signal);
    windows[0]!.completeAll();
    await flush();
    expect(texts(windows[1]!)).toEqual(['A.']);
    expect(windows[1]!.body.lang).toBe('en-US');
  });

  it('a background synthesize (cache fill) leaves a preload in the background', async () => {
    const signal = new AbortController().signal;
    provider.synthesize(req('First.'), signal).catch(() => {});
    await flush();
    const preload = new AbortController().signal;
    provider.prefetch([req('P0.'), req('P1.')], 'listen', preload, { background: true });
    provider.synthesize(req('P0.'), preload, { background: true }).catch(() => {});
    provider.prefetch([req('F0.')], 'listen', signal);
    windows[0]!.completeAll();
    await flush();
    expect(texts(windows[1]!)).toEqual(['F0.', 'P0.', 'P1.']);
  });

  it('reports each prefetched sentence to onDelivered as it arrives', async () => {
    const onDelivered = vi.fn();
    provider.prefetch([req('A.'), req('B.')], 'listen', new AbortController().signal, {
      onDelivered,
    });
    await flush();
    windows[0]!.completeAll();
    await flush();
    expect(onDelivered).toHaveBeenCalledWith(req('A.'), expect.objectContaining({ boundaries: B }));
    expect(onDelivered).toHaveBeenCalledTimes(1);
  });

  it('fills windows with foreground requests before background preloads', async () => {
    const signal = new AbortController().signal;
    provider.synthesize(req('First.'), signal).catch(() => {});
    await flush();
    provider.prefetch([req('P0.'), req('P1.')], 'listen', new AbortController().signal, {
      background: true,
    });
    provider.prefetch([req('F0.'), req('F1.')], 'listen', signal);
    windows[0]!.completeAll();
    await flush();
    expect(texts(windows[1]!)).toEqual(['F0.', 'F1.', 'P0.', 'P1.']);
  });
});

describe('prefetched sentences', () => {
  it('keeps a delivered sentence for playback after its window ends', async () => {
    provider.prefetch([req('S0.')], 'listen', new AbortController().signal);
    await flush();
    windows[0]!.completeAll();
    await flush();
    // Playback reaches the sentence later: no second synthesis (or charge).
    const result = await provider.synthesize(req('S0.'), new AbortController().signal);
    expect(result.audio.byteLength).toBeGreaterThan(0);
    expect(windows).toHaveLength(1);
  });
});

describe('cancellation', () => {
  it('a stop/seek withdraws queued sentences, aborts the window, and restarts at size 1', async () => {
    const first = new AbortController();
    provider.prefetch(reqs(10), 'listen', first.signal);
    const s0 = provider.synthesize(req('S0.'), first.signal);
    await flush();
    windows[0]!.completeAll();
    await s0;
    await flush();
    expect(texts(windows[1]!)).toHaveLength(4);
    const queued = provider.synthesize(req('S9.'), first.signal);
    first.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });
    expect(windows[1]!.signal.aborted).toBe(true);

    const second = new AbortController();
    provider.prefetch(reqs(3, 'T'), 'listen', second.signal);
    await flush();
    expect(texts(windows[2]!)).toEqual(['T0.']);
  });

  it('a paragraph handover keeps the window size', async () => {
    // Each paragraph's speak signal aborts when the next paragraph starts. Its
    // sentences stay wanted by the background preload, so nothing is withdrawn
    // and the window must not shrink back to one sentence at every paragraph.
    const preload = new AbortController();
    provider.prefetch(reqs(20, 'P'), 'listen', preload.signal, { background: true });
    await flush();
    windows[0]!.completeAll();
    await flush();
    expect(texts(windows[1]!)).toHaveLength(4);
    const paragraph = new AbortController();
    provider.prefetch(reqs(5, 'P').slice(1), 'listen', paragraph.signal);
    windows[1]!.completeAll();
    await flush();
    expect(texts(windows[2]!)).toHaveLength(8);
    paragraph.abort();
    windows[2]!.completeAll();
    await flush();
    expect(texts(windows[3]!)).toHaveLength(7);
  });

  it('keeps a window running while another caller still wants its sentences', async () => {
    const a = new AbortController();
    const b = new AbortController();
    provider.prefetch([req('X.')], 'listen', a.signal);
    const wanted = provider.synthesize(req('X.'), b.signal);
    await flush();
    a.abort();
    expect(windows[0]!.signal.aborted).toBe(false);
    windows[0]!.completeAll();
    await expect(wanted).resolves.toBeTruthy();
  });

  it('a foreground request preempts a window of background preloads', async () => {
    provider.prefetch(reqs(2, 'P'), 'listen', new AbortController().signal, { background: true });
    await flush();
    expect(texts(windows[0]!)).toEqual(['P0.']);
    const now = provider.synthesize(req('Now.'), new AbortController().signal);
    await flush();
    expect(windows[0]!.signal.aborted).toBe(true);
    expect(texts(windows[1]!)).toEqual(['Now.']);
    windows[1]!.completeAll();
    await now;
    await flush();
    // The preempted preload is queued again.
    expect(texts(windows[2]!)).toEqual(['P0.', 'P1.']);
  });
});

describe('errors', () => {
  it('a quota rejection is fatal for everything, fires one event, and stops requesting', async () => {
    const quota = vi.fn();
    events.addEventListener('tts-quota-exceeded', quota);
    m.fetchWithAuth.mockImplementation(async (_url: string, init: RequestInit) => {
      if (init.method === 'POST') throw new Error('DAILY_QUOTA_EXCEEDED');
      return Response.json({ voices: VOICES });
    });
    const signal = new AbortController().signal;
    provider.prefetch(reqs(3), 'listen', signal);
    const results = [0, 1, 2].map((i) => provider.synthesize(req(`S${i}.`), signal));
    for (const r of results) await expect(r).rejects.toBeInstanceOf(SpeechSynthesisFatalError);
    await expect(provider.synthesize(req('Later.'), signal)).rejects.toBeInstanceOf(
      SpeechSynthesisFatalError,
    );
    expect(quota).toHaveBeenCalledTimes(1);
    expect(m.fetchWithAuth).toHaveBeenCalledTimes(1);
    expect(await provider.init()).toBe(true); // a new session may have fresh quota
    await flush();
    provider.synthesize(req('Tomorrow.'), signal).catch(() => {});
    await flush();
    expect(m.fetchWithAuth.mock.calls.filter(([, i]) => i.method === 'POST')).toHaveLength(2);
  });

  it('tells the user again when a later request is refused for quota', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const quota = vi.fn();
      events.addEventListener('tts-quota-exceeded', quota);
      m.fetchWithAuth.mockImplementation(async (_url: string, init: RequestInit) => {
        if (init.method === 'POST') throw new Error('DAILY_QUOTA_EXCEEDED');
        return Response.json({ voices: VOICES });
      });
      const signal = new AbortController().signal;
      await expect(provider.synthesize(req('A.'), signal)).rejects.toThrow();
      await expect(provider.synthesize(req('B.'), signal)).rejects.toThrow();
      // One toast for a burst of refusals (a download refuses many at once).
      expect(quota).toHaveBeenCalledTimes(1);
      // Play pressed again later: refused without a request, but not silently.
      vi.setSystemTime(Date.now() + 10_000);
      await expect(provider.synthesize(req('C.'), signal)).rejects.toThrow();
      expect(quota).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('asks the server again a minute after a quota rejection (retry, upgrade, new day)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      m.fetchWithAuth.mockImplementation(async (_url: string, init: RequestInit) => {
        if (init.method === 'POST') throw new Error('DAILY_QUOTA_EXCEEDED');
        return Response.json({ voices: VOICES });
      });
      const signal = new AbortController().signal;
      await expect(provider.synthesize(req('A.'), signal)).rejects.toBeInstanceOf(
        SpeechSynthesisFatalError,
      );
      await expect(provider.synthesize(req('B.'), signal)).rejects.toBeInstanceOf(
        SpeechSynthesisFatalError,
      );
      const posts = () => m.fetchWithAuth.mock.calls.filter(([, i]) => i.method === 'POST');
      expect(posts()).toHaveLength(1);
      vi.setSystemTime(Date.now() + 60_000);
      await expect(provider.synthesize(req('C.'), signal)).rejects.toBeInstanceOf(
        SpeechSynthesisFatalError,
      );
      expect(posts()).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    'UNKNOWN_VOICE',
    'VOICE_TIER_REQUIRED',
    'INVALID_INPUT',
  ])('maps %s to a permanent failure for the window', async (code) => {
    m.fetchWithAuth.mockRejectedValueOnce(new Error(code));
    const result = provider.synthesize(req('A.'), new AbortController().signal);
    await expect(result).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
  });

  it('rejects an empty voice permanently without a request', async () => {
    const result = provider.synthesize({ ...req('A.'), voice: '' }, new AbortController().signal);
    await expect(result).rejects.toBeInstanceOf(SpeechSynthesisPermanentError);
    expect(m.fetchWithAuth).not.toHaveBeenCalled();
  });
});

describe('download lane, streamed (no jobs on the server)', () => {
  it('uses windows of up to 64 sentences', async () => {
    provider.prefetch(reqs(70), 'download', new AbortController().signal);
    await flush();
    expect(windows[0]!.body.lane).toBe('download');
    expect(texts(windows[0]!)).toHaveLength(64);
    windows[0]!.completeAll();
    await flush();
    expect(texts(windows[1]!)).toHaveLength(6);
  });

  it('names its app instance on every window, so the server queues devices apart', async () => {
    const other = new ReadestVoiceProvider(events);
    provider.prefetch(reqs(1, 'D'), 'download', new AbortController().signal);
    provider.prefetch(reqs(1, 'L'), 'listen', new AbortController().signal);
    other.prefetch(reqs(1, 'O'), 'listen', new AbortController().signal);
    await flush();
    const client = (prefix: string) =>
      windows.find((w) => w.body.segments[0]!.text.startsWith(prefix))!.body.client;
    expect(client('D')).toEqual(expect.any(String));
    expect(client('L')).toBe(client('D'));
    expect(client('O')).not.toBe(client('D'));
  });

  it('runs alongside a listen window', async () => {
    provider.prefetch(reqs(2, 'D'), 'download', new AbortController().signal);
    provider.prefetch(reqs(1, 'L'), 'listen', new AbortController().signal);
    await flush();
    expect(windows.map((w) => w.body.lane).sort()).toEqual(['download', 'listen']);
  });

  it('waits and retries the same window after BUSY', async () => {
    vi.useFakeTimers();
    m.fetchWithAuth.mockRejectedValueOnce(new Error('BUSY'));
    provider.prefetch(reqs(2, 'D'), 'download', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(m.fetchWithAuth).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(texts(windows[0]!)).toEqual(['D0.', 'D1.']);
  });
});

describe('download jobs', () => {
  beforeEach(() => {
    jobs = [];
  });
  const all = () => jobs!;

  it('submits jobs of up to 2000 characters, two at a time', async () => {
    // 900-character sentences: two fit in a window, a third would not.
    const long = Array.from({ length: 10 }, (_, i) => req(`${'a'.repeat(898)}${i}.`));
    provider.prefetch(long, 'download', new AbortController().signal);
    await flush(6);
    expect(all().map((j) => j.body.segments.length)).toEqual([2, 2]);
    expect(all()[0]!.body).toMatchObject({ lane: 'download', lang: 'en-US' });
    expect(windows).toHaveLength(0);

    all()[1]!.complete();
    await flush();
    expect(all().map((j) => j.body.segments.length)).toEqual([2, 2, 2]);
  });

  it('caps a job at the 64 sentences a window may hold', async () => {
    provider.prefetch(reqs(100), 'download', new AbortController().signal);
    await flush(6);
    expect(all().map((j) => j.body.segments.length)).toEqual([64, 36]);
  });

  it('takes over sentences only queued as listening preloads, as download jobs', async () => {
    const listen = new AbortController().signal;
    // Playback is busy with the sentence it waits on; later ones queue up.
    provider.synthesize(req('Now.'), listen).catch(() => {});
    provider.prefetch(reqs(10, 'P'), 'listen', listen, { background: true });
    await flush();
    expect(windows.map(texts)).toEqual([['Now.']]);

    provider.prefetch(reqs(10, 'P'), 'download', new AbortController().signal);
    await flush(6);
    expect(all().map((j) => j.body.segments.map((seg) => seg.text))).toEqual([
      reqs(10, 'P').map((r) => r.text),
    ]);
    // The next listen window no longer carries them.
    windows[0]!.completeAll();
    await flush();
    expect(windows).toHaveLength(1);
  });

  it('leaves a sentence a listen window already carries to that window', async () => {
    const listen = new AbortController().signal;
    provider.prefetch([req('P0.')], 'listen', listen, { background: true });
    await flush();
    expect(windows.map(texts)).toEqual([['P0.']]);
    provider.prefetch([req('P0.')], 'download', new AbortController().signal);
    await flush(6);
    expect(all()).toHaveLength(0);
  });

  it('drops sentences the cache filled meanwhile, cancelling a job left with nothing to do', async () => {
    // 900-character sentences: two per window, two windows sent, three queued.
    const long = Array.from({ length: 10 }, (_, i) => req(`${'a'.repeat(898)}${i}.`));
    const delivered: string[] = [];
    provider.prefetch(long, 'download', new AbortController().signal, {
      onDelivered: (r) => delivered.push(r.text.slice(-2)),
    });
    await flush(6);
    expect(all()).toHaveLength(2);
    // A synced pack arrives with the first window's and the last queued
    // window's sentences.
    const cached = { audio: new ArrayBuffer(4), boundaries: B };
    for (const i of [0, 1, 8, 9]) provider.fulfill!(long[i]!, cached);
    await flush();
    expect(delivered).toEqual(['0.', '1.', '8.', '9.']);
    expect(all()[0]!.deleted).toBe(true);
    expect(all()[1]!.deleted).toBe(false);
    // Run the rest: the fulfilled queued window is never sent.
    for (let round = 0; round < 4; round++) {
      for (const job of all()) if (!job.deleted) job.complete();
      await flush();
    }
    const sent = all().flatMap((j) => j.body.segments.map((seg) => seg.text.slice(-2)));
    expect(sent).not.toContain('8.');
    expect(sent).toContain('7.');
  });

  it('resolves sentences from the result once the job is done, polling meanwhile', async () => {
    const delivered: string[] = [];
    provider.prefetch(reqs(2, 'D'), 'download', new AbortController().signal, {
      onDelivered: (r) => delivered.push(r.text),
    });
    await flush();
    const [job] = all();
    expect(job!.polls).toBe(1);
    job!.running();
    await flush();
    expect(job!.polls).toBe(2);
    expect(delivered).toEqual([]);
    job!.complete();
    await flush();
    expect(delivered).toEqual(['D0.', 'D1.']);
  });

  it('cancels the job when nobody wants it any more', async () => {
    const controller = new AbortController();
    provider.prefetch(reqs(2, 'D'), 'download', controller.signal);
    await flush();
    controller.abort();
    await flush();
    expect(all()[0]!.deleted).toBe(true);
  });

  it('submits a window again when its job was cancelled elsewhere or is gone', async () => {
    provider.prefetch(reqs(2, 'D'), 'download', new AbortController().signal);
    await flush();
    all()[0]!.fail('CANCELLED');
    await flush();
    expect(all()).toHaveLength(2);
    all()[1]!.fail('NOT_FOUND');
    await flush();
    expect(all()).toHaveLength(3);
    expect(all()[2]!.body.segments).toEqual(all()[0]!.body.segments);
  });

  it('fails the sentences of a failed job', async () => {
    provider.prefetch([req('D0.')], 'download', new AbortController().signal);
    // Playback reaches the sentence while its job runs: it shares the job.
    const result = provider.synthesize(req('D0.'), new AbortController().signal);
    await flush();
    all()[0]!.fail('UPSTREAM_FAILED');
    await expect(result).rejects.toThrow('UPSTREAM_FAILED');
    expect(windows).toHaveLength(0);
  });

  it('streams downloads instead when the server has no jobs', async () => {
    jobs = null;
    provider.prefetch(reqs(300), 'download', new AbortController().signal);
    await flush();
    expect(windows).toHaveLength(1);
    expect(windows[0]!.body.lane).toBe('download');
    windows[0]!.completeAll();
    await flush();
    // Remembered: the next window streams without asking for a job again.
    expect(windows).toHaveLength(2);
    const asked = m.fetchWithAuth.mock.calls.filter(([url]) => String(url).includes('/jobs'));
    expect(asked).toHaveLength(1);
  });
});
