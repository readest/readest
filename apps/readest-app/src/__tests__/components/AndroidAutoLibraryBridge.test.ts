import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { getAndroidAutoLibraryBooks } from '@/components/AndroidAutoLibraryBridge';

const book = (overrides: Partial<Book>): Book => ({
  hash: 'hash',
  format: 'EPUB',
  title: 'Title',
  author: 'Author',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('AndroidAutoLibraryBridge', () => {
  it('publishes recent playable books and excludes deleted or cloud-only rows', () => {
    const books = getAndroidAutoLibraryBooks(
      [
        book({ hash: 'older', title: 'Older', updatedAt: 10 }),
        book({
          hash: 'newer',
          title: 'Newer',
          updatedAt: 20,
          downloadedAt: 20,
          coverHash: 'cover-v2',
        }),
        book({ hash: 'cloud', title: 'Cloud only', updatedAt: 30, downloadedAt: null }),
        book({ hash: 'deleted', title: 'Deleted', updatedAt: 40, deletedAt: 40 }),
        book({ hash: 'audio', title: 'Audiobook', format: 'ABS', updatedAt: 50 }),
      ],
      new Map([
        ['newer', { coverHash: 'cover-v2', url: 'asset://newer-cover' }],
        ['older', { coverHash: 'stale-cover', url: 'asset://older-cover' }],
      ]),
    );

    expect(books).toEqual([
      {
        hash: 'audio',
        title: 'Audiobook',
        author: 'Author',
        isAudiobook: true,
        coverHash: null,
        artworkReady: false,
      },
      {
        hash: 'newer',
        title: 'Newer',
        author: 'Author',
        isAudiobook: false,
        coverHash: 'cover-v2',
        artworkReady: true,
      },
      {
        hash: 'older',
        title: 'Older',
        author: 'Author',
        isAudiobook: false,
        coverHash: null,
        artworkReady: false,
      },
    ]);
  });
});
