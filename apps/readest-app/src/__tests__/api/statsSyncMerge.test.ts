import { describe, it, expect } from 'vitest';
import { pickWinningPages } from '@/pages/api/sync';
import type { StatPageRecord } from '@/libs/sync';

const mk = (start: number, duration: number): StatPageRecord => ({
  book_hash: 'm',
  page: 1,
  start_time: start,
  duration,
  total_pages: 10,
});

describe('pickWinningPages', () => {
  it('inserts pages the server has not seen', () => {
    const { toUpsert } = pickWinningPages([mk(100, 5)], new Map());
    expect(toUpsert).toHaveLength(1);
  });

  it('keeps the longer duration on conflict', () => {
    const server = new Map([['m|1|100', mk(100, 5)]]);
    const win = pickWinningPages([mk(100, 9)], server);
    expect(win.toUpsert[0]!.duration).toBe(9);
  });

  it('drops an incoming page whose duration is not longer', () => {
    const server = new Map([['m|1|100', mk(100, 9)]]);
    const win = pickWinningPages([mk(100, 5)], server);
    expect(win.toUpsert).toHaveLength(0);
  });
});
