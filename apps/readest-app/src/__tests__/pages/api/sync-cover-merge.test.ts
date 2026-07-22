import { describe, expect, it } from 'vitest';
import { resolveCoverMerge } from '@/pages/api/sync';

const iso = (ms: number) => new Date(ms).toISOString();

describe('resolveCoverMerge (issue #4544)', () => {
  it('keeps the client cover when its cover_updated_at is newer', () => {
    const out = resolveCoverMerge(
      { cover_hash: 'newhash', cover_updated_at: iso(200) },
      { cover_hash: 'oldhash', cover_updated_at: iso(100) },
    );
    expect(out).toEqual({ cover_hash: 'newhash', cover_updated_at: iso(200) });
  });

  it('keeps the server cover when its cover_updated_at is newer', () => {
    const out = resolveCoverMerge(
      { cover_hash: 'clienthash', cover_updated_at: iso(100) },
      { cover_hash: 'serverhash', cover_updated_at: iso(300) },
    );
    expect(out).toEqual({ cover_hash: 'serverhash', cover_updated_at: iso(300) });
  });

  it('ties go to the client', () => {
    const out = resolveCoverMerge(
      { cover_hash: 'clienthash', cover_updated_at: iso(150) },
      { cover_hash: 'serverhash', cover_updated_at: iso(150) },
    );
    expect(out).toEqual({ cover_hash: 'clienthash', cover_updated_at: iso(150) });
  });

  it('treats a missing/null timestamp as oldest', () => {
    // Server has a real cover edit; an unstamped client (legacy / page-turn
    // push carrying no cover_updated_at) must not win and clobber it.
    const out = resolveCoverMerge(
      { cover_hash: 'staleclient', cover_updated_at: null },
      { cover_hash: 'realserver', cover_updated_at: iso(1) },
    );
    expect(out).toEqual({ cover_hash: 'realserver', cover_updated_at: iso(1) });
  });

  it('both unset → null cover (no spurious change)', () => {
    const out = resolveCoverMerge(
      { cover_hash: null, cover_updated_at: null },
      { cover_hash: null, cover_updated_at: null },
    );
    expect(out).toEqual({ cover_hash: null, cover_updated_at: null });
  });
});
