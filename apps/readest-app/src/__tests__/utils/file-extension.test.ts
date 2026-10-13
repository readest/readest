import { describe, expect, test } from 'vitest';
import { getFileExtension } from '@/utils/path';

// Issue #5959: browsers and download managers append a duplicate marker when a
// download would overwrite an existing file, and several put it AFTER the
// extension ("The_Amazing_Traveling.epub (1)"). A naive
// `name.split('.').pop()` reads that as the extension "epub (1)", so every
// ingress whitelist dropped the file and the import silently did nothing.
describe('getFileExtension', () => {
  test('reads a plain extension', () => {
    expect(getFileExtension('book.epub')).toBe('epub');
    expect(getFileExtension('/home/user/books/book.EPUB')).toBe('epub');
  });

  test('looks past a duplicate marker appended after the extension', () => {
    expect(getFileExtension('The_Amazing_Traveling.epub (1)')).toBe('epub');
    expect(getFileExtension('The_Amazing_Traveling.epub(2)')).toBe('epub');
    expect(getFileExtension('notes.txt (10)')).toBe('txt');
  });

  test('leaves a marker that sits before the extension alone', () => {
    expect(getFileExtension('The_Amazing_Traveling (1).epub')).toBe('epub');
  });

  test('keeps parentheses that are part of the name', () => {
    expect(getFileExtension('Dune (1965).epub')).toBe('epub');
    expect(getFileExtension('report.2024 (1)')).toBe('2024');
  });

  test('returns an empty string when there is no extension', () => {
    expect(getFileExtension('README')).toBe('');
    expect(getFileExtension('archive (1)')).toBe('');
    expect(getFileExtension('')).toBe('');
  });
});
