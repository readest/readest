import { describe, it, expect, vi } from 'vitest';
import { getFeed } from 'foliate-js/opds.js';
import type { OPDSFeed } from '@/types/opds';
import {
  getAcquisitionLink,
  collectNewEntries,
  getEntryId,
  getNextPageUrl,
} from '@/services/opds/feedChecker';

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: vi.fn(() => false),
  isTauriAppPlatform: vi.fn(() => true),
  getAPIBaseUrl: () => '/api',
  getNodeAPIBaseUrl: () => '/node-api',
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

const MIME_XML = 'application/xml';
const parseXML = (xml: string): Document =>
  new DOMParser().parseFromString(xml, MIME_XML as DOMParserSupportedType);

const makeAcquisitionFeed = (
  entries: Array<{ id?: string; title: string; href: string }>,
  nextUrl?: string,
) => {
  const entryXml = entries
    .map(
      (e) => `
    <entry>
      <title>${e.title}</title>
      ${e.id ? `<id>${e.id}</id>` : ''}
      <updated>2026-01-15T10:00:00.000Z</updated>
      <link href="${e.href}" type="application/epub+zip"
            rel="http://opds-spec.org/acquisition"/>
    </entry>`,
    )
    .join('');

  const nextLink = nextUrl
    ? `<link rel="next" href="${nextUrl}" type="application/atom+xml;profile=opds-catalog"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:test:feed</id>
  <title>Test Feed</title>
  <updated>2026-01-15T10:00:00.000Z</updated>
  ${nextLink}
  ${entryXml}
</feed>`;
};

describe('OPDS feed checker', () => {
  describe('getAcquisitionLink', () => {
    it('finds the acquisition link from a publication', () => {
      const xml = makeAcquisitionFeed([
        { id: 'urn:test:1', title: 'Test Book', href: '/download/book.epub' },
      ]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;

      const acqLink = getAcquisitionLink(pub);
      expect(acqLink).toBeDefined();
      expect(acqLink!.href).toBe('/download/book.epub');
      expect(acqLink!.type).toBe('application/epub+zip');
    });

    it('returns undefined for a publication without acquisition links', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>Preview Only</title>
    <id>urn:test:preview</id>
    <link href="/preview" type="text/html" rel="alternate"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      // entry without acquisition link goes to navigation, not publications
      expect(feed.publications).toBeUndefined();
    });
  });

  describe('getEntryId', () => {
    it('returns Atom id when present', () => {
      const xml = makeAcquisitionFeed([
        { id: 'urn:shelf:issue:abc', title: 'Issue', href: '/dl/abc' },
      ]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;
      expect(getEntryId(pub, 'https://example.com')).toBe('urn:shelf:issue:abc');
    });

    it('falls back to resolved acquisition URL when no id', () => {
      const xml = makeAcquisitionFeed([{ title: 'No ID Book', href: '/dl/book.epub' }]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;
      const id = getEntryId(pub, 'https://example.com/opds/feed.xml');
      expect(id).toBe('https://example.com/dl/book.epub');
    });
  });

  describe('collectNewEntries', () => {
    it('returns all entries when knownIds is empty', () => {
      const xml = makeAcquisitionFeed([
        { id: 'urn:a', title: 'Issue 1', href: '/dl/a' },
        { id: 'urn:b', title: 'Issue 2', href: '/dl/b' },
      ]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const items = collectNewEntries(feed, new Set(), 'https://example.com');
      expect(items).toHaveLength(2);
    });

    it('skips already-known entries', () => {
      const xml = makeAcquisitionFeed([
        { id: 'urn:a', title: 'Issue 1', href: '/dl/a' },
        { id: 'urn:b', title: 'Issue 2', href: '/dl/b' },
        { id: 'urn:c', title: 'Issue 3', href: '/dl/c' },
      ]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const known = new Set(['urn:a', 'urn:b']);
      const items = collectNewEntries(feed, known, 'https://example.com');
      expect(items).toHaveLength(1);
      expect(items[0]!.entryId).toBe('urn:c');
    });

    it('uses acquisition URL fallback for entries without id', () => {
      const xml = makeAcquisitionFeed([{ title: 'No ID Book', href: '/dl/book.epub' }]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const items = collectNewEntries(feed, new Set(), 'https://example.com/opds/');
      expect(items).toHaveLength(1);
      expect(items[0]!.entryId).toBe('https://example.com/dl/book.epub');
    });

    it('returns empty when all entries are already known', () => {
      const xml = makeAcquisitionFeed([{ id: 'urn:a', title: 'Issue 1', href: '/dl/a' }]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const items = collectNewEntries(feed, new Set(['urn:a']), 'https://example.com');
      expect(items).toHaveLength(0);
    });

    it('collects entries from groups as well', () => {
      const feed: OPDSFeed = {
        metadata: { title: 'Test' },
        links: [],
        publications: [],
        groups: [
          {
            metadata: { title: 'Group 1' },
            links: [],
            publications: [
              {
                metadata: { id: 'urn:g1', title: 'Grouped Book' },
                links: [
                  {
                    href: '/dl/g1',
                    type: 'application/epub+zip',
                    rel: 'http://opds-spec.org/acquisition',
                    properties: {},
                  },
                ],
                images: [],
              },
            ],
          },
        ],
      };
      const items = collectNewEntries(feed, new Set(), 'https://example.com');
      expect(items).toHaveLength(1);
      expect(items[0]!.entryId).toBe('urn:g1');
    });
  });

  describe('getNextPageUrl', () => {
    it('returns the next page URL from feed links', () => {
      const xml = makeAcquisitionFeed(
        [{ id: 'urn:a', title: 'Book', href: '/dl/a' }],
        '/opds/page2',
      );
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      expect(getNextPageUrl(feed)).toBe('/opds/page2');
    });

    it('returns undefined when no next link', () => {
      const xml = makeAcquisitionFeed([{ id: 'urn:a', title: 'Book', href: '/dl/a' }]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      expect(getNextPageUrl(feed)).toBeUndefined();
    });
  });
});
