import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/opds/proxy/route';

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
});
