import { describe, it, expect } from 'vitest';
import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';
import { OPDSPublication } from '@/types/opds';
import { findExistingBookForPublication } from '@/app/opds/utils/findExistingBook';
import { getMetadataHash } from '@/utils/book';

// Build a Book whose metadata mirrors what bookService imported from the
// EPUB's internal Dublin Core block. findExistingBookForPublication needs
// `metadata` (it fingerprints with getMetadataHashInfo), not the top-level
// title/author fields, so the fixture sets both.
const makeBook = (metadata: Partial<BookMetadata>, overrides: Partial<Book> = {}): Book => {
  const fullMetadata: BookMetadata = {
    title: '',
    author: '',
    language: '',
    ...metadata,
  };
  return {
    hash: overrides.hash ?? 'h',
    format: 'EPUB',
    title: (typeof fullMetadata.title === 'string' ? fullMetadata.title : '') || '',
    author: typeof fullMetadata.author === 'string' ? fullMetadata.author : '',
    metadata: fullMetadata,
    metaHash: getMetadataHash(fullMetadata),
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
};

// Loose author shape for OPDS fixtures — the production OPDSPerson type
// requires a `links` array which is irrelevant to identity matching. We
// accept the loose shape and fill in defaults in makePublication.
type FixtureAuthor = { name: string };
type FixtureMetadata = Omit<Partial<OPDSPublication['metadata']>, 'author'> & {
  author?: FixtureAuthor[];
};

const makePublication = (overrides: FixtureMetadata): OPDSPublication => {
  const { author, ...rest } = overrides;
  const normalizedAuthor = author?.map((a) => ({ links: [], ...a }));
  return {
    metadata: { ...rest, ...(normalizedAuthor ? { author: normalizedAuthor } : {}) },
    links: [],
    images: [],
  };
};

describe('findExistingBookForPublication', () => {
  it('returns null when library is empty', () => {
    const pub = makePublication({
      title: 'Pride and Prejudice',
      author: [{ name: 'Jane Austen' }],
    });
    expect(findExistingBookForPublication(pub, [])).toBeNull();
    expect(findExistingBookForPublication(pub, null)).toBeNull();
    expect(findExistingBookForPublication(pub, undefined)).toBeNull();
  });

  it('returns null when publication is null/undefined', () => {
    expect(findExistingBookForPublication(null, [makeBook({ title: 'x' })])).toBeNull();
    expect(findExistingBookForPublication(undefined, [makeBook({ title: 'x' })])).toBeNull();
  });

  it('returns null when publication has no usable metadata', () => {
    const pub = makePublication({});
    const library = [makeBook({ title: 'Pride and Prejudice', author: 'Jane Austen' })];
    expect(findExistingBookForPublication(pub, library)).toBeNull();
  });

  it('matches when both sides share the same metaHash (title + author agree)', () => {
    const pub = makePublication({
      title: 'Pride and Prejudice',
      author: [{ name: 'Jane Austen' }],
    });
    const library = [
      makeBook({ title: 'Other Book', author: 'Other Author' }, { hash: 'a' }),
      makeBook({ title: 'Pride and Prejudice', author: 'Jane Austen' }, { hash: 'b' }),
    ];
    expect(findExistingBookForPublication(pub, library)?.hash).toBe('b');
  });

  it('matches Gutenberg-style entries via identifier overlap even when author names differ', () => {
    // OPDS feed publishes "Austen, Jane" + urn:gutenberg:1342.
    // EPUB internal metadata stores "Jane Austen" + a Gutenberg URL identifier.
    // Both normalize to identifier "1342" through the bookService helpers.
    const pub = makePublication({
      title: 'Pride and Prejudice',
      author: [{ name: 'Austen, Jane' }],
      identifier: 'urn:gutenberg:1342',
    });
    const library = [
      makeBook(
        {
          title: 'Pride and Prejudice',
          author: 'Jane Austen',
          identifier: 'http://www.gutenberg.org/ebooks/1342',
        },
        { hash: 'gut' },
      ),
    ];
    const found = findExistingBookForPublication(pub, library);
    expect(found?.hash).toBe('gut');
  });

  it('matches by normalized identifier even when normalized titles differ', () => {
    const pub = makePublication({
      title: 'Pride & Prejudice',
      author: [{ name: 'Jane Austen' }],
      identifier: 'urn:isbn:9780000000001',
    });
    const library = [
      makeBook(
        {
          title: 'Pride and Prejudice',
          author: 'Jane Austen',
          identifier: '9780000000001',
        },
        { hash: 'isbn' },
      ),
    ];
    expect(findExistingBookForPublication(pub, library)?.hash).toBe('isbn');
  });

  it('falls back to title + author overlap when no identifier is shared', () => {
    const pub = makePublication({
      title: 'Some Title',
      author: [{ name: 'Author One' }],
    });
    const library = [
      makeBook(
        {
          title: 'some title',
          author: 'author one',
        },
        { hash: 't' },
      ),
    ];
    const found = findExistingBookForPublication(pub, library);
    expect(found?.hash).toBe('t');
  });

  it('skips soft-deleted books even when they would otherwise match', () => {
    const pub = makePublication({
      title: 'Pride and Prejudice',
      author: [{ name: 'Jane Austen' }],
    });
    const library = [
      makeBook(
        { title: 'Pride and Prejudice', author: 'Jane Austen' },
        { hash: 'deleted', deletedAt: Date.now() },
      ),
    ];
    expect(findExistingBookForPublication(pub, library)).toBeNull();
  });

  it('accepts title-only match when neither side has any author', () => {
    const pub = makePublication({ title: 'Anonymous Work' });
    const library = [makeBook({ title: 'Anonymous Work', author: '' }, { hash: 'a' })];
    expect(findExistingBookForPublication(pub, library)?.hash).toBe('a');
  });

  it('does not match same-title-different-author books when no identifier overlap', () => {
    const pub = makePublication({
      title: 'Untitled',
      author: [{ name: 'Author A' }],
    });
    const library = [makeBook({ title: 'Untitled', author: 'Author B' }, { hash: 'x' })];
    expect(findExistingBookForPublication(pub, library)).toBeNull();
  });

  it('matches multi-author books when at least one author name overlaps', () => {
    const pub = makePublication({
      title: 'Co-Authored',
      author: [{ name: 'Author One' }, { name: 'Author Two' }],
    });
    const library = [makeBook({ title: 'Co-Authored', author: 'Author Two' }, { hash: 'm' })];
    expect(findExistingBookForPublication(pub, library)?.hash).toBe('m');
  });

  it('strips URN/scheme prefixes consistently across both sides', () => {
    const pub = makePublication({
      title: 'Some Book',
      author: [{ name: 'Some Author' }],
      identifier: 'urn:uuid:1234-5678',
    });
    const library = [
      makeBook(
        {
          title: 'Some Book',
          author: 'Some Author',
          identifier: 'uuid:1234-5678',
        },
        { hash: 'u' },
      ),
    ];
    expect(findExistingBookForPublication(pub, library)?.hash).toBe('u');
  });

  // Real-world regression: Gutenberg's mobile OPDS feed never emits
  // <dc:identifier>; the only ID is in <atom:id> as 'urn:gutenberg:1342:2'
  // (note the trailing ':2' version suffix). The EPUB inside ships
  // <dc:identifier>http://www.gutenberg.org/1342</dc:identifier>. Authors
  // also disagree: feed says "Austen, Jane", EPUB dc:creator is
  // "Jane Austen". Without merging atom id into identifier candidates and
  // doing token-based author overlap, this case silently fell back to
  // "Download" even after the book was downloaded.
  it('matches a Gutenberg book whose OPDS id is in <atom:id> only', () => {
    const pub = makePublication({
      id: 'urn:gutenberg:1342:2',
      title: 'Pride and Prejudice',
      author: [{ name: 'Austen, Jane' }],
    });
    const library = [
      makeBook(
        {
          title: 'Pride and Prejudice',
          author: 'Jane Austen',
          identifier: 'http://www.gutenberg.org/1342',
        },
        { hash: 'gut1342' },
      ),
    ];
    expect(findExistingBookForPublication(pub, library)?.hash).toBe('gut1342');
  });

  it('matches "Lastname, Firstname" against "Firstname Lastname" via token overlap', () => {
    const pub = makePublication({
      title: 'The Book',
      author: [{ name: 'Doe, John' }],
    });
    const library = [makeBook({ title: 'The Book', author: 'John Doe' }, { hash: 'd' })];
    expect(findExistingBookForPublication(pub, library)?.hash).toBe('d');
  });

  it('drops year-range tokens like "Austen, Jane, 1775-1817" in author comparison', () => {
    const pub = makePublication({
      title: 'P&P',
      author: [{ name: 'Austen, Jane, 1775-1817' }],
    });
    const library = [makeBook({ title: 'P&P', author: 'Jane Austen' }, { hash: 'y' })];
    expect(findExistingBookForPublication(pub, library)?.hash).toBe('y');
  });

  it('does not match "Author A" vs "Author B" via collapsed single-letter tokens', () => {
    const pub = makePublication({
      title: 'Shared Title',
      author: [{ name: 'Author A' }],
    });
    const library = [makeBook({ title: 'Shared Title', author: 'Author B' }, { hash: 'z' })];
    expect(findExistingBookForPublication(pub, library)).toBeNull();
  });

  it('atom-id matching ignores the trailing version suffix on Gutenberg URNs', () => {
    // urn:gutenberg:1342:7 → digit-tail key is '1342' (longest >=3-digit
    // run, the trailing ':7' is too short), matching the EPUB's
    // 'http://www.gutenberg.org/1342' which yields '1342' the same way.
    const pub = makePublication({
      id: 'urn:gutenberg:1342:7',
      title: 'Pride and Prejudice',
      author: [{ name: 'Austen, Jane' }],
    });
    const library = [
      makeBook(
        {
          title: 'Pride and Prejudice',
          author: 'Jane Austen',
          identifier: 'http://www.gutenberg.org/1342',
        },
        { hash: 'gut' },
      ),
    ];
    expect(findExistingBookForPublication(pub, library)?.hash).toBe('gut');
  });
});
