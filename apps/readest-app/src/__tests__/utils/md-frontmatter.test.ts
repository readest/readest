import { describe, it, expect } from 'vitest';
import { frontmatterToMetadata, parseFrontmatter } from '@/utils/mdFrontmatter';

// A 1x1 transparent GIF, small enough to keep inline.
const GIF_B64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const GIF_URI = `data:image/gif;base64,${GIF_B64}`;

const fm = (block: string, body = '# Body\n') => parseFrontmatter(`---\n${block}\n---\n${body}`);

describe('parseFrontmatter', () => {
  it('returns the text untouched when there is no frontmatter block', () => {
    const { body, fields } = parseFrontmatter('# Title\n\ntext\n');
    expect(body).toBe('# Title\n\ntext\n');
    expect(fields).toEqual({});
  });

  it('strips the block from the body and reads scalar keys', () => {
    const { body, fields } = fm('title: Moby Dick\nauthor: Herman Melville');
    expect(body).toBe('# Body\n');
    expect(fields).toEqual({ title: 'Moby Dick', author: 'Herman Melville' });
  });

  it('tolerates a BOM, CRLF line endings and padded delimiters', () => {
    const { body, fields } = parseFrontmatter('﻿---  \r\ntitle: A\r\n--- \r\n# Body\r\n');
    expect(fields).toEqual({ title: 'A' });
    expect(body).toBe('# Body\r\n');
  });

  it('normalizes keys by case and by dropping dashes and underscores', () => {
    const { fields } = fm('ISBN: 1\nCover-Image: 2\nseries_index: 3');
    expect(fields).toEqual({ isbn: '1', coverimage: '2', seriesindex: '3' });
  });

  it('reads block lists', () => {
    const { fields } = fm('tags:\n  - fiction\n  - classics\nauthor: Melville');
    expect(fields['tags']).toEqual(['fiction', 'classics']);
    expect(fields['author']).toBe('Melville');
  });

  it('reads flow lists, including an empty one', () => {
    const { fields } = fm('tags: [fiction, "sea stories"]\nkeywords: []');
    expect(fields['tags']).toEqual(['fiction', 'sea stories']);
    expect(fields['keywords']).toEqual([]);
  });

  it('skips full-line comments and blank lines', () => {
    const { fields } = fm('# a comment\n\ntitle: A\n   # indented comment\nauthor: B');
    expect(fields).toEqual({ title: 'A', author: 'B' });
  });

  it('strips a trailing comment only when whitespace precedes the hash', () => {
    const { fields } = fm('title: A  # the title\ncover: http://h/i.jpg#frag');
    expect(fields['title']).toBe('A');
    expect(fields['cover']).toBe('http://h/i.jpg#frag');
  });

  it('strips only matched surrounding quotes', () => {
    const { fields } = fm(`title: "A Book"\nauthor: 'Jane'\nseries: don't\npublisher: "half`);
    expect(fields['title']).toBe('A Book');
    expect(fields['author']).toBe('Jane');
    expect(fields['series']).toBe("don't");
    expect(fields['publisher']).toBe('"half');
  });

  it('keeps a quoted value intact, comment marker and all', () => {
    const { fields } = fm('title: "A # B"');
    expect(fields['title']).toBe('A # B');
  });

  it('keeps a long unwrapped data URI intact', () => {
    const { fields } = fm(`cover: ${GIF_URI}`);
    expect(fields['cover']).toBe(GIF_URI);
  });

  it('ignores unsupported constructs instead of throwing', () => {
    const { body, fields } = fm('description: |\n  line one\n  line two\ntitle: A');
    expect(fields['title']).toBe('A');
    expect(body).toBe('# Body\n');
  });

  it('drops keys with no value and no list items', () => {
    const { fields } = fm('title: A\npublisher:\nauthor: B');
    expect(fields).toEqual({ title: 'A', author: 'B' });
  });

  it('does not treat a horizontal rule mid-document as frontmatter', () => {
    const { body, fields } = parseFrontmatter('# Title\n\n---\n\ntext\n');
    expect(fields).toEqual({});
    expect(body).toBe('# Title\n\n---\n\ntext\n');
  });

  it('leaves an unterminated block alone', () => {
    const { body, fields } = parseFrontmatter('---\ntitle: A\n\n# Body\n');
    expect(fields).toEqual({});
    expect(body).toBe('---\ntitle: A\n\n# Body\n');
  });
});

