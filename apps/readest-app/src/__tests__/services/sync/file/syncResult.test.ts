import { expect, test } from 'vitest';
import { formatSyncFailure } from '@/services/sync/file/syncResult';
import type { SyncLibraryResult } from '@/services/sync/file/engine';

test('does not count a book whose config succeeded but file failed as ok', () => {
  const result = {
    totalBooks: 3,
    booksSynced: 3,
    failures: 1,
    failedBooks: [],
    indexPushFailed: false,
  } as unknown as SyncLibraryResult;
  const message = formatSyncFailure(result, (key, params) =>
    Object.entries(params ?? {}).reduce(
      (s, [key, value]) => s.replace(`{{${key}}}`, String(value)),
      key,
    ),
  );
  expect(message).toBe('Sync finished with 1 failure(s). 2 ok.');
});
