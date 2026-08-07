import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const validateUserAndTokenMock = vi.hoisted(() => vi.fn());
vi.mock('@/utils/access', () => ({
  validateUserAndToken: (...args: unknown[]) => validateUserAndTokenMock(...args),
}));

import { POST } from '@/app/api/azure-translate/route';

const BING_PAGE = `
  <html><script>var IG:"01CE353230DE4BFD8A44466FDD91401A";</script>
  <div data-iid="translator.5025"></div>
  <script>var params_AbusePreventionHelper = [1786092445798,"page-token",3600000];</script>
  </html>
`;

const makeReq = (
  query = 'endpoint=translate',
  init: {
    body?: string;
    origin?: string | null;
    contentLength?: string | null;
    authorization?: string;
  } = {},
) => {
  const body = init.body ?? 'text=Hello&to=fr';
  const headers: Record<string, string> = {
    authorization: init.authorization ?? 'Bearer test-token',
  };
  if (init.origin !== null) headers['origin'] = init.origin ?? 'https://web.readest.com';
  if (init.contentLength !== null) {
    headers['content-length'] = init.contentLength ?? String(new TextEncoder().encode(body).length);
  }
  return new NextRequest(`https://web.readest.com/api/azure-translate?${query}`, {
    method: 'POST',
    body,
    headers,
  });
};

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  validateUserAndTokenMock.mockReset().mockImplementation(async (authorization: string | null) => ({
    user: authorization ? { id: authorization } : null,
    token: authorization,
  }));
  fetchSpy = vi.fn().mockResolvedValue(
    new Response('[{"translations":[{"text":"Bonjour"}]}]', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('azure-translate proxy route', () => {
  it('returns 403 before reading the body or fetching when unauthenticated', async () => {
    validateUserAndTokenMock.mockResolvedValue({ user: null, token: null });
    const request = makeReq();
    const textSpy = vi.spyOn(request, 'text');

    const res = await POST(request);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Not authenticated' });
    expect(textSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown endpoint without fetching', async () => {
    const res = await POST(makeReq('endpoint=evil'));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('never lets a caller redirect the upstream fetch elsewhere', async () => {
    // `endpoint` is matched against a fixed allowlist rather than used as a
    // URL, so a caller cannot point the proxy at an arbitrary host.
    const res = await POST(makeReq('endpoint=https://evil.example.com'));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('parses the translator page server-side and returns only the auth params', async () => {
    fetchSpy.mockResolvedValue(new Response(BING_PAGE, { status: 200 }));

    const res = await POST(makeReq('endpoint=auth'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ig).toBe('01CE353230DE4BFD8A44466FDD91401A');
    expect(body.iid).toBe('translator.5025');
    expect(body.key).toBe('1786092445798');
    expect(body.token).toBe('page-token');
    expect(typeof body.expiresAt).toBe('number');
    // The 650KB page itself must never reach the browser.
    expect(JSON.stringify(body)).not.toContain('params_AbusePreventionHelper');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toBe('https://www.bing.com/translator');
  });

  it('returns 502 when the translator page can no longer be parsed', async () => {
    fetchSpy.mockResolvedValue(new Response('<html>redesigned</html>', { status: 200 }));
    const res = await POST(makeReq('endpoint=auth'));
    expect(res.status).toBe(502);
  });

  it('forwards translate requests to ttranslatev3 with the telemetry query', async () => {
    const res = await POST(makeReq('endpoint=translate&isVertical=1&IG=IG1&IID=translator.5025'));

    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain('https://www.bing.com/ttranslatev3');
    expect(String(url)).toContain('IG=IG1');
    expect(String(url)).toContain('IID=translator.5025');
    expect(String(url)).not.toContain('endpoint=');
    // Bing rejects the call without a browser Referer.
    expect((init as RequestInit).headers).toMatchObject({
      Referer: 'https://www.bing.com/translator',
    });
    expect((init as RequestInit).body).toBe('text=Hello&to=fr');
  });

  it('rejects cross-origin requests without fetching', async () => {
    const res = await POST(makeReq('endpoint=translate', { origin: 'https://evil.example.com' }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects requests without an Origin header', async () => {
    const res = await POST(makeReq('endpoint=translate', { origin: null }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects oversized bodies without fetching', async () => {
    const res = await POST(
      makeReq('endpoint=translate', { contentLength: String(100_000 * 3 + 1) }),
    );
    expect(res.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes through the upstream status code and body', async () => {
    fetchSpy.mockResolvedValue(
      new Response('{"statusCode":205,"errorMessage":""}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const res = await POST(makeReq('endpoint=translate'));
    expect(res.status).toBe(200);
    // The 205-in-a-200 signal must survive the hop so the client re-authenticates.
    expect(await res.json()).toEqual({ statusCode: 205, errorMessage: '' });
  });

  it('returns 502 when the upstream is unreachable', async () => {
    fetchSpy.mockRejectedValue(new Error('network down'));
    const res = await POST(makeReq('endpoint=translate'));
    expect(res.status).toBe(502);
  });

  it('rejects concurrent requests beyond the limit', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchSpy.mockImplementation(async () => {
      await gate;
      return new Response('[]', { status: 200 });
    });

    const inflight = [
      POST(makeReq('endpoint=translate')),
      POST(makeReq('endpoint=translate')),
      POST(makeReq('endpoint=translate')),
    ];
    // Let the three in-flight requests occupy every slot before the fourth.
    await Promise.resolve();
    const rejected = await POST(makeReq('endpoint=translate'));
    expect(rejected.status).toBe(429);

    release();
    await Promise.all(inflight);
  });

  it('sets an upstream timeout', async () => {
    await POST(makeReq('endpoint=translate'));
    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