describe('frontmatterToMetadata', () => {
  const map = (block: string) => frontmatterToMetadata(fm(block).fields);

  it('returns nothing for an empty frontmatter', () => {
    const { metadata, coverBlob } = frontmatterToMetadata({});
    expect(metadata).toEqual({});
    expect(coverBlob).toBeNull();
  });

  it('maps every supported field', () => {
    const { metadata } = map(
      [
        'title: Moby Dick',
        'subtitle: The Whale',
        'author: Herman Melville',
        'isbn: 979-8985322538',
        'identifier: urn:uuid:1234',
        'language: fr',
        'publisher: Harper',
        'published: 1851-10-18',
        'description: A whale of a book',
        'tags: [fiction, classics]',
        'series: Sea Tales',
        'series_index: 2',
      ].join('\n'),
    );
    expect(metadata).toEqual({
      title: 'Moby Dick',
      subtitle: 'The Whale',
      author: 'Herman Melville',
      isbn: '979-8985322538',
      identifier: 'urn:uuid:1234',
      language: 'fr',
      publisher: 'Harper',
      published: '1851-10-18',
      description: 'A whale of a book',
      subject: ['fiction', 'classics'],
      series: 'Sea Tales',
      seriesIndex: 2,
    });
  });

  it('accepts each documented key alias', () => {
    expect(map('authors: A').metadata.author).toBe('A');
    expect(map('lang: de').metadata.language).toBe('de');
    expect(map('date: 2020').metadata.published).toBe('2020');
    expect(map('pubdate: 2021').metadata.published).toBe('2021');
    expect(map('summary: s').metadata.description).toBe('s');
    expect(map('subject: [a]').metadata.subject).toEqual(['a']);
    expect(map('keywords: [a]').metadata.subject).toEqual(['a']);
  });

  it('keeps multiple authors as an array', () => {
    const { metadata } = map('author:\n  - Jane Doe\n  - John Roe');
    expect(metadata.author).toEqual(['Jane Doe', 'John Roe']);
  });

  it('drops a series index that is not a finite number', () => {
    expect(map('series_index: 1.5').metadata.seriesIndex).toBe(1.5);
    expect(map('series_index: two').metadata.seriesIndex).toBeUndefined();
  });

  it('collapses a single-item list back to a scalar for scalar-only fields', () => {
    expect(map('title:\n  - Only').metadata.title).toBe('Only');
  });

  it('wraps a scalar into an array for list-valued fields', () => {
    expect(map('tags: fiction').metadata.subject).toEqual(['fiction']);
  });

  it('ignores blank values', () => {
    expect(map('title: ""\nauthor: "  "').metadata).toEqual({});
  });

  it('decodes a base64 data URI cover into a blob of the declared type', async () => {
    const { metadata, coverBlob } = map(`cover: ${GIF_URI}`);
    expect(metadata.coverImageUrl).toBeUndefined();
    expect(coverBlob).toBeInstanceOf(Blob);
    expect(coverBlob!.type).toBe('image/gif');
    const bytes = new Uint8Array(await coverBlob!.arrayBuffer());
    expect(bytes.length).toBe(42);
    expect(Array.from(bytes.slice(0, 3))).toEqual([0x47, 0x49, 0x46]); // GIF
  });

  it('decodes a percent-encoded data URI cover', async () => {
    const { coverBlob } = map('cover: "data:image/svg+xml,%3Csvg%2F%3E"');
    expect(coverBlob!.type).toBe('image/svg+xml');
    expect(await coverBlob!.text()).toBe('<svg/>');
  });

  it('defaults a data URI with no media type to text/plain, per RFC 2397', async () => {
    const { coverBlob } = map('cover: data:,hi');
    expect(coverBlob!.type).toBe('text/plain');
    expect(await coverBlob!.text()).toBe('hi');
  });

  it('keeps an http(s) cover as a URL instead of downloading it', () => {
    const url = 'https://m.media-amazon.com/images/I/71JB5kFNJ5L._SL1500_.jpg';
    const { metadata, coverBlob } = map(`cover: ${url}`);
    expect(metadata.coverImageUrl).toBe(url);
    expect(coverBlob).toBeNull();
  });

  it('accepts the cover_image and image aliases', () => {
    expect(map('cover_image: https://h/a.jpg').metadata.coverImageUrl).toBe('https://h/a.jpg');
    expect(map('image: http://h/b.jpg').metadata.coverImageUrl).toBe('http://h/b.jpg');
  });

  it('prefers cover over its aliases when several are present', () => {
    const { metadata } = map('image: https://h/b.jpg\ncover: https://h/a.jpg');
    expect(metadata.coverImageUrl).toBe('https://h/a.jpg');
  });

  it('ignores a relative cover path, which a standalone file cannot resolve', () => {
    const { metadata, coverBlob } = map('cover: ./images/cover.png');
    expect(metadata.coverImageUrl).toBeUndefined();
    expect(coverBlob).toBeNull();
  });

  it('ignores a malformed data URI instead of throwing', () => {
    expect(map('cover: data:image/png;base64,!!!not base64!!!').coverBlob).toBeNull();
    expect(map('cover: data:image/png;base64').coverBlob).toBeNull();
  });
});
