import { describe, expect, it } from 'vitest';
import { IN_CHUNK_SIZE, MAX_PAGE_SIZE, chunkIds, resolvePageSize } from '@/pages/api/storage/list';

// The listing costs roughly a second per request almost regardless of how many
// rows come back, so a client walking the whole account (the calibre plugin)
// pays per page. Raising the cap collapses ~16 requests into 2.
describe('resolvePageSize', () => {
  it('defaults to 50 when absent or unparseable', () => {
    expect(resolvePageSize(undefined)).toBe(50);
    expect(resolvePageSize('')).toBe(50);
    expect(resolvePageSize('abc')).toBe(50);
  });

  it('honours a requested size up to the cap', () => {
    expect(resolvePageSize('20')).toBe(20);
    expect(resolvePageSize(String(MAX_PAGE_SIZE))).toBe(MAX_PAGE_SIZE);
  });

  it('clamps anything above the cap', () => {
    expect(resolvePageSize('5000')).toBe(MAX_PAGE_SIZE);
  });

  it('never returns a range-breaking size', () => {
    expect(resolvePageSize('0')).toBe(50); // 0 is falsy, so it falls back
    expect(resolvePageSize('-5')).toBe(1);
  });
});

// Supabase renders `.in()` into the request's query string. A full page of
// book hashes at the raised cap would be tens of kilobytes of URL, which
// PostgREST rejects, so the group expansion has to go out in batches.
describe('chunkIds', () => {
  it('splits into batches no larger than the limit', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const batches = chunkIds(ids);
    expect(batches.every((batch) => batch.length <= IN_CHUNK_SIZE)).toBe(true);
    expect(batches).toHaveLength(3);
  });

  it('keeps every id exactly once and in order', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    expect(chunkIds(ids).flat()).toEqual(ids);
  });

  it('returns nothing for an empty list', () => {
    expect(chunkIds([])).toEqual([]);
  });

  it('does not emit a trailing empty batch on an exact multiple', () => {
    const ids = Array.from({ length: IN_CHUNK_SIZE * 2 }, (_, i) => `id-${i}`);
    expect(chunkIds(ids)).toHaveLength(2);
  });

  it('keeps a batch of 32-char hashes well inside a safe URL length', () => {
    const hashes = Array.from({ length: IN_CHUNK_SIZE }, () => 'a'.repeat(32));
    // `book_hash=in.("h1","h2",...)` — roughly 36 chars per quoted, encoded id.
    expect(chunkIds(hashes)[0]!.join(',').length * 1.2).toBeLessThan(8000);
  });
});
