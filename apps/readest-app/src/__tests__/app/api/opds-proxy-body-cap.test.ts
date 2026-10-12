import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from '@/app/api/opds/proxy/route';

// The OPDS proxy is unauthenticated and used to buffer the whole upstream body
// via `response.arrayBuffer()` with no limit — an anonymous caller could point
// it at a huge resource and OOM the Worker. The buffered path now rejects an
// oversized body (413): early on a declared Content-Length, and mid-stream via
// a counting reader when the length is withheld.

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
  vi.restoreAllMocks();
});

describe('OPDS proxy buffered-body cap', () => {
  it('rejects with 413 when the upstream declares an oversized Content-Length', async () => {
    fetchSpy.mockResolvedValue(
      new Response('ignored', {
        status: 200,
        headers: {
          'Content-Type': 'application/xml',
          'Content-Length': String(50 * 1024 * 1024),
        },
      }),
    );

    const res = await GET(proxyReq('https://example.com/huge.xml'));
    expect(res.status).toBe(413);
  });

  it('rejects with 413 when a withheld-length body streams past the cap', async () => {
    // No Content-Length; emit chunks until just over the 10MB cap.
    const chunk = new Uint8Array(1024 * 1024); // 1MB
    let emitted = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (emitted >= 11) {
          controller.close();
          return;
        }
        emitted += 1;
        controller.enqueue(chunk);
      },
    });
    fetchSpy.mockResolvedValue(
      new Response(body, { status: 200, headers: { 'Content-Type': 'application/xml' } }),
    );

    const res = await GET(proxyReq('https://example.com/stream.xml'));
    expect(res.status).toBe(413);
  });

  it('passes a small body through normally (200)', async () => {
    fetchSpy.mockResolvedValue(
      new Response('<feed>ok</feed>', {
        status: 200,
        headers: { 'Content-Type': 'application/xml' },
      }),
    );

    const res = await GET(proxyReq('https://example.com/small.xml'));
    expect(res.status).toBe(200);
  });
});
