import { describe, it, expect } from 'vitest';
import type { Book } from '@/types/book';
import type { OPDSPublication } from '@/types/opds';
import { SYMBOL } from '@/types/opds';
import { getOPDSBookMetadata, applyOPDSMetadata } from '@/services/opds/metadata';

type PublicationMetadata = OPDSPublication['metadata'];

describe('getOPDSBookMetadata', () => {
  it('maps the fields the feed provides to BookMetadata', () => {
    const metadata: PublicationMetadata = {
      title: 'Feed Title',
      subtitle: 'Feed Subtitle',
      author: [
        { name: 'Jane Doe', links: [] },
        { name: 'John Smith', links: [] },
      ],
      publisher: 'Feed Press',
      published: '2020-01-02',
      language: 'fr',
      identifier: 'urn:isbn:9780316769488',
      subject: [{ name: 'Fantasy', code: 'FIC009000' }, { name: 'Adventure' }],
      [SYMBOL.CONTENT]: { value: '<p>A <b>fine</b> book.</p>', type: 'html' },
    };
    const result = getOPDSBookMetadata({ metadata });
    expect(result.title).toBe('Feed Title');
    expect(result.subtitle).toBe('Feed Subtitle');
    expect(result.author).toEqual(['Jane Doe', 'John Smith']);
    expect(result.publisher).toBe('Feed Press');
    expect(result.published).toBe('2020-01-02');
    expect(result.language).toBe('fr');
    expect(result.identifier).toBe('urn:isbn:9780316769488');
    expect(result.subject).toEqual(['Fantasy', 'Adventure']);
    expect(result.description).toContain('<b>fine</b>');
  });

  it('omits fields the feed does not provide', () => {
    expect(getOPDSBookMetadata({})).toEqual({});
    expect(getOPDSBookMetadata({ metadata: {} })).toEqual({});
    // Blank strings and empty lists are "not provided", not overrides.
    expect(getOPDSBookMetadata({ metadata: { title: '   ', author: [], subject: [] } })).toEqual(
      {},
    );
  });

  it('keeps a single author as a plain string', () => {
    const result = getOPDSBookMetadata({
      metadata: { author: [{ name: 'Solo Author', links: [] }] },
    });
    expect(result.author).toBe('Solo Author');
  });

  it('flattens person-shaped and string-shaped names (OPDS 2.0 JSON)', () => {
    // parsePublicationDocument casts raw JSON, where authors/publishers may be
    // plain strings rather than person objects.
    const metadata = {
      author: ['Plain Name'],
      publisher: [
        { name: 'Pub A', links: [] },
        { name: 'Pub B', links: [] },
      ],
    } as unknown as PublicationMetadata;
    const result = getOPDSBookMetadata({ metadata });
    expect(result.author).toBe('Plain Name');
    expect(result.publisher).toBe('Pub A, Pub B');
  });

  it('prefers typed content over the plain description and sanitizes it', () => {
    const metadata: PublicationMetadata = {
      description: 'plain fallback',
      [SYMBOL.CONTENT]: { value: '<p>rich</p><script>evil()</script>', type: 'html' },
    };
    const result = getOPDSBookMetadata({ metadata });
    expect(result.description).toContain('<p>rich</p>');
    expect(result.description).not.toContain('script');
    expect(result.description).not.toContain('plain fallback');

    const plainOnly = getOPDSBookMetadata({ metadata: { description: 'Just text' } });
    expect(plainOnly.description).toBe('Just text');

    const contentField = getOPDSBookMetadata({
      metadata: { content: { value: '<p>from content</p>', type: 'html' } },
    });
    expect(contentField.description).toContain('<p>from content</p>');
  });

  it('passes a language list through', () => {
    const result = getOPDSBookMetadata({ metadata: { language: ['de', 'en'] } });
    expect(result.language).toEqual(['de', 'en']);
  });

  it('falls back to the subject code when there is no label and accepts plain strings', () => {
    const withCode = getOPDSBookMetadata({ metadata: { subject: [{ code: 'sci-fi' }] } });
    expect(withCode.subject).toEqual(['sci-fi']);
    const plain = getOPDSBookMetadata({
      metadata: { subject: ['History'] as unknown as PublicationMetadata['subject'] },
    });
    expect(plain.subject).toEqual(['History']);
  });
});

describe('applyOPDSMetadata', () => {
  const createBook = (): Book =>
    ({
      hash: 'h1',
      format: 'EPUB',
      title: 'File Title',
      sourceTitle: 'File Title',
      author: 'File Author',
      primaryLanguage: 'en',
      metaHash: 'meta-1',
      metadata: {
        title: 'File Title',
        author: 'File Author',
        language: 'en',
        publisher: 'File Press',
        description: 'File description',
        series: 'File Series',
        seriesIndex: 2,
      },
      createdAt: 0,
      updatedAt: 0,
    }) as Book;

  it('applies feed fields over the file metadata and keeps file-only fields', () => {
    const book = createBook();
    applyOPDSMetadata(book, {
      title: 'Feed Title',
      author: ['Jane Doe', 'John Smith'],
      language: 'fr',
      subject: ['Fantasy'],
    });
    expect(book.metadata?.title).toBe('Feed Title');
    expect(book.metadata?.subject).toEqual(['Fantasy']);
    // Fields the feed omitted keep the file's values.
    expect(book.metadata?.publisher).toBe('File Press');
    expect(book.metadata?.series).toBe('File Series');
    expect(book.metadata?.seriesIndex).toBe(2);
    // Denormalized fields are re-derived from the merged metadata.
    expect(book.title).toBe('Feed Title');
    expect(book.primaryLanguage).toBe('fr');
    expect(book.author).toContain('Jane Doe');
    expect(book.author).toContain('John Smith');
  });

  it('keeps derived fields the feed says nothing about', () => {
    const book = createBook();
    // Simulates "Download Again" on a book whose title the user edited: the
    // edited title lives on book.title, not book.metadata.title.
    book.title = 'User Edited Title';
    applyOPDSMetadata(book, { description: '<p>New description</p>' });
    expect(book.metadata?.description).toBe('<p>New description</p>');
    expect(book.title).toBe('User Edited Title');
    expect(book.author).toBe('File Author');
    expect(book.primaryLanguage).toBe('en');
  });

  it('bumps the metadata sync clock so the change propagates like an edit', () => {
    const book = createBook();
    const before = Date.now();
    applyOPDSMetadata(book, { title: 'Feed Title' });
    expect(book.metadataUpdatedAt).toBeGreaterThanOrEqual(before);
    expect(book.updatedAt).toBe(book.metadataUpdatedAt);
  });

  it('is a no-op when the feed provided nothing', () => {
    const book = createBook();
    const snapshot = structuredClone(book);
    applyOPDSMetadata(book, {});
    expect(book).toEqual(snapshot);
  });

  it('never touches sourceTitle or metaHash', () => {
    const book = createBook();
    applyOPDSMetadata(book, { title: 'Feed Title' });
    expect(book.sourceTitle).toBe('File Title');
    expect(book.metaHash).toBe('meta-1');
  });

  it('derives the isbn from a urn:isbn identifier', () => {
    const book = createBook();
    applyOPDSMetadata(book, { identifier: 'urn:isbn:9780316769488' });
    expect(book.metadata?.identifier).toBe('urn:isbn:9780316769488');
    expect(book.metadata?.isbn).toBe('9780316769488');
  });
});
