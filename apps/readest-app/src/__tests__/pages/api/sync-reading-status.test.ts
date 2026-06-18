import { describe, expect, it } from 'vitest';
import { resolveReadingStatusMerge } from '@/pages/api/sync';

const iso = (ms: number) => new Date(ms).toISOString();

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
    expect(out.reading_status).toBe('abandoned');
  });
});
