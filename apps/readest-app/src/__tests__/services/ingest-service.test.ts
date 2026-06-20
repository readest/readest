import { describe, test, expect, beforeEach, vi } from 'vitest';

// transferManager is a singleton with heavy dependencies; mock it so the test
// only observes whether ingestFile decided to queue an upload.
vi.mock('@/services/transferManager', () => ({
  transferManager: { queueUpload: vi.fn() },
}));

import { ingestFile } from '@/services/ingestService';
import { transferManager } from '@/services/transferManager';
import type { Book } from '@/types/book';
import type { AppService, OsPlatform } from '@/types/system';
import type { SystemSettings } from '@/types/settings';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    hash: 'hash1',
    format: 'EPUB',
    title: 'Test Book',
    author: 'Author',
    createdAt: 1000,
    updatedAt: 2000,
    ...overrides,
  };
}

function makeDeps(
  over: {
    importResult?: Book | null;
    autoUpload?: boolean;
    isLoggedIn?: boolean;
    externalLibraryFolders?: string[];
    osPlatform?: OsPlatform;
  } = {},
) {
  const importResult = over.importResult === undefined ? makeBook() : over.importResult;
  const importBook = vi.fn().mockResolvedValue(importResult);
  // Default to a case-sensitive platform so existing tests keep exercising
  // the strict-prefix path; per-test overrides switch to macos/windows/ios
  // when the case-insensitive behavior is under test.
  const appService = {
    importBook,
    osPlatform: over.osPlatform ?? ('linux' as OsPlatform),
  } as unknown as AppService;
  const settings = {
    autoUpload: over.autoUpload ?? false,
    externalLibraryFolders: over.externalLibraryFolders,
  } as SystemSettings;
  return { appService, settings, isLoggedIn: over.isLoggedIn ?? false, importBook };
}

