import { describe, expect, test } from 'vitest';
import { selectNewImportableFiles } from '@/services/bookService';

const entry = (fullPath: string, size = 100_000) => ({ fullPath, size });

describe('selectNewImportableFiles', () => {
  const opts = (over: Partial<Parameters<typeof selectNewImportableFiles>[1]> = {}) => ({
    extensions: ['epub', 'pdf', 'mobi'],
    minSizeBytes: 20 * 1024,
    existingPaths: new Set<string>(),
    osPlatform: 'linux' as const,
    ...over,
  });

  test('keeps only supported extensions (case-insensitive)', () => {
    const result = selectNewImportableFiles(
      [entry('/b/a.EPUB'), entry('/b/c.pdf'), entry('/b/note.txt'), entry('/b/d.png')],
      opts(),
    );
    expect(result.map((e) => e.fullPath)).toEqual(['/b/a.EPUB', '/b/c.pdf']);
  });

  test('drops files below the min size', () => {
    const result = selectNewImportableFiles(
      [entry('/b/tiny.epub', 1024), entry('/b/ok.epub', 30_000)],
      opts(),
    );
    expect(result.map((e) => e.fullPath)).toEqual(['/b/ok.epub']);
  });

  test('drops files already present (exact path)', () => {
    const result = selectNewImportableFiles(
      [entry('/b/have.epub'), entry('/b/new.epub')],
      opts({ existingPaths: new Set(['/b/have.epub']) }),
    );
    expect(result.map((e) => e.fullPath)).toEqual(['/b/new.epub']);
  });

  test('matches existing paths case-insensitively on macos/ios/windows', () => {
    const result = selectNewImportableFiles(
      [entry('/B/Have.EPUB')],
      // existingPaths keys are pre-normalized (lowercased) on these platforms
      opts({ osPlatform: 'macos', existingPaths: new Set(['/b/have.epub']) }),
    );
    expect(result).toEqual([]);
  });

  test('is case-sensitive on linux/android', () => {
    const result = selectNewImportableFiles(
      [entry('/B/Have.epub')],
      opts({ osPlatform: 'linux', existingPaths: new Set(['/b/have.epub']) }),
    );
    expect(result.map((e) => e.fullPath)).toEqual(['/B/Have.epub']);
  });

  test('returns [] when every scanned file is already present (quiet path)', () => {
    const result = selectNewImportableFiles(
      [entry('/b/a.epub'), entry('/b/b.epub')],
      opts({ existingPaths: new Set(['/b/a.epub', '/b/b.epub']) }),
    );
    expect(result).toEqual([]);
  });

  test('returns all new files when the library is empty', () => {
    const result = selectNewImportableFiles([entry('/b/a.epub'), entry('/b/b.pdf')], opts());
    expect(result).toHaveLength(2);
  });
});
