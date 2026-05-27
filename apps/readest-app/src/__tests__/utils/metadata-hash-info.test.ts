import { describe, it, expect } from 'vitest';
import { getMetadataHash, getMetadataHashInfo } from '@/utils/book';
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
});
