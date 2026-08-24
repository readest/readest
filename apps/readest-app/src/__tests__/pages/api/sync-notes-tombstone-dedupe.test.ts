import { describe, expect, it } from 'vitest';
import { dedupeLatest } from '@/pages/api/sync';

const iso = (ms: number) => new Date(ms).toISOString();

// Issue #5818: a highlight deleted in KOReader never disappeared in Readest.
// The same note can exist as two book_notes rows when the two apps hold
// different copies of the book (meta_hash bridges the book_hash mismatch):
// KOReader's row under its hash and Readest's re-pushed copy under its own.
// KOReader's tombstone keeps the highlight's original updated_at, so the
// pull's id-dedupe, ranked on updated_at alone, kept the live duplicate and
// dropped the deletion.
describe('dedupeLatest', () => {
  it('keeps the tombstone over a live duplicate with a newer updated_at', () => {
    const live = { book_hash: 'r', id: 'n1', updated_at: iso(3000), deleted_at: null };
    const tombstone = { book_hash: 'k', id: 'n1', updated_at: iso(1000), deleted_at: iso(5000) };
    expect(dedupeLatest([live, tombstone], ['id'])).toEqual([tombstone]);
  });

  it('keeps a live duplicate edited after the deletion', () => {
    const live = { book_hash: 'r', id: 'n1', updated_at: iso(6000), deleted_at: null };
    const tombstone = { book_hash: 'k', id: 'n1', updated_at: iso(1000), deleted_at: iso(5000) };
    expect(dedupeLatest([live, tombstone], ['id'])).toEqual([live]);
  });

  it('gives an exact tie to the tombstone', () => {
    const live = { book_hash: 'r', id: 'n1', updated_at: iso(5000), deleted_at: null };
    const tombstone = { book_hash: 'k', id: 'n1', updated_at: iso(1000), deleted_at: iso(5000) };
    expect(dedupeLatest([live, tombstone], ['id'])).toEqual([tombstone]);
  });

  it('preserves the input order of the surviving rows', () => {
    const a = { book_hash: 'k', id: 'a', updated_at: iso(1000), deleted_at: null };
    const b = { book_hash: 'k', id: 'b', updated_at: iso(3000), deleted_at: null };
    const bDup = { book_hash: 'r', id: 'b', updated_at: iso(2000), deleted_at: null };
    const c = { book_hash: 'k', id: 'c', updated_at: iso(2000), deleted_at: null };
    expect(dedupeLatest([a, b, bDup, c], ['id'])).toEqual([a, b, c]);
  });

  it('keeps the newest live row when neither duplicate is deleted', () => {
    const older = { book_hash: 'k', id: 'n1', updated_at: iso(1000), deleted_at: null };
    const newer = { book_hash: 'r', id: 'n1', updated_at: iso(3000), deleted_at: null };
    expect(dedupeLatest([older, newer], ['id'])).toEqual([newer]);
  });

  it('keeps every row with a distinct key', () => {
    const a = { book_hash: 'k', id: 'n1', updated_at: iso(1000), deleted_at: null };
    const b = { book_hash: 'k', id: 'n2', updated_at: iso(1000), deleted_at: iso(2000) };
    expect(dedupeLatest([a, b], ['id'])).toHaveLength(2);
  });

  it('never collapses rows that have no key', () => {
    const a = { book_hash: 'k', id: '', updated_at: iso(1000), deleted_at: null };
    const b = { book_hash: 'r', id: '', updated_at: iso(1000), deleted_at: null };
    expect(dedupeLatest([a, b], ['id'])).toHaveLength(2);
  });
});
