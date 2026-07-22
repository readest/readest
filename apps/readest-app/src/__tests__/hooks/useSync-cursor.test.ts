import { describe, expect, it } from 'vitest';
import { computeMaxTimestamp } from '@/hooks/useSync';
import type { BookDataRecord } from '@/types/book';

const iso = (ms: number) => new Date(ms).toISOString();

// Issue #4678: the incremental-pull cursor is decoupled from updated_at. The
// server stamps a `synced_at` on every books write, so the client watermark
// keys on synced_at and ignores updated_at (the client event time / sort key)
// and deleted_at (a delete bumps synced_at too).
describe('computeMaxTimestamp (synced_at pull cursor)', () => {
  it('keys on synced_at, ignoring updated_at and deleted_at', () => {
    const max = computeMaxTimestamp([
      { synced_at: iso(5000), updated_at: iso(1000), deleted_at: null },
      { synced_at: iso(3000), updated_at: iso(9999), deleted_at: iso(8000) },
    ] as unknown as BookDataRecord[]);
    expect(max).toBe(5000);
  });

  it('falls back to updated_at/deleted_at when synced_at is absent (old server)', () => {
    const max = computeMaxTimestamp([
      { updated_at: iso(1000), deleted_at: iso(4000) },
      { updated_at: iso(2000), deleted_at: null },
    ] as unknown as BookDataRecord[]);
    expect(max).toBe(4000);
  });

  it('returns 0 for empty input', () => {
    expect(computeMaxTimestamp([])).toBe(0);
  });
});
