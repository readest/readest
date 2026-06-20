import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolveActiveShareMock = vi.fn();
const getDownloadSignedUrlMock = vi.fn();

vi.mock('@/libs/shareServer', async (orig) => {
  const actual = await orig<typeof import('@/libs/shareServer')>();
  return { ...actual, resolveActiveShare: (...a: unknown[]) => resolveActiveShareMock(...a) };
});
vi.mock('@/utils/object', () => ({
  getDownloadSignedUrl: (...a: unknown[]) => getDownloadSignedUrlMock(...a),
}));

import { GET } from '@/app/api/share/[token]/download/route';

const PRESIGNED = 'https://r2.example.com/u/Books/hash/book.epub?X-Amz-Signature=xyz';
const params = (token: string) => ({ params: Promise.resolve({ token }) });

beforeEach(() => {
  resolveActiveShareMock.mockReset().mockResolvedValue({
    ok: true,
    share: { bookFileKey: 'u/Books/hash/book.epub' },
  });
  getDownloadSignedUrlMock.mockReset().mockResolvedValue(PRESIGNED);
});

describe('GET /api/share/[token]/download', () => {
  // The importer relies on this 302: the client (native HTTP on app, the page's
  // own fetch on web) follows it to R2 without tripping CORS.
  it('302-redirects to the presigned URL', async () => {
    const res = await GET(
      new Request('https://web.readest.com/api/share/tok/download'),
      params('tok'),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(PRESIGNED);
  });

  it('propagates rejection status without presigning', async () => {
    resolveActiveShareMock.mockResolvedValue({ ok: false, reason: { kind: 'expired' } });
    const res = await GET(
      new Request('https://web.readest.com/api/share/tok/download'),
      params('tok'),
    );
    expect(res.status).toBe(410);
    expect(getDownloadSignedUrlMock).not.toHaveBeenCalled();
  });
});
