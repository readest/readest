import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, HEAD } from '@/app/api/opds/proxy/route';

// SSRF hardening for the OPDS proxy (GHSA-c7mm-g2j2-98cx / GHSA-5g3f-mq2c-j65v).
// The proxy must refuse internal/loopback/link-local targets, non-http(s)
// schemes, and redirects that hop to an internal address — without ever
// reflecting the upstream body.

const proxyReq = (target: string) =>
  new NextRequest(
    `https://web.readest.com/api/opds/proxy?url=${encodeURIComponent(target)}&stream=false`,
  );

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('OPDS proxy SSRF guard', () => {
  it('blocks the AWS metadata endpoint without fetching', async () => {
    const res = await GET(proxyReq('http://169.254.169.254/latest/meta-data/iam/'));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks loopback service ports without fetching', async () => {
    const res = await GET(proxyReq('http://127.0.0.1:6379/'));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks private RFC1918 ranges without fetching', async () => {
    const res = await GET(proxyReq('http://10.0.0.10:8080/admin'));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks non-http(s) schemes without fetching', async () => {
    const res = await GET(proxyReq('file:///etc/passwd'));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('blocks a public URL that redirects to an internal address', async () => {
    // First (and only) upstream hop returns a 302 pointing at the metadata IP.
    fetchSpy.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' },
      }),
    );
    const res = await GET(proxyReq('https://feeds.example.com/redirect'));
    expect(res.status).toBe(400);
    // The internal hop must never be fetched.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('allows LAN catalog targets in development', async () => {
    // `next dev` runs on the developer's own machine, where a LAN OPDS server
    // (e.g. Calibre-Web on the local network) is the normal use case and the
    // CatalogManager UI only forbids LAN URLs in production builds.
    vi.stubEnv('NODE_ENV', 'development');
    fetchSpy.mockResolvedValueOnce(
      new Response('<feed/>', {
        status: 200,
        headers: { 'Content-Type': 'application/atom+xml' },
      }),
    );
    const res = await GET(proxyReq('http://192.168.2.120:8080/opds'));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('proxies a legitimate public feed', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('<feed/>', {
        status: 200,
        headers: { 'Content-Type': 'application/atom+xml' },
      }),
    );
    const res = await GET(proxyReq('https://feeds.example.com/catalog.atom'));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = await res.text();
    expect(body).toContain('<feed');
  });

  it('escapes stray ampersands in XML responses', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('<feed><link href="BOOKS.zip&file=1"/></feed>', {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      }),
    );
    const res = await GET(proxyReq('https://feeds.example.com/catalog.atom'));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('BOOKS.zip&amp;file=1');
  });

  it('preserves non-utf8 XML bytes while escaping stray ampersands', async () => {
    const latin1 = Buffer.from('<feed><title>José & María</title></feed>', 'latin1');
    fetchSpy.mockResolvedValueOnce(
      new Response(latin1, {
        status: 200,
        headers: { 'Content-Type': 'application/xml; charset=iso-8859-1' },
      }),
    );

    const res = await GET(proxyReq('https://feeds.example.com/catalog.atom'));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).toString('latin1')).toContain('José &amp; María');
  });

  it('leaves ampersands inside CDATA unchanged', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('<feed><content><![CDATA[Tom & Jerry]]></content></feed>', {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      }),
    );

    const res = await GET(proxyReq('https://feeds.example.com/catalog.atom'));
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('<![CDATA[Tom & Jerry]]>');
    expect(body).not.toContain('<![CDATA[Tom &amp; Jerry]]>');
  });
});

describe('OPDS proxy response isolation', () => {
  it.each([
    200, 401, 500,
  ])('does not serve active upstream content or origin-controlling headers (%s)', async (status) => {
    fetchSpy.mockResolvedValueOnce(
      new Response('<script>evil()</script>', {
        status,
        headers: {
          'Content-Type': 'text/html',
          'Service-Worker-Allowed': '/',
          'Set-Cookie': 'session=attacker',
          'Content-Security-Policy': "script-src * 'unsafe-inline'",
        },
      }),
    );
    const res = await GET(proxyReq('https://feeds.example.com/page'));
    expect(res.headers.get('Service-Worker-Allowed')).toBeNull();
    expect(res.headers.get('Set-Cookie')).toBeNull();
    expect(res.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('does not expose an upstream JavaScript MIME type', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response('evil()', {
        headers: { 'Content-Type': 'application/javascript', 'Service-Worker-Allowed': '/' },
      }),
    );
    const res = await GET(proxyReq('https://feeds.example.com/sw.js'));
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Service-Worker-Allowed')).toBeNull();
  });

  it('drops credentials and custom headers permanently after a cross-origin redirect', async () => {
    const sent: Headers[] = [];
    fetchSpy.mockImplementation(async (_url: string, init: RequestInit) => {
      sent.push(new Headers(init.headers));
      if (sent.length === 1)
        return new Response(null, {
          status: 302,
          headers: { location: 'https://other.example/feed' },
        });
      if (sent.length === 2)
        return new Response(null, {
          status: 302,
          headers: { location: 'https://feeds.example.com/back' },
        });
      return new Response('<feed/>', { headers: { 'Content-Type': 'application/xml' } });
    });
    await GET(
      new NextRequest(
        `${proxyReq('https://feeds.example.com/feed').url}&auth=Basic%20secret&headers=${encodeURIComponent(JSON.stringify({ 'X-Api-Key': 'secret' }))}`,
      ),
    );
    expect(sent[0]?.get('Authorization')).toBe('Basic secret');
    expect(sent[1]?.get('Authorization')).toBeNull();
    expect(sent[1]?.get('X-Api-Key')).toBeNull();
    expect(sent[2]?.get('Authorization')).toBeNull();
  });
  it.each(['HEAD', 'stream'])('isolates %s responses as well', async (mode) => {
    fetchSpy.mockResolvedValueOnce(
      new Response('evil()', {
        headers: {
          'Content-Type': 'application/javascript',
          'Service-Worker-Allowed': '/',
          'Content-Length': '2097152',
        },
      }),
    );
    const request = new NextRequest(
      proxyReq('https://feeds.example.com/script').url.replace('stream=false', 'stream=true'),
    );
    const res = await (mode === 'HEAD' ? HEAD(request) : GET(request));
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Service-Worker-Allowed')).toBeNull();
    expect(res.headers.get('Content-Security-Policy')).toContain('sandbox');
  });
  it.each([
    ['', 'public, max-age=300'],
    ['&auth=Basic%20test', 'no-store'],
    [`&headers=${encodeURIComponent(JSON.stringify({ 'X-Api-Key': 'test' }))}`, 'no-store'],
  ])('sets the cache policy for request credentials (%s)', async (suffix, expected) => {
    fetchSpy.mockResolvedValueOnce(
      new Response('<feed/>', { headers: { 'Content-Type': 'application/atom+xml' } }),
    );
    const res = await GET(new NextRequest(proxyReq('https://feeds.example.com/feed').url + suffix));
    expect(res.headers.get('Cache-Control')).toBe(expected);
  });
});
