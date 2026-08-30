import { describe, it, expect } from 'vitest';
import { getMetadataHash, getMetadataHashInfo, getStableMetadataHash } from '@/utils/book';
import type { BookMetadata } from '@/libs/document';

describe('getMetadataHashInfo', () => {
  it('returns hash plus the inputs used to compute it', () => {
    const metadata: BookMetadata = {
      title: 'The Great Gatsby',
      author: 'F. Scott Fitzgerald',
      language: 'en',
      identifier: 'urn:isbn:9780743273565',
    };

    const info = getMetadataHashInfo(metadata);

    expect(info).toBeDefined();
    expect(info!.title).toBe('The Great Gatsby');
    expect(info!.authors).toEqual(['F. Scott Fitzgerald']);
    expect(info!.identifiers).toEqual(['9780743273565']);
    expect(info!.metaHash).toBe(getMetadataHash(metadata));
    expect(info!.hashSource).toBe('The Great Gatsby|F. Scott Fitzgerald|9780743273565');
  });

  it('prefers altIdentifier over identifier', () => {
    const info = getMetadataHashInfo({
      title: 'Book',
      author: 'Author',
      language: 'en',
      identifier: 'urn:isbn:1234567890',
      altIdentifier: 'uuid:abc-123',
    });

    expect(info!.identifiers).toEqual(['abc-123']);
  });

  it('handles LanguageMap titles and Contributor authors', () => {
    const info = getMetadataHashInfo({
      title: { en: 'Hello', ja: 'こんにちは' },
      author: [{ name: { en: 'Alice' } }, { name: { en: 'Bob' } }],
      language: 'en',
    } as unknown as BookMetadata);

    expect(info!.title).toBe('Hello');
    expect(info!.authors).toEqual(['Alice', 'Bob']);
    expect(info!.identifiers).toEqual([]);
  });

  it('returns undefined when metadata is missing required fields', () => {
    const info = getMetadataHashInfo(null as unknown as BookMetadata);
    expect(info).toBeUndefined();
  });

  describe('with a filename salt (issue #5411)', () => {
    const metadata: BookMetadata = {
      title: 'PowerPoint Presentation',
      author: 'Alice Author',
      language: 'en',
    };

    it('produces different hashes for the same metadata under different filenames', () => {
      expect(getMetadataHash(metadata, 'lecture-01')).not.toBe(
        getMetadataHash(metadata, 'lecture-02'),
      );
    });

    it('produces the same hash for the same metadata and filename', () => {
      expect(getMetadataHash(metadata, 'lecture-01')).toBe(getMetadataHash(metadata, 'lecture-01'));
    });

    it('appends the filename to the hash source', () => {
      const info = getMetadataHashInfo(metadata, 'lecture-01');
      expect(info!.hashSource).toBe('PowerPoint Presentation|Alice Author||lecture-01');
    });

    it('leaves the hash unchanged when no filename is given', () => {
      const info = getMetadataHashInfo(metadata);
      expect(info!.hashSource).toBe('PowerPoint Presentation|Alice Author|');
    });
  });
});

// Issue #5959: calibre (and therefore every AO3 / FanFicFare download) mints a
// fresh random UUID into dc:identifier on every export, so the same work
// re-downloaded after an update hashes differently and imports as a new book.
// getMetadataHash itself must not change - it is the wire key shared with the
// sync server and the KOReader plugin (meta_hash_v1) - so the re-import path
// gets a second, volatile-identifier-free key instead.
describe('getStableMetadataHash', () => {
  const withIdentifier = (identifier: string): BookMetadata => ({
    title: 'The Amazing Traveling Circus Part 2 - The Golden Butterfly',
    author: 'KicsterAsh',
    language: 'en',
    altIdentifier: identifier,
  });

  it('collapses two exports of the same book that differ only by a random uuid', () => {
    const first = withIdentifier('urn:uuid:08bc8344-c0c9-485c-afcb-c15202570205');
    const second = withIdentifier('urn:uuid:d559a18b-88fa-4560-9f1d-4922e2471ba4');

    // The shipped hash keeps them apart - that is the bug being worked around.
    expect(getMetadataHash(first)).not.toBe(getMetadataHash(second));

    expect(getStableMetadataHash(first)).toBeDefined();
    expect(getStableMetadataHash(first)).toBe(getStableMetadataHash(second));
  });

  it('accepts a bare uuid and a { scheme, value } identifier as volatile too', () => {
    const bare = withIdentifier('9ad3ec1e-1f1e-4a58-9f0a-2a9d1a8ef111');
    const urn = withIdentifier('urn:uuid:9ad3ec1e-1f1e-4a58-9f0a-2a9d1a8ef111');
    const scoped = {
      ...withIdentifier(''),
      altIdentifier: { scheme: 'uuid', value: '9ad3ec1e-1f1e-4a58-9f0a-2a9d1a8ef111' },
    } as unknown as BookMetadata;

    expect(getStableMetadataHash(bare)).toBe(getStableMetadataHash(urn));
    expect(getStableMetadataHash(scoped)).toBe(getStableMetadataHash(urn));
  });

  it('returns undefined when no identifier is volatile', () => {
    expect(getStableMetadataHash(withIdentifier('urn:isbn:9780743273565'))).toBeUndefined();
    expect(
      getStableMetadataHash({
        title: 'Untitled',
        author: 'Nobody',
        language: 'en',
      }),
    ).toBeUndefined();
  });

  it('keeps a stable identifier that sits alongside the volatile uuid', () => {
    const a = {
      title: 'Book',
      author: 'Author',
      language: 'en',
      altIdentifier: ['urn:uuid:1111aaaa-1111-4111-8111-111111111111', 'urn:isbn:9780000000001'],
    } as unknown as BookMetadata;
    const b = {
      title: 'Book',
      author: 'Author',
      language: 'en',
      altIdentifier: ['urn:uuid:2222bbbb-2222-4222-8222-222222222222', 'urn:isbn:9780000000002'],
    } as unknown as BookMetadata;

    expect(getStableMetadataHash(a)).toBeDefined();
    expect(getStableMetadataHash(a)).not.toBe(getStableMetadataHash(b));
  });

  it('keeps books with different titles or authors apart', () => {
    const uuid = 'urn:uuid:3333cccc-3333-4333-8333-333333333333';
    const base = { language: 'en', altIdentifier: uuid };

    const one = { ...base, title: 'Volume 1', author: 'Author' } as unknown as BookMetadata;
    const two = { ...base, title: 'Volume 2', author: 'Author' } as unknown as BookMetadata;
    const three = { ...base, title: 'Volume 1', author: 'Other' } as unknown as BookMetadata;

    expect(getStableMetadataHash(one)).not.toBe(getStableMetadataHash(two));
    expect(getStableMetadataHash(one)).not.toBe(getStableMetadataHash(three));
  });
});
