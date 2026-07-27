import { describe, expect, it } from 'vitest';
import { pullBooksPaged } from '@/hooks/useSync';
import type { BookDataRecord } from '@/types/book';

const iso = (ms: number) => new Date(ms).toISOString();
const row = (hash: string, syncedMs: number) =>
  ({ book_hash: hash, synced_at: iso(syncedMs) }) as unknown as BookDataRecord;

// The books delta is pulled in bounded pages: a delta grown to a 10k-book
// library in one response exceeded Cloudflare Worker limits (error 1102) and
// wedged the device — the pull failed forever and the cursor never advanced.
// The server orders pages by synced_at ascending with tie-completion; the
// client advances its cursor to the newest row seen and persists it per page
// so an interrupted initial sync resumes instead of restarting.
describe('pullBooksPaged', () => {
  it('walks pages until a short page, advancing the since cursor', async () => {
    const calls: Array<{ since: number; limit: number }> = [];
    const pages = [
      [row('a', 1000), row('b', 2000)],
      [row('c', 3000), row('d', 4000)],
      [row('e', 5000)],
    ];
    const records = await pullBooksPaged(
      async (since, limit) => {
        calls.push({ since, limit });
        return pages.shift() ?? [];
      },
      0,
      undefined,
      2,
    );

    expect(records.map((r) => r.book_hash)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(calls).toEqual([
      { since: 0, limit: 2 },
      { since: 2000, limit: 2 },
      { since: 4000, limit: 2 },
    ]);
  });

  it('keeps the newest occurrence of a row re-read at the cursor boundary', async () => {
    const pages = [
      [row('a', 1000), row('b', 2000)],
      [{ ...row('b', 2500), title: 'newer' } as unknown as BookDataRecord],
    ];
    const records = await pullBooksPaged(async () => pages.shift() ?? [], 0, undefined, 2);

    expect(records).toHaveLength(2);
    expect((records.find((r) => r.book_hash === 'b') as { title?: string }).title).toBe('newer');
  });

  it('reports the advancing cursor after each page for persistence', async () => {
    const cursors: number[] = [];
    const pages = [[row('a', 1000), row('b', 2000)], [row('c', 3000)]];
    await pullBooksPaged(
      async () => pages.shift() ?? [],
      0,
      (cursor) => cursors.push(cursor),
      2,
    );

    expect(cursors).toEqual([2000, 3000]);
  });

  it('terminates when a full page cannot advance the cursor (boundary ties)', async () => {
    let calls = 0;
    const records = await pullBooksPaged(
      async () => {
        calls++;
        return [row('a', 500), row('b', 500)];
      },
      500,
      undefined,
      2,
    );

    expect(calls).toBe(1);
    expect(records).toHaveLength(2);
  });

  it('keeps the pages already pulled when a later page fails, matching the persisted cursor', async () => {
    // The cursor is persisted per page; discarding pulled pages on a later
    // failure would advance the cursor past rows that were never delivered.
    const cursors: number[] = [];
    const pages = [[row('a', 1000), row('b', 2000)]];
    const records = await pullBooksPaged(
      async () => {
        const page = pages.shift();
        if (!page) throw new Error('network down');
        return page;
      },
      0,
      (cursor) => cursors.push(cursor),
      2,
    );

    expect(records.map((r) => r.book_hash)).toEqual(['a', 'b']);
    expect(cursors).toEqual([2000]);
  });

  it('rethrows when the first page fails (nothing accumulated)', async () => {
    await expect(
      pullBooksPaged(
        async () => {
          throw new Error('Not authenticated');
        },
        0,
        undefined,
        2,
      ),
    ).rejects.toThrow('Not authenticated');
  });

  it('handles a server that ignores limit and returns the whole delta', async () => {
    const pages: BookDataRecord[][] = [[row('a', 1000), row('b', 2000), row('c', 3000)], []];
    const calls: number[] = [];
    const records = await pullBooksPaged(
      async (since) => {
        calls.push(since);
        return pages.shift() ?? [];
      },
      0,
      undefined,
      2,
    );

    expect(records).toHaveLength(3);
    expect(calls).toEqual([0, 3000]);
  });
});
