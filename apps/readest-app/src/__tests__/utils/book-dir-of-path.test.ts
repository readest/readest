import { describe, expect, it } from 'vitest';

import { getBookDirOfPath } from '@/utils/book';

const HASH = '6afdd0136531fbe028e0503a14ba234c';

describe('getBookDirOfPath (#5837)', () => {
  it('returns undefined for root-level library metadata', () => {
    expect(getBookDirOfPath('library.json')).toBeUndefined();
    expect(getBookDirOfPath('library.db-wal')).toBeUndefined();
    expect(getBookDirOfPath('')).toBeUndefined();
  });

  it('returns the hash dir of a POSIX path', () => {
    expect(getBookDirOfPath(`${HASH}/book.epub`)).toBe(HASH);
  });

  it('returns the hash dir of a Windows backslash path', () => {
    expect(getBookDirOfPath(`${HASH}\\cover.png`)).toBe(HASH);
  });

  it('returns only the first segment of a nested path', () => {
    expect(getBookDirOfPath(`${HASH}/fonts/serif.ttf`)).toBe(HASH);
    expect(getBookDirOfPath(`${HASH}\\fonts\\serif.ttf`)).toBe(HASH);
  });
});
