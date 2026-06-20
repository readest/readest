import { describe, expect, it } from 'vitest';

import { getBookWithUpdatedMetadata } from '@/utils/book';
import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';

const makeBook = (): Book =>
  ({
    hash: 'abc123',
    format: 'EPUB',
    title: 'Old Title',
    author: 'Old Author',
    coverImageUrl: 'old-cover-url',
    updatedAt: 1000,
    primaryLanguage: 'en',
    metadata: {
      title: 'Old Title',
      author: 'Old Author',
      language: 'en',
      coverImageUrl: 'old-cover-url',
    },
  }) as Book;

describe('getBookWithUpdatedMetadata', () => {
  it('returns a new book object without mutating the input', () => {
    const book = makeBook();
    const editedMeta: BookMetadata = {
      title: 'New Title',
      author: 'New Author',
      language: 'fr',
      coverImageUrl: 'new-cover-url',
    };

    const updated = getBookWithUpdatedMetadata(book, editedMeta);

    // A fresh reference is required so React.memo'd <BookCover> detects the
    // change. The original cover-refresh bug mutated `book` in place, so the
    // memo's previous snapshot pointed to the same object and skipped re-render.
    expect(updated).not.toBe(book);
    expect(updated.metadata).not.toBe(book.metadata);

    // Input must be left untouched.
    expect(book.title).toBe('Old Title');
    expect(book.author).toBe('Old Author');
    expect(book.coverImageUrl).toBe('old-cover-url');
    expect(book.updatedAt).toBe(1000);
    expect(book.metadata?.coverImageUrl).toBe('old-cover-url');
  });

  it('applies the edited cover, title, author, language and a fresh updatedAt', () => {
    const book = makeBook();
    const editedMeta: BookMetadata = {
      title: 'New Title',
      author: 'New Author',
      language: 'fr',
      coverImageUrl: 'new-cover-url',
    };

    const updated = getBookWithUpdatedMetadata(book, editedMeta);

    expect(updated.coverImageUrl).toBe('new-cover-url');
    expect(updated.title).toBe('New Title');
    expect(updated.author).toBe('New Author');
    expect(updated.primaryLanguage).toBe('fr');
    expect(updated.updatedAt).toBeGreaterThan(book.updatedAt);
  });

  it('prefers a blob cover URL over the plain cover URL', () => {
    const book = makeBook();
    const editedMeta: BookMetadata = {
      title: 'Old Title',
      author: 'Old Author',
      language: 'en',
      coverImageBlobUrl: 'blob:new-cover',
      coverImageUrl: 'http-cover-url',
    };

    const updated = getBookWithUpdatedMetadata(book, editedMeta);

    expect(updated.coverImageUrl).toBe('blob:new-cover');
  });

  it('keeps the existing cover when the edit does not change it', () => {
    const book = makeBook();
    const editedMeta: BookMetadata = {
      title: 'New Title',
      author: 'Old Author',
      language: 'en',
    };

    const updated = getBookWithUpdatedMetadata(book, editedMeta);

    expect(updated.coverImageUrl).toBe('old-cover-url');
  });
});
