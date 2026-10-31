import { describe, it, expect, vi, beforeEach } from 'vitest';

// A book's synced data (TTS packs) lives under its hash with the same
// `book_hash` as the book file, so every route that picks "the book file" from
// the `files` rows must skip it, or a share serves an .mp3 instead of the EPUB.

const objectExistsMock = vi.fn();
let fileRows: { file_key: string; file_size: number }[] = [];

vi.mock('@/utils/access', () => ({
  validateUserAndToken: vi.fn().mockResolvedValue({ user: { id: 'u1' }, token: 'tok' }),
}));
vi.mock('@/utils/object', () => ({
  objectExists: (...a: unknown[]) => objectExistsMock(...a),
}));

const builder = (table: string) => {
  const result = table === 'files' ? { data: fileRows, error: null } : { data: null, error: null };
  const b: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'gt', 'insert']) b[m] = () => b;
  b['maybeSingle'] = async () => ({
    data: {
      id: 's1',
      user_id: 'u1',
      book_hash: 'abc',
      expires_at: new Date(Date.now() + 86400000).toISOString(),
      revoked_at: null,
    },
    error: null,
  });
  // biome-ignore lint/suspicious/noThenProperty: mock PostgREST builder is intentionally thenable
  b['then'] = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return b;
};

vi.mock('@/utils/supabase', () => ({
  createSupabaseAdminClient: () => ({ from: (t: string) => builder(t) }),
}));

import { POST } from '@/app/api/share/create/route';
import { resolveActiveShare } from '@/libs/shareServer';

const createShare = () =>
  POST(
    new Request('http://localhost/api/share/create', {
      method: 'POST',
      body: JSON.stringify({ bookHash: 'abc', expirationDays: 7, title: 'T', format: 'EPUB' }),
    }),
  );

const MP3 = { file_key: 'u1/Readest/Books/abc/tts/3-f.mp3', file_size: 5 };
const JSON_ = { file_key: 'u1/Readest/Books/abc/tts/3-f.json', file_size: 1 };
const EPUB = { file_key: 'u1/Readest/Books/abc/Title.epub', file_size: 100 };

beforeEach(() => {
  objectExistsMock.mockReset().mockResolvedValue(true);
});

describe('share routes skip book-data files', () => {
  it('share create picks the EPUB, not a TTS pack listed before it', async () => {
    fileRows = [MP3, JSON_, EPUB];
    const res = await createShare();
    expect(res.status).toBe(200);
    expect(objectExistsMock).toHaveBeenCalledWith(EPUB.file_key);
  });

  it('share create refuses a book with only TTS packs uploaded', async () => {
    fileRows = [MP3, JSON_];
    const res = await createShare();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'book_not_uploaded' });
  });

  it('a resolved share serves the EPUB, not a TTS pack', async () => {
    fileRows = [MP3, JSON_, EPUB];
    const result = await resolveActiveShare('a'.repeat(22));
    expect(result).toMatchObject({ ok: true, share: { bookFileKey: EPUB.file_key } });
  });
});
