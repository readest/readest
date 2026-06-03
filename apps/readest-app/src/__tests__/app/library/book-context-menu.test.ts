import { describe, expect, it } from 'vitest';

import { getBookContextMenuItemIds } from '@/app/library/utils/libraryUtils';
import { Book } from '@/types/book';

const createBook = (overrides: Partial<Book> = {}): Book => ({
  hash: 'hash-1',
  format: 'EPUB',
  title: 'Test Book',
  author: 'Test Author',
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
});

describe('getBookContextMenuItemIds', () => {
  it('returns a deterministic order for a local downloaded book', () => {
    const book = createBook({ downloadedAt: 1 });
    expect(getBookContextMenuItemIds(book)).toEqual([
      'select',
      'group',
      'markFinished',
      'showDetails',
      'showInFinder',
      'upload',
      'share',
      'delete',
    ]);
  });

  it('shows "Mark as Unread" + "Clear Status" for a finished book', () => {
    const book = createBook({ downloadedAt: 1, readingStatus: 'finished' });
    expect(getBookContextMenuItemIds(book)).toEqual([
      'select',
      'group',
      'markUnread',
      'clearStatus',
      'showDetails',
      'showInFinder',
      'upload',
      'share',
      'delete',
    ]);
  });

  it('shows "Mark as Finished" + "Clear Status" for an unread book', () => {
    const book = createBook({ downloadedAt: 1, readingStatus: 'unread' });
    expect(getBookContextMenuItemIds(book)).toEqual([
      'select',
      'group',
      'markFinished',
      'clearStatus',
      'showDetails',
      'showInFinder',
      'upload',
      'share',
      'delete',
    ]);
  });

  it('offers Download (not Upload) for a cloud-only book', () => {
    const book = createBook({ uploadedAt: 1 });
    expect(getBookContextMenuItemIds(book)).toEqual([
      'select',
      'group',
      'markFinished',
      'showDetails',
      'showInFinder',
      'download',
      'share',
      'delete',
    ]);
  });

  it('omits download/upload/share for a book that is neither downloaded nor uploaded', () => {
    const book = createBook({ filePath: '/some/external/file.epub' });
    expect(getBookContextMenuItemIds(book)).toEqual([
      'select',
      'group',
      'markFinished',
      'showDetails',
      'showInFinder',
      'delete',
    ]);
  });

  it('produces the same order on repeated calls and never duplicates an item (issue #4389)', () => {
    const book = createBook({ downloadedAt: 1, uploadedAt: 1, readingStatus: 'finished' });
    const first = getBookContextMenuItemIds(book);
    const second = getBookContextMenuItemIds(book);
    expect(second).toEqual(first);
    expect(new Set(first).size).toBe(first.length);
  });
});
