import { describe, expect, it } from 'vitest';
import { buildStatusPropagationRow } from '@/pages/api/sync';
import type { DBBook } from '@/types/records';

const iso = (ms: number) => new Date(ms).toISOString();

// Issue #4678: when the server wins a books row but the client's reading_status
// is newer, the change must still reach every peer. It used to be propagated by
// rewriting `updated_at = now()`, which reordered the date-read library by
// sync-processing time (#4677). Now the `synced_at` trigger advances the pull
// cursor on the write, so the propagation row keeps `updated_at` untouched.
describe('buildStatusPropagationRow', () => {
  const serverBook = {
    user_id: 'u',
    book_hash: 'h',
    format: 'EPUB',
    title: 'T',
    author: 'A',
    updated_at: iso(1000),
    reading_status: 'reading',
    reading_status_updated_at: iso(500),
  } as unknown as DBBook;

  const fresherStatus = {
    reading_status: 'finished',
    reading_status_updated_at: iso(2000),
  };

  it('grafts the fresher status onto the server row', () => {
    const row = buildStatusPropagationRow(serverBook, fresherStatus);
    expect(row.reading_status).toBe('finished');
    expect(row.reading_status_updated_at).toBe(iso(2000));
  });

  it('leaves updated_at untouched so the date-read sort never jumps to sync time', () => {
    const row = buildStatusPropagationRow(serverBook, fresherStatus);
    expect(row.updated_at).toBe(serverBook.updated_at);
  });

  it('preserves the rest of the server row', () => {
    const row = buildStatusPropagationRow(serverBook, fresherStatus);
    expect(row.book_hash).toBe('h');
    expect(row.title).toBe('T');
    expect(row.format).toBe('EPUB');
  });
});
