import { describe, expect, test } from 'vitest';
import {
  buildBasePath,
  buildBookDirPath,
  buildBookConfigPath,
  buildLibraryPath,
  buildBookFilePath,
  buildBookCoverPath,
  ancestorsOf,
  normalizeRoot,
} from '@/services/sync/file/layout';
import type { Book } from '@/types/book';

const book = {
  hash: 'h1',
  format: 'EPUB',
  title: 'My Book',
  sourceTitle: 'My Book',
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
} as Book;

describe('sync layout (frozen)', () => {
  test('book tree paths under <root>/Readest/books/<hash>', () => {
    expect(buildBasePath('/')).toBe('/Readest');
    expect(buildBasePath('/MyDav')).toBe('/MyDav/Readest');
    expect(buildBookDirPath('/', 'h1')).toBe('/Readest/books/h1');
    expect(buildBookConfigPath('/', 'h1')).toBe('/Readest/books/h1/config.json');
    expect(buildBookCoverPath('/', 'h1')).toBe('/Readest/books/h1/cover.png');
    expect(buildLibraryPath('/')).toBe('/Readest/library.json');
  });

  test('book file path uses safe title + ext inside the hash dir', () => {
    expect(buildBookFilePath('/', book)).toBe('/Readest/books/h1/My Book.epub');
  });

  test('normalizeRoot strips trailing slash, adds leading', () => {
    expect(normalizeRoot('')).toBe('/');
    expect(normalizeRoot('books/')).toBe('/books');
    expect(normalizeRoot('/a/b/')).toBe('/a/b');
  });

  test('ancestorsOf walks parents top-down excluding the leaf', () => {
    expect(ancestorsOf('/a/b/c/file.json')).toEqual(['/a', '/a/b', '/a/b/c']);
    expect(ancestorsOf('/file.json')).toEqual([]);
  });
});
