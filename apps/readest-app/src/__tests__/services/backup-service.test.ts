import { describe, it, expect } from 'vitest';
import {
  mergeBookConfigs,
  mergeBookMetadata,
  reviveRestoredBooks,
  type RevivedBook,
} from '@/services/backupService';
import { Book, BookConfig, BookNote } from '@/types/book';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'abc123',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Author',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeNote(overrides: Partial<BookNote> = {}): BookNote {
  return {
    id: 'note-1',
    type: 'annotation',
    cfi: 'cfi-1',
    note: 'test note',
    createdAt: 100,
    updatedAt: 100,
    ...overrides,
  };
}

describe('mergeBookConfigs', () => {
  it('should keep higher progress from backup', () => {
    const current: BookConfig = { progress: [50, 200], updatedAt: 100 };
    const backup: BookConfig = { progress: [100, 200], updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    expect(result.progress).toEqual([100, 200]);
  });

  it('should keep higher progress from current', () => {
    const current: BookConfig = { progress: [150, 200], updatedAt: 100 };
    const backup: BookConfig = { progress: [100, 200], updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    expect(result.progress).toEqual([150, 200]);
  });

  it('should use location from the config with higher progress', () => {
    const current: BookConfig = { progress: [50, 200], location: 'loc-current', updatedAt: 100 };
    const backup: BookConfig = { progress: [100, 200], location: 'loc-backup', updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    expect(result.location).toBe('loc-backup');
  });

  it('should merge booknotes, keeping latest by updatedAt', () => {
    const note1 = makeNote({ id: '1', note: 'old', updatedAt: 100 });
    const note1Newer = makeNote({ id: '1', note: 'new', updatedAt: 200 });
    const note2 = makeNote({ id: '2', note: 'only-backup', updatedAt: 150 });

    const current: BookConfig = { booknotes: [note1], updatedAt: 100 };
    const backup: BookConfig = { booknotes: [note1Newer, note2], updatedAt: 200 };
    const result = mergeBookConfigs(current, backup);

    expect(result.booknotes).toHaveLength(2);
    expect(result.booknotes!.find((n) => n.id === '1')!.note).toBe('new');
    expect(result.booknotes!.find((n) => n.id === '2')!.note).toBe('only-backup');
  });

  it('should keep current note when updatedAt is equal', () => {
    const currentNote = makeNote({ id: '1', note: 'current', updatedAt: 100 });
    const backupNote = makeNote({ id: '1', note: 'backup', updatedAt: 100 });

    const current: BookConfig = { booknotes: [currentNote], updatedAt: 100 };
    const backup: BookConfig = { booknotes: [backupNote], updatedAt: 100 };
    const result = mergeBookConfigs(current, backup);

    expect(result.booknotes).toHaveLength(1);
    expect(result.booknotes![0]!.note).toBe('current');
  });

  it('should handle missing progress in current', () => {
    const current: BookConfig = { updatedAt: 100 };
    const backup: BookConfig = { progress: [50, 200], updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    expect(result.progress).toEqual([50, 200]);
  });

  it('should handle missing progress in backup', () => {
    const current: BookConfig = { progress: [50, 200], updatedAt: 100 };
    const backup: BookConfig = { updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    expect(result.progress).toEqual([50, 200]);
  });

  it('should handle missing booknotes in both', () => {
    const current: BookConfig = { updatedAt: 100 };
    const backup: BookConfig = { updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    expect(result.booknotes).toEqual([]);
  });

  it('should preserve viewSettings from the config with higher progress', () => {
    const current: BookConfig = {
      progress: [10, 200],
      viewSettings: { zoomLevel: 1.5 },
      updatedAt: 100,
    };
    const backup: BookConfig = {
      progress: [100, 200],
      viewSettings: { zoomLevel: 2.0 },
      updatedAt: 90,
    };
    const result = mergeBookConfigs(current, backup);
    expect(result.viewSettings?.zoomLevel).toBe(2.0);
  });

  it('should combine notes from current-only and backup-only', () => {
    const currentNote = makeNote({ id: 'c1', note: 'current-only' });
    const backupNote = makeNote({ id: 'b1', note: 'backup-only' });

    const current: BookConfig = { booknotes: [currentNote], updatedAt: 100 };
    const backup: BookConfig = { booknotes: [backupNote], updatedAt: 100 };
    const result = mergeBookConfigs(current, backup);

    expect(result.booknotes).toHaveLength(2);
    expect(result.booknotes!.find((n) => n.id === 'c1')).toBeDefined();
    expect(result.booknotes!.find((n) => n.id === 'b1')).toBeDefined();
  });
});

describe('mergeBookMetadata', () => {
  it('should not delete when current is deleted but backup is not', () => {
    const current = makeBook({ deletedAt: 5000 });
    const backup = makeBook({ deletedAt: null });
    const result = mergeBookMetadata(current, backup);
    expect(result.deletedAt).toBeNull();
  });

  it('should not delete when backup is deleted but current is not', () => {
    const current = makeBook({ deletedAt: null });
    const backup = makeBook({ deletedAt: 5000 });
    const result = mergeBookMetadata(current, backup);
    expect(result.deletedAt).toBeNull();
  });

  it('should keep later deletedAt when both sides are deleted', () => {
    const current = makeBook({ deletedAt: 3000 });
    const backup = makeBook({ deletedAt: 5000 });
    const result = mergeBookMetadata(current, backup);
    expect(result.deletedAt).toBe(5000);
  });

  it('should not delete when neither side is deleted', () => {
    const current = makeBook({ deletedAt: null });
    const backup = makeBook({ deletedAt: null });
    const result = mergeBookMetadata(current, backup);
    expect(result.deletedAt).toBeNull();
  });

  it('should set updatedAt to max of both', () => {
    const current = makeBook({ updatedAt: 2000 });
    const backup = makeBook({ updatedAt: 3000 });
    const result = mergeBookMetadata(current, backup);
    expect(result.updatedAt).toBe(3000);
  });

  it('should set createdAt to min of both', () => {
    const current = makeBook({ createdAt: 500 });
    const backup = makeBook({ createdAt: 1000 });
    const result = mergeBookMetadata(current, backup);
    expect(result.createdAt).toBe(500);
  });

  it('should use backup fields when backup has higher updatedAt', () => {
    const current = makeBook({ updatedAt: 1000, title: 'Old Title' });
    const backup = makeBook({ updatedAt: 2000, title: 'New Title' });
    const result = mergeBookMetadata(current, backup);
    expect(result.title).toBe('New Title');
  });

  it('should use current fields when current has higher updatedAt', () => {
    const current = makeBook({ updatedAt: 3000, title: 'Current Title' });
    const backup = makeBook({ updatedAt: 1000, title: 'Backup Title' });
    const result = mergeBookMetadata(current, backup);
    expect(result.title).toBe('Current Title');
  });
});

describe('reviveRestoredBooks', () => {
  // A fixed "now" well past every fixture timestamp keeps assertions deterministic.
  const NOW = 1_000_000_000_000;

  /** Pair a freshly-merged live record with its backup metadata. */
  function makeRevived(
    bookOverrides: Partial<Book> = {},
    backupOverrides: Partial<Book> = {},
  ): RevivedBook {
    return {
      book: makeBook({ deletedAt: null, downloadedAt: null, ...bookOverrides }),
      backup: makeBook(backupOverrides),
    };
  }

  it('does nothing for an empty list', () => {
    expect(() => reviveRestoredBooks([], NOW)).not.toThrow();
  });

  it('preserves the relative updatedAt order of revived books', () => {
    const revived = [
      makeRevived({ hash: 'a', updatedAt: 100 }),
      makeRevived({ hash: 'b', updatedAt: 300 }),
      makeRevived({ hash: 'c', updatedAt: 200 }),
    ];
    reviveRestoredBooks(revived, NOW);
    const byHash = (h: string) => revived.find((r) => r.book.hash === h)!.book.updatedAt;
    // Original ascending order a < c < b must still hold.
    expect(byHash('a')).toBeLessThan(byHash('c'));
    expect(byHash('c')).toBeLessThan(byHash('b'));
  });

  it('bumps every book strictly above its original (and cloud) timestamp', () => {
    const revived = [
      makeRevived({ hash: 'a', updatedAt: 100 }),
      makeRevived({ hash: 'b', updatedAt: 300 }),
    ];
    reviveRestoredBooks(revived, NOW);
    expect(revived[0]!.book.updatedAt).toBeGreaterThan(100);
    expect(revived[1]!.book.updatedAt).toBeGreaterThan(300);
  });

  it('maps the newest revived book to exactly now', () => {
    const revived = [
      makeRevived({ hash: 'a', updatedAt: 100 }),
      makeRevived({ hash: 'b', updatedAt: 300 }),
    ];
    reviveRestoredBooks(revived, NOW);
    expect(Math.max(revived[0]!.book.updatedAt, revived[1]!.book.updatedAt)).toBe(NOW);
  });

  it('keeps the exact gap between books (single uniform offset)', () => {
    const revived = [
      makeRevived({ hash: 'a', updatedAt: 1000 }),
      makeRevived({ hash: 'b', updatedAt: 1500 }),
    ];
    reviveRestoredBooks(revived, NOW);
    expect(revived[1]!.book.updatedAt - revived[0]!.book.updatedAt).toBe(500);
  });

  it('still bumps by at least 1 when a book has a future timestamp', () => {
    const future = NOW + 5000;
    const revived = [makeRevived({ hash: 'a', updatedAt: future })];
    reviveRestoredBooks(revived, NOW);
    expect(revived[0]!.book.updatedAt).toBe(future + 1);
  });

  it('clears syncedAt so the next push re-uploads the book', () => {
    const revived = [makeRevived({ hash: 'a', updatedAt: 100, syncedAt: 999 })];
    reviveRestoredBooks(revived, NOW);
    expect(revived[0]!.book.syncedAt).toBeNull();
  });

  it('restores download state from the backup record', () => {
    const revived = [
      makeRevived(
        { hash: 'a', updatedAt: 100, downloadedAt: null, coverDownloadedAt: null },
        { downloadedAt: 555, coverDownloadedAt: 666 },
      ),
    ];
    reviveRestoredBooks(revived, NOW);
    expect(revived[0]!.book.downloadedAt).toBe(555);
    expect(revived[0]!.book.coverDownloadedAt).toBe(666);
  });

  it('falls back to now when the backup record has no download state', () => {
    const revived = [
      makeRevived(
        { hash: 'a', updatedAt: 100, downloadedAt: null, coverDownloadedAt: null },
        { downloadedAt: null, coverDownloadedAt: null },
      ),
    ];
    reviveRestoredBooks(revived, NOW);
    expect(revived[0]!.book.downloadedAt).toBe(NOW);
    expect(revived[0]!.book.coverDownloadedAt).toBe(NOW);
  });
});
