import { describe, it, expect } from 'vitest';
import {
  mergeBookConfigs,
  mergeBookMetadata,
  validateBackupStructure,
} from '@/services/backupService';
import { Book, BookConfig, BookNote } from '@/types/book';

/**
 * Extended tests for backupService covering:
 * - validateBackupStructure
 * - mergeBookConfigs edge cases (empty configs, no booknotes, notes with zero/undefined updatedAt)
 * - mergeBookMetadata edge cases (equal timestamps, undefined deletedAt)
 */

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

describe('validateBackupStructure', () => {
  it('should return true when library.json is present', () => {
    expect(validateBackupStructure(['library.json', 'abc123/book.epub'])).toBe(true);
  });

  it('should return false when library.json is missing', () => {
    expect(validateBackupStructure(['abc123/book.epub', 'abc123/config.json'])).toBe(false);
  });

  it('should return false for empty entries', () => {
    expect(validateBackupStructure([])).toBe(false);
  });

  it('should not match partial names like library.json.bak', () => {
    expect(validateBackupStructure(['library.json.bak'])).toBe(false);
  });

  it('should not match subdirectory library.json', () => {
    // Only exact match counts; 'subdir/library.json' !== 'library.json'
    expect(validateBackupStructure(['subdir/library.json'])).toBe(false);
  });

  it('should return true even with many other entries', () => {
    const entries = Array.from({ length: 100 }, (_, i) => `hash${i}/book.epub`);
    entries.push('library.json');
    expect(validateBackupStructure(entries)).toBe(true);
  });
});

