import { describe, test, expect, beforeEach, vi } from 'vitest';

// transferManager is a singleton with heavy dependencies; mock it so the test
// only observes whether ingestFile decided to queue an upload.
vi.mock('@/services/transferManager', () => ({
  transferManager: { queueUpload: vi.fn() },
}));

import { ingestFile } from '@/services/ingestService';
import { transferManager } from '@/services/transferManager';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';
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
  over: { importResult?: Book | null; autoUpload?: boolean; isLoggedIn?: boolean } = {},
) {
  const importResult = over.importResult === undefined ? makeBook() : over.importResult;
  const importBook = vi.fn().mockResolvedValue(importResult);
  const appService = { importBook } as unknown as AppService;
  const settings = { autoUpload: over.autoUpload ?? false } as SystemSettings;
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
    expect(importBook).toHaveBeenCalledWith('book.epub', [], { lookupIndex });
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
});
