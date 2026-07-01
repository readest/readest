import { describe, it, expect, vi } from 'vitest';

// opdsPublication -> opdsUtils -> opdsReq pulls in the tauri http plugin and the
// environment helpers at module load. Stub them so the pure parsing utilities
// can be imported in jsdom. foliate-js is intentionally NOT mocked so the real
// getPublication parses Atom entries.
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/services/environment', () => ({
  isWebAppPlatform: vi.fn(() => false),
  isTauriAppPlatform: vi.fn(() => false),
  getAPIBaseUrl: () => '/api',
  getNodeAPIBaseUrl: () => '/node-api',
}));

import { SYMBOL, type OPDSPublication } from '@/types/opds';
import {
  getPublicationDetailHref,
  parsePublicationDocument,
} from '@/app/opds/utils/opdsPublication';

const pubWithLinks = (links: OPDSPublication['links']): OPDSPublication => ({
  metadata: { title: 'T' },
  links,
  images: [],
});

describe('getPublicationDetailHref', () => {
  it('finds an OPDS 2.0 publication self link', () => {
    const pub = pubWithLinks([
      {
        rel: 'self',
        href: 'http://example.org/publication.json',
        type: 'application/opds-publication+json',
      },
    ]);
    expect(getPublicationDetailHref(pub)).toEqual({
      href: 'http://example.org/publication.json',
      type: 'application/opds-publication+json',
    });
  });

  it('finds an Atom entry self link (type=entry)', () => {
    const pub = pubWithLinks([
      {
        rel: ['self'],
        href: '/entry/1',
        type: 'application/atom+xml;type=entry;profile=opds-catalog',
      },
    ]);
    expect(getPublicationDetailHref(pub)?.href).toBe('/entry/1');
  });

  it('ignores a self link that is not a publication document', () => {
    const pub = pubWithLinks([
      { rel: 'self', href: '/feed', type: 'application/atom+xml;profile=opds-catalog' },
    ]);
    expect(getPublicationDetailHref(pub)).toBeUndefined();
  });

  it('ignores acquisition and cover links', () => {
    const pub = pubWithLinks([
      { rel: 'http://opds-spec.org/acquisition', href: '/book.epub', type: 'application/epub+zip' },
      { rel: 'http://opds-spec.org/image', href: '/cover.jpg', type: 'image/jpeg' },
    ]);
    expect(getPublicationDetailHref(pub)).toBeUndefined();
  });

  it('returns undefined when there are no links', () => {
    expect(getPublicationDetailHref(pubWithLinks([]))).toBeUndefined();
  });
});

describe('parsePublicationDocument', () => {
  it('parses an OPDS 2.0 JSON publication and resolves relative hrefs', () => {
    const json = JSON.stringify({
      metadata: {
        title: 'Full Title',
        description: 'A complete description only present in the publication document.',
        publisher: 'ACME',
      },
      links: [
        {
          rel: 'http://opds-spec.org/acquisition',
          href: 'book.epub',
          type: 'application/epub+zip',
        },
      ],
      images: [{ href: 'cover.jpg', type: 'image/jpeg' }],
    });
    const pub = parsePublicationDocument(json, 'http://example.org/pubs/1.json');
    expect(pub).not.toBeNull();
    expect(pub!.metadata.description).toContain('complete description');
    expect(pub!.metadata.publisher).toBe('ACME');
    expect(pub!.links[0]!.href).toBe('http://example.org/pubs/book.epub');
    expect(pub!.images[0]!.href).toBe('http://example.org/pubs/cover.jpg');
  });

  it('parses an Atom entry document and absolutizes acquisition links', () => {
    const xml = `<?xml version="1.0"?>
      <entry xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <title>Atom Full Title</title>
        <summary>A full summary.</summary>
        <dc:publisher>Tor</dc:publisher>
        <link rel="http://opds-spec.org/acquisition" href="download/book.epub" type="application/epub+zip"/>
      </entry>`;
    const pub = parsePublicationDocument(xml, 'http://example.org/entry/');
    expect(pub).not.toBeNull();
    expect(pub!.metadata.title).toBe('Atom Full Title');
    expect(pub!.metadata[SYMBOL.CONTENT]?.value).toBe('A full summary.');
    expect(pub!.links[0]!.href).toBe('http://example.org/entry/download/book.epub');
  });

  it('returns null for an XML feed (not a single entry)', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Feed</title></feed>`;
    expect(parsePublicationDocument(xml, 'http://example.org/feed')).toBeNull();
  });

  it('returns null for non-publication JSON', () => {
    expect(parsePublicationDocument('{"foo":1}', 'http://example.org/x')).toBeNull();
  });

  it('returns null for unparseable content', () => {
    expect(parsePublicationDocument('not json or xml', 'http://example.org/x')).toBeNull();
  });
});