describe('ingestFile', () => {
  beforeEach(() => {
    vi.mocked(transferManager.queueUpload).mockClear();
  });

  test('returns the imported book', async () => {
    const { appService, settings, isLoggedIn } = makeDeps();
    const book = await ingestFile(
      { file: 'book.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(book?.hash).toBe('hash1');
  });

  test('returns null when importBook returns null', async () => {
    const { appService, settings, isLoggedIn } = makeDeps({ importResult: null });
    const book = await ingestFile(
      { file: 'book.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(book).toBeNull();
  });

  test('passes the lookup index through to importBook', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps();
    const lookupIndex = { byHash: new Map(), byMetaHash: new Map() } as never;
    await ingestFile(
      { file: 'book.epub', books: [], lookupIndex },
      { appService, settings, isLoggedIn },
    );
    expect(importBook).toHaveBeenCalledWith('book.epub', [], {
      lookupIndex,
      transient: undefined,
      inPlace: false,
    });
  });

  test('applies groupId and groupName', async () => {
    const { appService, settings, isLoggedIn } = makeDeps();
    const book = await ingestFile(
      { file: 'book.epub', books: [], groupId: 'g1', groupName: 'Sci-Fi' },
      { appService, settings, isLoggedIn },
    );
    expect(book?.groupId).toBe('g1');
    expect(book?.groupName).toBe('Sci-Fi');
  });

  test('clears the group when groupId is the empty string (flatten-into-root)', async () => {
    // A previously-imported book may already carry a groupId/Name from
    // a prior import. Re-importing with an explicit empty groupId
    // should demote it back to the library root rather than silently
    // keeping the stale group — that behaviour matters for the
    // Import-from-Folder dialog's "flatten" mode.
    const { appService, settings, isLoggedIn } = makeDeps({
      importResult: makeBook({ groupId: 'old', groupName: 'Old/Folder' }),
    });
    const book = await ingestFile(
      { file: 'book.epub', books: [], groupId: '', groupName: undefined },
      { appService, settings, isLoggedIn },
    );
    expect(book?.groupId).toBe('');
    expect(book?.groupName).toBeUndefined();
  });

  test('leaves the group untouched when groupId is omitted', async () => {
    // Sanity check for the tri-state contract: undefined groupId means
    // "don't touch the existing group" (used by the inbox drainer and
    // /send page where the user hasn't picked a destination).
    const { appService, settings, isLoggedIn } = makeDeps({
      importResult: makeBook({ groupId: 'keep', groupName: 'Keep/Me' }),
    });
    const book = await ingestFile(
      { file: 'book.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(book?.groupId).toBe('keep');
    expect(book?.groupName).toBe('Keep/Me');
  });

  test('applies a subject tag and bumps updatedAt', async () => {
    const { appService, settings, isLoggedIn } = makeDeps();
    const book = await ingestFile(
      { file: 'book.epub', books: [], subjectTag: 'scifi' },
      { appService, settings, isLoggedIn },
    );
    expect(book?.tags).toContain('scifi');
    expect(book?.updatedAt).toBeGreaterThan(2000);
  });

  test('does not duplicate an existing tag or bump updatedAt', async () => {
    const { appService, settings, isLoggedIn } = makeDeps({
      importResult: makeBook({ tags: ['scifi'], updatedAt: 2000 }),
    });
    const book = await ingestFile(
      { file: 'book.epub', books: [], subjectTag: 'scifi' },
      { appService, settings, isLoggedIn },
    );
    expect(book?.tags).toEqual(['scifi']);
    expect(book?.updatedAt).toBe(2000);
  });

  test('forceUpload queues an upload even when autoUpload is off', async () => {
    const { appService, settings, isLoggedIn } = makeDeps({
      autoUpload: false,
      isLoggedIn: true,
    });
    await ingestFile(
      { file: 'book.epub', books: [], forceUpload: true },
      { appService, settings, isLoggedIn },
    );
    expect(transferManager.queueUpload).toHaveBeenCalledTimes(1);
  });

  test('autoUpload queues an upload without forceUpload', async () => {
    const { appService, settings, isLoggedIn } = makeDeps({
      autoUpload: true,
      isLoggedIn: true,
    });
    await ingestFile({ file: 'book.epub', books: [] }, { appService, settings, isLoggedIn });
    expect(transferManager.queueUpload).toHaveBeenCalledTimes(1);
  });

  test('does not queue an upload when neither forceUpload nor autoUpload is set', async () => {
    const { appService, settings, isLoggedIn } = makeDeps({
      autoUpload: false,
      isLoggedIn: true,
    });
    await ingestFile({ file: 'book.epub', books: [] }, { appService, settings, isLoggedIn });
    expect(transferManager.queueUpload).not.toHaveBeenCalled();
  });

  test('does not queue an upload when the user is not logged in', async () => {
    const { appService, settings, isLoggedIn } = makeDeps({
      autoUpload: true,
      isLoggedIn: false,
    });
    await ingestFile(
      { file: 'book.epub', books: [], forceUpload: true },
      { appService, settings, isLoggedIn },
    );
    expect(transferManager.queueUpload).not.toHaveBeenCalled();
  });

  test('never queues an upload for a transient import', async () => {
    const { appService, settings, isLoggedIn } = makeDeps({
      autoUpload: true,
      isLoggedIn: true,
    });
    await ingestFile(
      { file: 'book.epub', books: [], transient: true, forceUpload: true },
      { appService, settings, isLoggedIn },
    );
    expect(transferManager.queueUpload).not.toHaveBeenCalled();
  });

  test('passes the transient flag through to importBook', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps();
    await ingestFile(
      { file: 'book.epub', books: [], transient: true },
      { appService, settings, isLoggedIn },
    );
    expect(importBook).toHaveBeenCalledWith('book.epub', [], {
      lookupIndex: undefined,
      transient: true,
      inPlace: false,
    });
  });

  test('does not queue an upload when the book is already uploaded', async () => {
    const { appService, settings, isLoggedIn } = makeDeps({
      importResult: makeBook({ uploadedAt: 5000 }),
      autoUpload: true,
      isLoggedIn: true,
    });
    await ingestFile(
      { file: 'book.epub', books: [], forceUpload: true },
      { appService, settings, isLoggedIn },
    );
    expect(transferManager.queueUpload).not.toHaveBeenCalled();
  });

  // ------ in-place auto-detection ------

  test('does not mark in-place when no external library folders are configured', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps();
    await ingestFile(
      { file: '/Users/me/Books/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  test('marks in-place when the source file lives under an external library folder', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library'],
    });
    await ingestFile(
      { file: '/Users/me/Library/Imports/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: true });
  });

  test('does not mark in-place when the source file is outside every external library folder', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library'],
    });
    await ingestFile(
      { file: '/Users/me/Downloads/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  test('does not let a sibling-prefix path masquerade as inside an external library folder', async () => {
    // `/Users/me/LibraryOther/...` shares a string prefix with `/Users/me/Library`
    // but is a different directory. The boundary check must use a separator.
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library'],
    });
    await ingestFile(
      { file: '/Users/me/LibraryOther/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  test('marks <root>/Books/* in-place when no app books prefix collides', async () => {
    // A user-owned folder that happens to be named "Books" (very common in
    // cloud-drive layouts like Baidu Netdisk's default `Books/` root) must
    // still go in-place. The old `<root>/Books/*` exclusion was a footgun
    // that produced silent hash copies of real user files.
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library'],
    });
    await ingestFile(
      { file: '/Users/me/Library/Books/Novels/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: true });
  });

  test('does not mark in-place for files inside readest-managed Books prefix', async () => {
    // Files copied under readest's own AppData Books/<hash>/ are already
    // hash copies, not user originals. Marking them in-place would set
    // book.filePath to a path readest already controls.
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/AppData'],
    });
    await ingestFile(
      { file: '/Users/me/AppData/Books/abc123/sample.epub', books: [] },
      {
        appService,
        settings,
        isLoggedIn,
        appBooksPrefix: '/Users/me/AppData/Books',
      },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  test('does not mark in-place for relative paths', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library'],
    });
    await ingestFile({ file: 'sample.epub', books: [] }, { appService, settings, isLoggedIn });
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  test('does not mark in-place for File objects (web)', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library'],
    });
    const blob = new File([new Uint8Array([0])], 'sample.epub');
    await ingestFile({ file: blob, books: [] }, { appService, settings, isLoggedIn });
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  test('does not mark in-place for URL strings even if they happen to start with a slash', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library'],
    });
    await ingestFile(
      { file: 'https://example.com/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  test('transient wins over in-place auto-detection', async () => {
    // A transient import already takes its own filePath path; we must not
    // also flag it as inPlace, otherwise the Books/<hash>/ guard would be
    // applied twice with subtly different semantics.
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library'],
    });
    await ingestFile(
      { file: '/Users/me/Library/sample.epub', books: [], transient: true },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({
      transient: true,
      inPlace: false,
    });
  });

  test('forceCopy opts out of in-place auto-detection', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library'],
    });
    await ingestFile(
      { file: '/Users/me/Library/sample.epub', books: [], forceCopy: true },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  test('handles an external library folder path with a trailing slash', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library/'],
    });
    await ingestFile(
      { file: '/Users/me/Library/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: true });
  });

  test('marks in-place for Windows paths under a Windows external library folder', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['C:\\Users\\me\\Library'],
    });
    await ingestFile(
      { file: 'C:\\Users\\me\\Library\\Imports\\sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: true });
  });

  // The user can register multiple external library folders (e.g. one for
  // Duokan, another for an iCloud mirror, another for a local SSD library).
  // A file matching any of them should be marked in-place; a file matching
  // none should not.

  test('marks in-place when the source file lives under any registered folder', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Duokan', '/Users/me/Calibre Library'],
    });
    await ingestFile(
      { file: '/Users/me/Calibre Library/Author/Title/book.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: true });
  });

  test('does not mark in-place when the file matches none of the registered folders', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Duokan', '/Users/me/Calibre Library'],
    });
    await ingestFile(
      { file: '/Users/me/Downloads/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  test('matches across multiple roots; user-owned Books/ subdirs go in-place', async () => {
    // Multiple registered roots all match by strict prefix. A user-owned
    // subdirectory named "Books" under one of those roots (very common
    // layout, e.g. Baidu Netdisk / Duokan exports) is treated as ordinary
    // content — files there go in-place. Only readest's own managed Books
    // prefix (passed in via `appBooksPrefix`) is excluded.
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Old Library', '/Users/me/Duokan'],
    });
    await ingestFile(
      { file: '/Users/me/Duokan/Books/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: true });

    const {
      appService: a2,
      settings: s2,
      isLoggedIn: l2,
      importBook: i2,
    } = makeDeps({
      externalLibraryFolders: ['/Users/me/Old Library', '/Users/me/Duokan'],
    });
    await ingestFile(
      { file: '/Users/me/Duokan/sample.epub', books: [] },
      { appService: a2, settings: s2, isLoggedIn: l2 },
    );
    expect(i2.mock.calls[0]?.[2]).toMatchObject({ inPlace: true });
  });

  test('ignores empty / falsy entries in externalLibraryFolders', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['', '/Users/me/Library'],
    });
    await ingestFile(
      { file: '/Users/me/Library/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: true });
  });

  // ------ case-sensitivity per OS ------
  // macOS (APFS/HFS+ default), iOS, and Windows ship case-insensitive
  // filesystems; the registered root and the actual file path may legally
  // differ only in case. Linux / Android are case-sensitive and stay strict.

  test('matches case-insensitively on macOS', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library'],
      osPlatform: 'macos',
    });
    await ingestFile(
      { file: '/users/me/library/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: true });
  });

  test('matches case-insensitively on iOS', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/var/mobile/Containers/MyLibrary'],
      osPlatform: 'ios',
    });
    await ingestFile(
      { file: '/var/mobile/containers/mylibrary/book.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: true });
  });

  test('matches case-insensitively on Windows', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['C:\\Users\\me\\Library'],
      osPlatform: 'windows',
    });
    await ingestFile(
      { file: 'c:\\users\\me\\library\\Imports\\sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: true });
  });

  test('stays case-sensitive on Linux', async () => {
    // Guards against regressing case-sensitive platforms into accidentally
    // treating `Library` and `library` as the same directory.
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/home/me/Library'],
      osPlatform: 'linux',
    });
    await ingestFile(
      { file: '/home/me/library/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  test('stays case-sensitive on Android', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/storage/emulated/0/Books'],
      osPlatform: 'android',
    });
    await ingestFile(
      { file: '/storage/emulated/0/books/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  test('app books prefix exclusion is case-insensitive on macOS', async () => {
    // The managed-prefix opt-out must follow the same case rules as the
    // root match, otherwise a mixed-case `/Books/` path could slip through
    // as in-place on macOS / iOS / Windows.
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/AppData'],
      osPlatform: 'macos',
    });
    await ingestFile(
      { file: '/Users/me/AppData/books/abc123/sample.epub', books: [] },
      {
        appService,
        settings,
        isLoggedIn,
        appBooksPrefix: '/Users/me/AppData/Books',
      },
    );
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  // ------ in-place + byFilePath fast path ------
  // ingestFile probes the byFilePath index before delegating to importBook
  // so a re-scan of an already-imported external folder skips file I/O,
  // parsing, hashing, AND every downstream side effect (group / tag / upload
  // decisions). The fast path returning early is what guarantees a manual
  // GroupingModal assignment survives a folder re-import — without it, a
  // path-derived empty groupId would clobber the existing group.

  test('byFilePath hit short-circuits importBook entirely on in-place re-import', async () => {
    const { appService, settings, isLoggedIn, importBook } = makeDeps({
      externalLibraryFolders: ['/Users/me/Library'],
      osPlatform: 'macos',
    });
    const sourcePath = '/Users/me/Library/sample.epub';
    const existing: Book = {
      hash: 'previously-hashed',
      format: 'EPUB',
      title: 'Existing',
      author: 'Author',
      filePath: sourcePath,
      createdAt: 1000,
      updatedAt: 2000,
      groupId: 'manual',
      groupName: 'Manual/Group',
    };
    // macOS is case-insensitive, so the index key is lowercased to match
    // what `normalizeFilePathForIndex` produces in production.
    const lookupIndex = {
      byHash: new Map(),
      byMetaKey: new Map(),
      byFilePath: new Map([[sourcePath.toLowerCase(), existing]]),
    } as unknown as Parameters<typeof ingestFile>[0]['lookupIndex'];
    const book = await ingestFile(
      {
        file: sourcePath,
        books: [existing],
        lookupIndex,
        groupId: '',
        groupName: undefined,
      },
      { appService, settings, isLoggedIn },
    );
    expect(book).toBe(existing);
    // importBook never ran, so no file I/O, no parser, no partialMD5.
    expect(importBook).not.toHaveBeenCalled();
    // Existing fields are untouched: createdAt / updatedAt / group all stay.
    expect(existing.createdAt).toBe(1000);
    expect(existing.updatedAt).toBe(2000);
    expect(existing.groupId).toBe('manual');
    expect(existing.groupName).toBe('Manual/Group');
  });

  test('without inPlace the byFilePath index is ignored and importBook runs', async () => {
    // Fast path is gated on `inPlace`. A classic copy-mode import (no
    // external library folder configured) that happens to point at a path
    // already in the library must still go through importBook so dedup
    // falls back to byHash.
    const { appService, settings, isLoggedIn, importBook } = makeDeps();
    const sourcePath = '/Users/me/Downloads/sample.epub';
    const existing: Book = {
      hash: 'previously-hashed',
      format: 'EPUB',
      title: 'Existing',
      author: 'Author',
      filePath: sourcePath,
      createdAt: 1000,
      updatedAt: 2000,
    };
    const lookupIndex = {
      byHash: new Map(),
      byMetaKey: new Map(),
      byFilePath: new Map([[sourcePath, existing]]),
    } as unknown as Parameters<typeof ingestFile>[0]['lookupIndex'];
    await ingestFile(
      { file: sourcePath, books: [existing], lookupIndex },
      { appService, settings, isLoggedIn },
    );
    expect(importBook).toHaveBeenCalledTimes(1);
    expect(importBook.mock.calls[0]?.[2]).toMatchObject({ inPlace: false });
  });

  // ------ in-place + cloud upload ------
  // In-place imports are still uploaded so the user gets backup / cross-device
  // sync. Only transient imports opt out of upload entirely. The on-the-wire
  // shape is identical to a hash-copy book; uploadBook reads from book.filePath
  // when set, which is asserted in cloud-service.test.ts.

  test('autoUpload still queues an in-place book (book.filePath set)', async () => {
    const { appService, settings, isLoggedIn } = makeDeps({
      autoUpload: true,
      isLoggedIn: true,
      externalLibraryFolders: ['/Users/me/Library'],
      importResult: makeBook({ filePath: '/Users/me/Library/sample.epub' }),
    });
    await ingestFile(
      { file: '/Users/me/Library/sample.epub', books: [] },
      { appService, settings, isLoggedIn },
    );
    expect(transferManager.queueUpload).toHaveBeenCalledTimes(1);
  });

  test('forceUpload still queues an in-place book even when autoUpload is off', async () => {
    const { appService, settings, isLoggedIn } = makeDeps({
      autoUpload: false,
      isLoggedIn: true,
      externalLibraryFolders: ['/Users/me/Library'],
      importResult: makeBook({ filePath: '/Users/me/Library/sample.epub' }),
    });
    await ingestFile(
      { file: '/Users/me/Library/sample.epub', books: [], forceUpload: true },
      { appService, settings, isLoggedIn },
    );
    expect(transferManager.queueUpload).toHaveBeenCalledTimes(1);
  });

  test('transient still trumps in-place — no upload even with forceUpload', async () => {
    const { appService, settings, isLoggedIn } = makeDeps({
      autoUpload: true,
      isLoggedIn: true,
      externalLibraryFolders: ['/Users/me/Library'],
      importResult: makeBook({ filePath: '/Users/me/Library/sample.epub' }),
    });
    await ingestFile(
      {
        file: '/Users/me/Library/sample.epub',
        books: [],
        transient: true,
        forceUpload: true,
      },
      { appService, settings, isLoggedIn },
    );
    expect(transferManager.queueUpload).not.toHaveBeenCalled();
  });
});
