import { describe, it, expect } from 'vitest';
import { TrackerCore } from '@/services/statistics/trackerCore';
import { DEFAULT_STATS_TRACKING_CONFIG } from '@/types/statistics';

const cfg = DEFAULT_STATS_TRACKING_CONFIG;

describe('TrackerCore', () => {
  it('emits an event when the page changes', () => {
    const t = new TrackerCore(cfg);
    expect(t.onPage(5, 100, 1000)).toEqual([]); // first page, nothing to flush yet
    const out = t.onPage(6, 100, 1030); // moved off page 5 after 30s
    expect(out).toEqual([{ page: 5, startTime: 1000, duration: 30, totalPages: 100 }]);
  });

  it('caps duration at maxEventSeconds', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 0);
    const out = t.onPage(2, 10, 10_000); // way over the 120s cap
    expect(out[0]!.duration).toBe(cfg.maxEventSeconds);
  });

  it('drops sub-minimum events', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 0);
    expect(t.onPage(2, 10, 1)).toEqual([]); // 1s < minEventSeconds (3)
  });

  it('flushes and pauses on idle, then resumes with a new start_time', () => {
    const t = new TrackerCore(cfg);
    t.onPage(1, 10, 0);
    expect(t.onIdle(50)).toEqual([{ page: 1, startTime: 0, duration: 50, totalPages: 10 }]);
    // After idle, the same page resumes as a fresh event.
    expect(t.onPage(1, 10, 200)).toEqual([]); // resume marker, no flush
    expect(t.onPage(2, 10, 230)).toEqual([
      { page: 1, startTime: 200, duration: 30, totalPages: 10 },
    ]);
  });

  it('flushes on hide and on close without double-counting', () => {
    const t = new TrackerCore(cfg);
    t.onPage(7, 10, 0);
    expect(t.onHide(40)).toEqual([{ page: 7, startTime: 0, duration: 40, totalPages: 10 }]);
    expect(t.onClose(99)).toEqual([]); // already flushed + paused by hide
  });
});
