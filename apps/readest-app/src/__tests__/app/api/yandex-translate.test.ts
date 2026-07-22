import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/yandex-translate/route';

const makeReq = (
  query = 'endpoint=session',
  init: { body?: string; origin?: string | null; contentLength?: string | null } = {},
) => {
  const body = init.body ?? 'options=0&text=Hello';
  const headers: Record<string, string> = {};
  if (init.origin !== null) headers['origin'] = init.origin ?? 'https://web.readest.com';
  if (init.contentLength !== null) {
    headers['content-length'] = init.contentLength ?? String(new TextEncoder().encode(body).length);
  }
  return new NextRequest(`https://web.readest.com/api/yandex-translate?${query}`, {
    method: 'POST',
    body,
    headers,
  });
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue(
    new Response('{"code":200,"text":["Bonjour"]}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('yandex-translate proxy route', () => {
  it('returns 400 for an unknown endpoint without fetching', async () => {
    const res = await POST(makeReq('endpoint=nope'));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards session requests to the yandex session endpoint with required headers', async () => {
    const res = await POST(makeReq('endpoint=session&srv=tr-text&yu=123'));
    expect(res.status).toBe(200);

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('https://translate.yandex.ru/props/api/v1.0/sessions');
    expect(String(url)).toContain('srv=tr-text');
    expect(String(url)).toContain('yu=123');
    expect(String(url)).not.toContain('endpoint=');
    expect(init.headers['Referer']).toBe('https://translate.yandex.ru/');
    expect(init.headers['Origin']).toBe('https://translate.yandex.ru');
    expect(init.headers['User-Agent']).toContain('YaBrowser');
    expect(await res.json()).toEqual({ code: 200, text: ['Bonjour'] });
  });

  it('forwards translate requests to the tr.json endpoint and relays the body', async () => {
    await POST(
      makeReq('endpoint=translate&source_lang=en&target_lang=ru', {
        body: 'options=0&text=Hello',
      }),
    );

    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('https://translate.yandex.net/api/v1/tr.json/translate');
    expect(String(url)).toContain('source_lang=en');
    expect(String(url)).toContain('target_lang=ru');
    expect(init.body).toBe('options=0&text=Hello');
  });

  it('rejects cross-origin requests without fetching', async () => {
    const res = await POST(makeReq('endpoint=session', { origin: 'https://evil.example.com' }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows same-origin requests', async () => {
    const res = await POST(makeReq('endpoint=session', { origin: 'https://web.readest.com' }));
    expect(res.status).toBe(200);
  });

  it('rejects requests without an Origin header', async () => {
    const res = await POST(makeReq('endpoint=session', { origin: null }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('allows an empty session request without Content-Length', async () => {
    const res = await POST(makeReq('endpoint=session', { body: '', contentLength: null }));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('accepts a non-empty chunked request without Content-Length', async () => {
    const res = await POST(makeReq('endpoint=translate', { contentLength: null }));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('rejects oversized bodies without fetching', async () => {
    const res = await POST(makeReq('endpoint=translate', { body: 'x'.repeat(100_001) }));
    expect(res.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects concurrent requests before reading their bodies', async () => {
    const releaseFetches: Array<() => void> = [];
    fetchSpy.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releaseFetches.push(() => resolve(new Response('{"code":200}', { status: 200 })));
        }),
    );

    const pending = [1, 2, 3].map(() =>
      POST(
        makeReq('endpoint=session', {
          origin: 'https://web.readest.com',
          contentLength: '0',
          body: '',
        }),
      ),
    );
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));

    const rejectedRequest = makeReq('endpoint=session', {
      origin: 'https://web.readest.com',
      contentLength: '0',
      body: '',
    });
    const textSpy = vi.spyOn(rejectedRequest, 'text');
    const rejected = await POST(rejectedRequest);

    expect(rejected.status).toBe(429);
    expect(textSpy).not.toHaveBeenCalled();

    releaseFetches.forEach((release) => release());
    await Promise.all(pending);
  });

  it('returns 502 when reading the upstream body fails', async () => {
    fetchSpy.mockResolvedValue({
      status: 200,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: vi.fn().mockRejectedValue(new Error('connection reset')),
    });
    const res = await POST(makeReq('endpoint=session'));
    expect(res.status).toBe(502);
  });

  it('returns 502 when the upstream is unreachable', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    const res = await POST(makeReq('endpoint=session'));
    expect(res.status).toBe(502);
  });

  it('passes through the upstream status code and body', async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"code":413,"message":"The text size exceeds the maximum"}', {
        status: 413,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res = await POST(makeReq('endpoint=translate'));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ code: 413, message: 'The text size exceeds the maximum' });
  });

  it('sets an upstream timeout', async () => {
    await POST(makeReq('endpoint=session'));
    const [, init] = fetchSpy.mock.calls[0]!;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts the upstream request after the timeout elapses', async () => {
    vi.stubEnv('YANDEX_UPSTREAM_TIMEOUT_MS', '50');
    fetchSpy.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('The operation timed out', 'TimeoutError')),
          );
        }),
    );

    const res = await POST(makeReq('endpoint=session'));
    expect(res.status).toBe(502);
    expect(fetchSpy.mock.calls[0]![1].signal.aborted).toBe(true);
  });

  it.each([
    '-100',
    'abc',
    'Infinity',
  ])('ignores invalid timeout env value %s instead of breaking requests', async (envValue) => {
    vi.stubEnv('YANDEX_UPSTREAM_TIMEOUT_MS', envValue);
    fetchSpy.mockImplementation((_url: string, init: RequestInit) => {
      if (init.signal?.aborted) {
        return Promise.reject(new DOMException('The operation was aborted', 'AbortError'));
      }
      return Promise.resolve(
        new Response('{"code":200}', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });

    const res = await POST(makeReq('endpoint=session'));
    expect(res.status).toBe(200);
  });
});
