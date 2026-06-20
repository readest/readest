import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RemoteFile } from '@/utils/file';

// RemoteFile.fromNativePath serves a local file through the `rangefile` custom
// URI scheme, carrying the byte range in the URL query (?start=&end=) rather
// than a `Range` header — because Android's WebView re-applies a `Range`
// header's offset to intercepted bodies and corrupts non-zero-start reads.
describe('RemoteFile.fromNativePath (rangefile query-range scheme)', () => {
  const path = '/data/user/0/com.bilingify.readest/cache/堂吉诃德（译文名著典藏）.mobi';
  const TOTAL = 10371956;
  let calls: Array<{ url: string; init?: RequestInit }>;
  let data: Uint8Array;

  beforeEach(() => {
    calls = [];
    data = new Uint8Array(8192);
    for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
    globalThis.fetch = vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const u = new URL(url);
      const start = Number(u.searchParams.get('start') ?? 0);
      const end = Number(u.searchParams.get('end') ?? 0);
      const body = data.slice(start, Math.min(end + 1, data.length));
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'X-Total-Size': String(TOTAL),
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(body.length),
        }),
        arrayBuffer: async () =>
          body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
      } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const noRangeHeader = () =>
    calls.every((c) => {
      const h = c.init?.headers as Record<string, string> | undefined;
      return !h || !Object.keys(h).some((k) => k.toLowerCase() === 'range');
    });

  it('builds a rangefile.localhost URL with the path percent-encoded in the query', () => {
    const f = RemoteFile.fromNativePath(path, 'book.mobi');
    expect(f.url).toBe(`http://rangefile.localhost/?path=${encodeURIComponent(path)}`);
    expect(f.name).toBe('book.mobi');
  });

  it('open() reads the size from X-Total-Size and sends NO Range header', async () => {
    const f = await RemoteFile.fromNativePath(path).open();
    expect(f.size).toBe(TOTAL);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('start=0');
    expect(calls[0]!.url).toContain('end=0');
    expect(noRangeHeader()).toBe(true);
  });

  it('fetchRangePart() carries the range in the query, not a Range header', async () => {
    const f = await RemoteFile.fromNativePath(path).open();
    calls.length = 0;
    const buf = await f.fetchRangePart(1024, 2047);
    expect(buf.byteLength).toBe(1024);
    expect(calls).toHaveLength(1);
    const u = new URL(calls[0]!.url);
    expect(u.searchParams.get('start')).toBe('1024');
    expect(u.searchParams.get('end')).toBe('2047');
    expect(noRangeHeader()).toBe(true);
    // bytes must be the real [1024,2047] slice (proves no offset re-application)
    expect(new Uint8Array(buf)[0]).toBe(1024 & 0xff);
  });

  it('slice().arrayBuffer() returns the correct bytes for a non-zero offset', async () => {
    const f = await RemoteFile.fromNativePath(path).open();
    const buf = await f.slice(2000, 2010).arrayBuffer(); // [2000, 2010)
    expect(buf.byteLength).toBe(10);
    expect(new Uint8Array(buf)[0]).toBe(2000 & 0xff);
    expect(noRangeHeader()).toBe(true);
  });
});
