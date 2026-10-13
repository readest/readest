import { describe, expect, it } from 'vitest';
import { nextBooknoteStamp } from '@/utils/booknoteStamp';
import { BookNote } from '@/types/book';

const note = (updatedAt: number, deletedAt?: number): BookNote => ({
  id: 'n1',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
  note: '',
  createdAt: 1000,
  updatedAt,
  deletedAt,
});

describe('nextBooknoteStamp', () => {
  it('uses the device time when it is ahead of the record', () => {
    expect(nextBooknoteStamp(note(1000), 5000)).toBe(5000);
  });

  // A synced record can carry a server stamp ahead of a lagging device clock;
  // a change stamped with that clock would sort before the version it changes
  // and lose to it in sync (#6544).
  it('sorts after the record when the device clock lags behind it', () => {
    expect(nextBooknoteStamp(note(9000), 5000)).toBe(9001);
  });

  // Restoring a deleted record (a bookmark toggled back on) changes it after
  // its deletion, so the restore must outrank the tombstone.
  it('sorts after a deletion that is ahead of the device clock', () => {
    expect(nextBooknoteStamp(note(1000, 9000), 5000)).toBe(9001);
  });
});
