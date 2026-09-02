import { describe, it, expect } from 'vitest';
import {
  findReadEraDocForBook,
  normalizeReadEraXPointer,
  parseReadEraBackup,
  parseReadEraPosition,
} from '@/utils/readera';

const position = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    ratio: 0.0288,
    configHash: -166378613,
    page: 6,
    pagesCount: 208,
    xPath: '/body/DocFragment[6]/body/html/body/p[2]/text().467',
    pageEnd: 7,
    ...extra,
  });

const backup = (docs: unknown[]) => JSON.stringify({ docs, colls: [], words: [] });

const littlePrince = {
  uri: 'sha-1:8808d7cb',
  data: {
    doc_format: 'EPUB',
    doc_active: 1,
    doc_delete_time: 0,
    doc_file_name_title: 'Antoine de Saint-Exupéry - The Little Prince (Illustrated)',
    doc_title: 'The Little Prince',
    doc_authors: 'Alan Wakeman',
    user_authors: 'Antoine de Saint-Exupéry',
    doc_file_size: 4920894,
    doc_position: position(),
  },
  bookmarks: [
    {
      note_type: 2,
      note_uri: 'bookmark-uri',
      note_body: 'Bookmark 1',
      note_data: position({ xPath: '/body/DocFragment[32]/body/html/body/p[28]/text().350' }),
      note_index: 0.58,
      note_page: 566,
      note_insert_time: 1662042803000,
      note_modified_time: 1662042803000,
    },
  ],
  citations: [
    {
      note_type: 3,
      note_uri: '24d579c5-f112-4b88-b7ab-7bf51cf16f77',
      note_body: 'All grown-ups used to be children once.',
      note_extra: 'my note',
      note_data: position({ xPathEnd: '/body/DocFragment[6]/body/html/body/p[2]/text().540' }),
      note_index: 0.0288,
      note_page: 6,
      note_mark: 2,
      note_insert_time: 1662042803762,
      note_modified_time: 1662042900000,
    },
  ],
  reviews: [],
  links: [],
};

describe('parseReadEraPosition', () => {
  it('parses the embedded JSON locator', () => {
    const parsed = parseReadEraPosition(position());
    expect(parsed).toEqual({
      ratio: 0.0288,
      page: 6,
      pagesCount: 208,
      xPath: '/body/DocFragment[6]/body/html/body/p[2]/text().467',
    });
  });

  it('keeps the range end when present', () => {
    const parsed = parseReadEraPosition(position({ xPathEnd: '/body/DocFragment[6]/body/p[3]' }));
    expect(parsed?.xPathEnd).toBe('/body/DocFragment[6]/body/p[3]');
  });

  it('returns undefined for malformed or missing input', () => {
    expect(parseReadEraPosition(undefined)).toBeUndefined();
    expect(parseReadEraPosition('not json')).toBeUndefined();
    expect(parseReadEraPosition('[]')).toBeUndefined();
  });
});

describe('parseReadEraBackup', () => {
  it('parses documents with their highlights and bookmarks', () => {
    const docs = parseReadEraBackup(backup([littlePrince]));
    expect(docs).toHaveLength(1);
    const doc = docs![0]!;
    expect(doc.format).toBe('EPUB');
    expect(doc.title).toBe('The Little Prince');
    expect(doc.fileName).toBe('Antoine de Saint-Exupéry - The Little Prince (Illustrated)');
    expect(doc.author).toBe('Antoine de Saint-Exupéry');
    expect(doc.position?.xPath).toContain('DocFragment[6]');

    expect(doc.citations).toHaveLength(1);
    const citation = doc.citations[0]!;
    expect(citation.body).toBe('All grown-ups used to be children once.');
    expect(citation.note).toBe('my note');
    expect(citation.mark).toBe(2);
    expect(citation.createdAt).toBe(1662042803762);
    expect(citation.updatedAt).toBe(1662042900000);
    expect(citation.position?.xPathEnd).toContain('text().540');

    expect(doc.bookmarks).toHaveLength(1);
    expect(doc.bookmarks[0]!.position?.xPath).toContain('DocFragment[32]');
  });

  it('skips documents the user deleted in ReadEra', () => {
    const deleted = {
      ...littlePrince,
      data: { ...littlePrince.data, doc_active: 0, doc_delete_time: 1768035669083 },
    };
    expect(parseReadEraBackup(backup([deleted]))).toHaveLength(0);
  });

  it('returns null for anything that is not a ReadEra backup', () => {
    expect(parseReadEraBackup('not json')).toBeNull();
    expect(parseReadEraBackup('{"annotations":[]}')).toBeNull();
    expect(parseReadEraBackup('[]')).toBeNull();
  });
});

describe('normalizeReadEraXPointer', () => {
  it('drops the source body ReadEra keeps inside the fragment', () => {
    expect(normalizeReadEraXPointer('/body/DocFragment[6]/body/body/p[2]/text().467')).toBe(
      '/body/DocFragment[6]/body/p[2]/text().467',
    );
  });

  it('drops the html/body wrapper CREngine keeps on older DOM versions', () => {
    expect(normalizeReadEraXPointer('/body/DocFragment[6]/body/html/body/p[2]/text().467')).toBe(
      '/body/DocFragment[6]/body/p[2]/text().467',
    );
  });

  it('drops autoBoxing pseudo elements that only exist in the CREngine DOM', () => {
    expect(
      normalizeReadEraXPointer('/body/DocFragment[3]/body/body/p[3]/autoBoxing/span[3]/text().447'),
    ).toBe('/body/DocFragment[3]/body/p[3]/span[3]/text().447');
    expect(
      normalizeReadEraXPointer(
        '/body/DocFragment[3]/body/body/p[3]/autoBoxing[2]/span[1]/text().4',
      ),
    ).toBe('/body/DocFragment[3]/body/p[3]/span[1]/text().4');
  });

  it('leaves a plain KOReader-shaped XPointer untouched', () => {
    const xpointer = '/body/DocFragment[9]/body/p[27]/text()[2].503';
    expect(normalizeReadEraXPointer(xpointer)).toBe(xpointer);
  });
});

describe('findReadEraDocForBook', () => {
  const docs = parseReadEraBackup(backup([littlePrince]))!;

  it('matches on the metadata title', () => {
    expect(findReadEraDocForBook(docs, { title: 'The Little Prince', format: 'EPUB' })).toBe(
      docs[0],
    );
  });

  it('matches when the ReadEra file name embeds the title', () => {
    expect(
      findReadEraDocForBook(docs, {
        title: 'The Little Prince (Illustrated)',
        author: 'Antoine de Saint-Exupéry',
        format: 'EPUB',
      }),
    ).toBe(docs[0]);
  });

  it('rejects a book of a different format', () => {
    expect(findReadEraDocForBook(docs, { title: 'The Little Prince', format: 'PDF' })).toBeNull();
  });

  it('rejects an unrelated book', () => {
    expect(findReadEraDocForBook(docs, { title: 'Moby Dick', format: 'EPUB' })).toBeNull();
  });

  it('prefers the candidate carrying annotations when titles tie', () => {
    const empty = {
      ...littlePrince,
      uri: 'sha-1:other',
      citations: [],
      bookmarks: [],
    };
    const both = parseReadEraBackup(backup([empty, littlePrince]))!;
    const match = findReadEraDocForBook(both, { title: 'The Little Prince', format: 'EPUB' });
    expect(match?.citations).toHaveLength(1);
  });
});
