import type { TranslationFunc } from '@/hooks/useTranslation';
import type { SyncLibraryResult } from './engine';

/** A null message means every requested operation completed successfully. */
export const formatSyncFailure = (result: SyncLibraryResult, _: TranslationFunc): string | null => {
  if (!result.failures && !result.indexPushFailed) return null;
  return [
    result.failures > 0 &&
      _('Sync finished with {{failed}} failure(s). {{ok}} ok.', {
        failed: result.failures,
        ok: Math.max(0, result.totalBooks - result.failures),
      }),
    result.indexPushFailed && _('Failed to upload the library index. Please sync again.'),
    ...result.failedBooks.map((book) => `${book.title || book.hash}: ${book.reason}`),
  ]
    .filter(Boolean)
    .join('\n');
};