describe('mergeBookConfigs - extended', () => {
  it('should handle both configs having zero progress', () => {
    const current: BookConfig = { progress: [0, 200], updatedAt: 100 };
    const backup: BookConfig = { progress: [0, 200], updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    // When progress is equal (both 0), current wins (backupPage > currentPage is false)
    expect(result.progress).toEqual([0, 200]);
  });

  it('should handle configs with no progress at all', () => {
    const current: Partial<BookConfig> = { updatedAt: 100 };
    const backup: Partial<BookConfig> = { updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    // Both progress[0] default to 0, so current wins
    expect(result.booknotes).toEqual([]);
  });

  it('should merge notes from current when backup has none', () => {
    const note = makeNote({ id: 'c1', note: 'current-only' });
    const current: BookConfig = { booknotes: [note], updatedAt: 100 };
    const backup: BookConfig = { updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    expect(result.booknotes).toHaveLength(1);
    expect(result.booknotes![0]!.id).toBe('c1');
  });

  it('should merge notes from backup when current has none', () => {
    const note = makeNote({ id: 'b1', note: 'backup-only' });
    const current: BookConfig = { updatedAt: 100 };
    const backup: BookConfig = { booknotes: [note], updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    expect(result.booknotes).toHaveLength(1);
    expect(result.booknotes![0]!.id).toBe('b1');
  });

  it('should handle notes with updatedAt of 0', () => {
    const currentNote = makeNote({ id: '1', note: 'current', updatedAt: 0 });
    const backupNote = makeNote({ id: '1', note: 'backup', updatedAt: 0 });
    const current: BookConfig = { booknotes: [currentNote], updatedAt: 100 };
    const backup: BookConfig = { booknotes: [backupNote], updatedAt: 100 };
    const result = mergeBookConfigs(current, backup);
    // When both are 0, backup note doesn't win ((0 || 0) > (0 || 0) is false)
    expect(result.booknotes).toHaveLength(1);
    expect(result.booknotes![0]!.note).toBe('current');
  });

  it('should handle notes with undefined updatedAt (treated as 0)', () => {
    const currentNote = makeNote({
      id: '1',
      note: 'current',
      updatedAt: undefined as unknown as number,
    });
    const backupNote = makeNote({ id: '1', note: 'backup', updatedAt: 50 });
    const current: BookConfig = { booknotes: [currentNote], updatedAt: 100 };
    const backup: BookConfig = { booknotes: [backupNote], updatedAt: 100 };
    const result = mergeBookConfigs(current, backup);
    // Backup note has updatedAt 50, current has undefined (treated as 0)
    // (50 || 0) > (undefined || 0) => 50 > 0 => true, backup wins
    expect(result.booknotes).toHaveLength(1);
    expect(result.booknotes![0]!.note).toBe('backup');
  });

  it('should merge many notes from both sides without duplicates', () => {
    const currentNotes = Array.from({ length: 5 }, (_, i) =>
      makeNote({ id: `note-${i}`, note: `current-${i}`, updatedAt: 100 }),
    );
    const backupNotes = Array.from({ length: 5 }, (_, i) =>
      makeNote({ id: `note-${i + 3}`, note: `backup-${i + 3}`, updatedAt: 200 }),
    );
    // Overlapping ids: note-3, note-4 (exist in both)
    const current: BookConfig = { booknotes: currentNotes, updatedAt: 100 };
    const backup: BookConfig = { booknotes: backupNotes, updatedAt: 100 };
    const result = mergeBookConfigs(current, backup);

    // Total unique ids: note-0..note-7 = 8
    expect(result.booknotes).toHaveLength(8);

    // Overlapping notes should use backup version (higher updatedAt)
    const note3 = result.booknotes!.find((n) => n.id === 'note-3');
    expect(note3!.note).toBe('backup-3');
    const note4 = result.booknotes!.find((n) => n.id === 'note-4');
    expect(note4!.note).toBe('backup-4');

    // Non-overlapping from current should be preserved
    const note0 = result.booknotes!.find((n) => n.id === 'note-0');
    expect(note0!.note).toBe('current-0');
  });

  it('should preserve location from config with higher progress', () => {
    const current: BookConfig = { progress: [10, 200], location: 'loc-A', updatedAt: 100 };
    const backup: BookConfig = { progress: [20, 200], location: 'loc-B', updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    expect(result.location).toBe('loc-B'); // backup has higher progress
  });

  it('should preserve location from current when current has higher progress', () => {
    const current: BookConfig = { progress: [30, 200], location: 'loc-A', updatedAt: 100 };
    const backup: BookConfig = { progress: [20, 200], location: 'loc-B', updatedAt: 90 };
    const result = mergeBookConfigs(current, backup);
    expect(result.location).toBe('loc-A');
  });

  it('should not mutate the original configs', () => {
    const currentNote = makeNote({ id: '1', note: 'original' });
    const current: BookConfig = { booknotes: [currentNote], progress: [10, 200], updatedAt: 100 };
    const backup: BookConfig = { progress: [20, 200], updatedAt: 90 };
    const currentCopy = JSON.parse(JSON.stringify(current)) as BookConfig;
    const backupCopy = JSON.parse(JSON.stringify(backup)) as BookConfig;

    mergeBookConfigs(current, backup);

    // Original objects should not be mutated
    expect(current.booknotes).toHaveLength(1);
    expect(JSON.stringify(current)).toBe(JSON.stringify(currentCopy));
    expect(JSON.stringify(backup)).toBe(JSON.stringify(backupCopy));
  });
});

describe('mergeBookMetadata - extended', () => {
  it('should handle equal updatedAt timestamps', () => {
    const current = makeBook({ updatedAt: 2000, title: 'Current Title' });
    const backup = makeBook({ updatedAt: 2000, title: 'Backup Title' });
    const result = mergeBookMetadata(current, backup);
    // When equal, backup.updatedAt > current.updatedAt is false, so current wins
    expect(result.title).toBe('Current Title');
    expect(result.updatedAt).toBe(2000);
  });

  it('should handle equal createdAt timestamps', () => {
    const current = makeBook({ createdAt: 1000 });
    const backup = makeBook({ createdAt: 1000 });
    const result = mergeBookMetadata(current, backup);
    expect(result.createdAt).toBe(1000);
  });

  it('should handle deletedAt being undefined (treated like null)', () => {
    const current = makeBook({ deletedAt: undefined });
    const backup = makeBook({ deletedAt: 5000 });
    const result = mergeBookMetadata(current, backup);
    // Only deleted if BOTH sides agree; undefined is falsy
    expect(result.deletedAt).toBeNull();
  });

  it('should handle both deletedAt being undefined', () => {
    const current = makeBook({ deletedAt: undefined });
    const backup = makeBook({ deletedAt: undefined });
    const result = mergeBookMetadata(current, backup);
    expect(result.deletedAt).toBeNull();
  });

  it('should handle deletedAt being 0 (falsy number)', () => {
    const current = makeBook({ deletedAt: 0 });
    const backup = makeBook({ deletedAt: 5000 });
    const result = mergeBookMetadata(current, backup);
    // 0 is falsy, so current.deletedAt && backup.deletedAt is falsy
    expect(result.deletedAt).toBeNull();
  });

  it('should preserve other fields from the base (higher updatedAt)', () => {
    const current = makeBook({
      updatedAt: 1000,
      hash: 'hash1',
      format: 'EPUB',
      author: 'Author A',
    });
    const backup = makeBook({
      updatedAt: 3000,
      hash: 'hash1',
      format: 'PDF',
      author: 'Author B',
    });
    const result = mergeBookMetadata(current, backup);
    // Backup has higher updatedAt, so its fields are base
    expect(result.format).toBe('PDF');
    expect(result.author).toBe('Author B');
  });

  it('should reconcile timestamps correctly when backup is older', () => {
    const current = makeBook({ updatedAt: 5000, createdAt: 500 });
    const backup = makeBook({ updatedAt: 3000, createdAt: 200 });
    const result = mergeBookMetadata(current, backup);
    expect(result.updatedAt).toBe(5000); // max
    expect(result.createdAt).toBe(200); // min
  });

  it('should reconcile timestamps correctly when current is older', () => {
    const current = makeBook({ updatedAt: 1000, createdAt: 100 });
    const backup = makeBook({ updatedAt: 5000, createdAt: 500 });
    const result = mergeBookMetadata(current, backup);
    expect(result.updatedAt).toBe(5000); // max
    expect(result.createdAt).toBe(100); // min
  });

  it('should handle both sides deleted with equal timestamps', () => {
    const current = makeBook({ deletedAt: 4000 });
    const backup = makeBook({ deletedAt: 4000 });
    const result = mergeBookMetadata(current, backup);
    expect(result.deletedAt).toBe(4000);
  });
});
