import { describe, expect, it } from 'vitest';
import { resolvePageCountMerge } from '@/pages/api/sync';

describe('resolvePageCountMerge', () => {
  it('takes the row winner’s page count', () => {
    expect(resolvePageCountMerge({ page_count: 120 }, { page_count: 118 }, true)).toBe(120);
    expect(resolvePageCountMerge({ page_count: 120 }, { page_count: 118 }, false)).toBe(118);
  });

  it('never lets a row without a count erase one', () => {
    // An old client, the KOReader or Calibre plugin, or a device that never
    // counted the book pushes no page_count.
    expect(resolvePageCountMerge({ page_count: null }, { page_count: 118 }, true)).toBe(118);
    expect(resolvePageCountMerge({}, { page_count: 118 }, true)).toBe(118);
  });

  it('fills in a count the server does not have yet, even when the server wins the row', () => {
    expect(resolvePageCountMerge({ page_count: 120 }, { page_count: null }, false)).toBe(120);
  });

  it('is null when neither side has one', () => {
    expect(resolvePageCountMerge({}, {}, true)).toBeNull();
  });
});
