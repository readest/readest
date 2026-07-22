import { describe, expect, test } from 'vitest';
import { countSyncedRecords } from '@/hooks/useSync';
import type { BookDataRecord } from '@/types/book';

const rec = (over: Partial<BookDataRecord>): BookDataRecord => ({
  id: 'id',
  book_hash: 'hash',
  user_id: 'user',
  updated_at: 1,
  deleted_at: null,
  ...over,
});

describe('countSyncedRecords', () => {
  test('counts only uploaded, non-deleted books', () => {
    const records: BookDataRecord[] = [
      rec({ book_hash: 'a', uploaded_at: '2024-01-01' }), // uploaded → counted
      rec({ book_hash: 'b', uploaded_at: null }), // metadata-only → skipped
      rec({ book_hash: 'c', uploaded_at: undefined }), // metadata-only → skipped
      rec({ book_hash: 'd', uploaded_at: '2024-01-02', deleted_at: 123 }), // deleted → skipped
    ];
    expect(countSyncedRecords('books', records)).toBe(1);
  });

  test('does not require an upload state for non-book records', () => {
    // configs/notes have no upload concept; count every live (non-deleted) record.
    const records: BookDataRecord[] = [
      rec({ book_hash: 'a' }),
      rec({ book_hash: 'b', deleted_at: 5 }),
    ];
    expect(countSyncedRecords('configs', records)).toBe(1);
    expect(countSyncedRecords('notes', records)).toBe(1);
  });

  test('returns 0 for empty, null, or undefined records', () => {
    expect(countSyncedRecords('books', [])).toBe(0);
    expect(countSyncedRecords('books', null)).toBe(0);
    expect(countSyncedRecords('books', undefined)).toBe(0);
  });
});
