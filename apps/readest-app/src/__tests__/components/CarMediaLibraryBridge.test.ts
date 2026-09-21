import { describe, expect, it } from 'vitest';
import type { Book } from '@/types/book';
import { MAX_CAR_MEDIA_BOOKS, getCarMediaLibraryBooks } from '@/components/CarMediaLibraryBridge';

const book = (overrides: Partial<Book>): Book => ({
  hash: 'hash',
  format: 'EPUB',
  title: 'Title',
  author: 'Author',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

describe('CarMediaLibraryBridge', () => {
  it('publishes recent playable books and excludes deleted or cloud-only rows', () => {
    const books = getCarMediaLibraryBooks(
      [
        book({ hash: 'older', title: 'Older', updatedAt: 10, downloadedAt: 10 }),
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

  // `downloadedAt` never syncs (see types/book.ts), so a row that arrived from
  // the cloud carries `undefined`, not `null`. A `!== null` test lets every one
  // of them through and the car offers books with no bytes on this device.
  it('excludes a synced row whose downloadedAt is undefined', () => {
    const books = getCarMediaLibraryBooks([
      book({ hash: 'synced', title: 'Synced', updatedAt: 10, downloadedAt: undefined }),
    ]);

    expect(books).toEqual([]);
  });

  it('keeps rows that are playable without a local download', () => {
    const books = getCarMediaLibraryBooks([
      book({ hash: 'filepath', title: 'On disk', updatedAt: 30, filePath: '/books/a.epub' }),
      book({ hash: 'url', title: 'Streamed', updatedAt: 20, url: 'https://example.com/a.epub' }),
      book({ hash: 'abs', title: 'Audiobookshelf', format: 'ABS', updatedAt: 10 }),
    ]);

    expect(books.map((b) => b.hash)).toEqual(['filepath', 'url', 'abs']);
  });

  // The browse tree is readable by any client that binds the exported
  // MediaBrowserService, so the published slice stays deliberately small.
  it('caps the published slice at the ten most recently updated books', () => {
    const library = Array.from({ length: MAX_CAR_MEDIA_BOOKS + 5 }, (_, index) =>
      book({
        hash: `book-${index}`,
        title: `Book ${index}`,
        updatedAt: index,
        downloadedAt: index + 1,
      }),
    );

    const books = getCarMediaLibraryBooks(library);

    expect(MAX_CAR_MEDIA_BOOKS).toBe(10);
    expect(books).toHaveLength(MAX_CAR_MEDIA_BOOKS);
    expect(books[0]!.hash).toBe(`book-${library.length - 1}`);
  });
});
