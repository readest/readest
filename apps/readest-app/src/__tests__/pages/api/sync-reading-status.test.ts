import { describe, expect, it } from 'vitest';
import { readingStatusChanged, resolveReadingStatusMerge } from '@/pages/api/sync';

const iso = (ms: number) => new Date(ms).toISOString();

describe('readingStatusChanged', () => {
  // The bug: a locally-imported book the client never gave a status to sends
  // `reading_status: undefined`, while the server row stores `null`. Comparing
  // them with `!==` reports a spurious change, so the server rewrites
  // `updated_at = now()` on every push and the book floats to the top of the
  // date-sorted library after every sync.
  it('treats client undefined and server null as the same (no change)', () => {
    expect(readingStatusChanged(undefined, null)).toBe(false);
    expect(readingStatusChanged(null, undefined)).toBe(false);
    expect(readingStatusChanged(null, null)).toBe(false);
    expect(readingStatusChanged(undefined, undefined)).toBe(false);
  });

  it('reports a real status change', () => {
    expect(readingStatusChanged('finished', null)).toBe(true);
    expect(readingStatusChanged(undefined, 'reading')).toBe(true);
    expect(readingStatusChanged('reading', 'finished')).toBe(true);
  });

  it('reports no change when both sides hold the same status', () => {
    expect(readingStatusChanged('finished', 'finished')).toBe(false);
  });
});

describe('resolveReadingStatusMerge', () => {
  it('keeps the client status when its status timestamp is newer', () => {
    const out = resolveReadingStatusMerge(
      { reading_status: 'finished', reading_status_updated_at: iso(200) },
      { reading_status: 'reading', reading_status_updated_at: iso(100) },
    );
    expect(out).toEqual({ reading_status: 'finished', reading_status_updated_at: iso(200) });
  });

  it('keeps the server status when its status timestamp is newer', () => {
    const out = resolveReadingStatusMerge(
      { reading_status: 'reading', reading_status_updated_at: iso(100) },
      { reading_status: 'finished', reading_status_updated_at: iso(300) },
    );
    expect(out).toEqual({ reading_status: 'finished', reading_status_updated_at: iso(300) });
  });

  it('treats a missing timestamp as oldest (server wins over an unstamped client)', () => {
    const out = resolveReadingStatusMerge(
      { reading_status: undefined, reading_status_updated_at: undefined },
      { reading_status: 'abandoned', reading_status_updated_at: iso(1) },
    );
    expect(out).toEqual({ reading_status: 'abandoned', reading_status_updated_at: iso(1) });
  });
});
