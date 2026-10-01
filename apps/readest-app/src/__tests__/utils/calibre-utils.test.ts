import { describe, expect, it } from 'vitest';
import {
  buildDownloadLadder,
  computeCalibreServerId,
  isCalibreBook,
  isCalibreStub,
  makeCalibreFilePath,
  parseCalibreFilePath,
  pickPreferredFormat,
  resolveCalibreIdentity,
} from '@/utils/calibre';

describe('buildDownloadLadder', () => {
  it('orders the preferred format first, then the rest in preference order', () => {
    expect(buildDownloadLadder('pdf', ['pdf', 'mobi', 'epub', 'kfx'])).toEqual([
      'pdf',
      'epub',
      'mobi',
    ]);
  });

  it('drops formats Readest cannot open and dedupes', () => {
    expect(buildDownloadLadder('epub', ['epub', 'epub', 'prc', 'kepub'])).toEqual(['epub']);
  });

  it('keeps the preferred head even when the list is missing or inconsistent', () => {
    expect(buildDownloadLadder('epub', undefined)).toEqual(['epub']);
    expect(buildDownloadLadder('epub', ['mobi'])).toEqual(['epub', 'mobi']);
  });

  it('falls back to the list when there is no preferred format', () => {
    expect(buildDownloadLadder(undefined, ['pdf', 'epub'])).toEqual(['epub', 'pdf']);
    expect(buildDownloadLadder(undefined, undefined)).toEqual([]);
  });
});

describe('pickPreferredFormat', () => {
  it('prefers EPUB over everything', () => {
    expect(pickPreferredFormat(['mobi', 'pdf', 'epub', 'kfx'])).toBe('epub');
  });

  it('falls through the preference tiers', () => {
    expect(pickPreferredFormat(['azw3', 'mobi', 'txt'])).toBe('azw3');
    expect(pickPreferredFormat(['mobi', 'pdf'])).toBe('mobi');
    expect(pickPreferredFormat(['pdf', 'txt'])).toBe('pdf');
    expect(pickPreferredFormat(['txt'])).toBe('txt');
  });

  it('skips formats Readest cannot open', () => {
    expect(pickPreferredFormat(['kfx', 'azw4', 'epub'])).toBe('epub');
    expect(pickPreferredFormat(['kfx', 'docx', 'djvu'])).toBe('');
  });

  it('never returns a format outside the BookFormat union', () => {
    // Calibre reports these; EXTS has no entry for them, and an unknown
    // format would break every EXTS[book.format] lookup downstream.
    expect(pickPreferredFormat(['prc'])).toBe('');
    expect(pickPreferredFormat(['kepub', 'rtf'])).toBe('');
    expect(pickPreferredFormat(['kepub', 'epub'])).toBe('epub');
  });

  it('handles empty and missing lists', () => {
    expect(pickPreferredFormat([])).toBe('');
    expect(pickPreferredFormat(undefined)).toBe('');
    expect(pickPreferredFormat(null)).toBe('');
  });

  it('is case-insensitive on the server format names', () => {
    expect(pickPreferredFormat(['EPUB', 'MOBI'])).toBe('epub');
  });
});

describe('calibre file path', () => {
  it('round-trips server, library and book ids', () => {
    const path = makeCalibreFilePath('srv1', 'Calibre_Library', '42');
    expect(parseCalibreFilePath(path)).toEqual({
      serverId: 'srv1',
      libraryId: 'Calibre_Library',
      bookId: '42',
    });
  });

  it('rejects non-calibre and malformed paths', () => {
    expect(parseCalibreFilePath('/Users/me/book.epub')).toBeNull();
    expect(parseCalibreFilePath(undefined)).toBeNull();
    expect(parseCalibreFilePath('calibre://srv1')).toBeNull();
    expect(parseCalibreFilePath('calibre://srv1/lib/')).toBeNull();
  });
});

describe('computeCalibreServerId', () => {
  it('is stable across trailing slashes and embedded credentials', () => {
    const base = computeCalibreServerId('https://calibre.example.com');
    expect(computeCalibreServerId('https://calibre.example.com/')).toBe(base);
    expect(computeCalibreServerId('https://user:pass@calibre.example.com')).toBe(base);
  });

  it('differs for different servers and path prefixes', () => {
    const a = computeCalibreServerId('https://calibre.example.com');
    expect(computeCalibreServerId('https://other.example.com')).not.toBe(a);
    expect(computeCalibreServerId('https://calibre.example.com/calibre')).not.toBe(a);
  });
});

describe('calibre book classification and identity', () => {
  const stubBook = {
    filePath: makeCalibreFilePath('srv1', 'lib', '42'),
  };
  const downloadedBook = {
    metadata: {
      title: 'Book 42',
      author: 'Author A',
      language: '',
      calibreSource: { serverId: 'srv1', libraryId: 'lib', bookId: '42', format: 'epub' },
    },
  };
  const localBook = { filePath: '/Users/me/Books/abc/book.epub' };

  it('flags stubs and downloaded calibre books, not local ones', () => {
    expect(isCalibreStub({ ...stubBook } as never)).toBe(true);
    expect(isCalibreStub(downloadedBook as never)).toBe(false);
    expect(isCalibreBook(stubBook)).toBe(true);
    expect(isCalibreBook(downloadedBook)).toBe(true);
    expect(isCalibreBook(localBook)).toBe(false);
  });

  it('resolves identity from the stub filePath first', () => {
    expect(resolveCalibreIdentity(stubBook)).toEqual({
      serverId: 'srv1',
      libraryId: 'lib',
      bookId: '42',
    });
  });

  it('resolves identity from calibreSource when the filePath was cleared', () => {
    expect(resolveCalibreIdentity(downloadedBook)).toEqual({
      serverId: 'srv1',
      libraryId: 'lib',
      bookId: '42',
    });
  });

  it('returns null for non-calibre books and incomplete sources', () => {
    expect(resolveCalibreIdentity(localBook)).toBeNull();
    expect(
      resolveCalibreIdentity({ metadata: { calibreSource: { serverId: 'srv1' } } as never }),
    ).toBeNull();
  });
});
