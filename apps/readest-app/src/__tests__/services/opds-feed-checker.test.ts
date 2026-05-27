import { describe, it, expect, vi } from 'vitest';
import { getFeed } from 'foliate-js/opds.js';
import type { OPDSFeed, OPDSPublication } from '@/types/opds';
import {
  getAcquisitionLink,
  collectNewEntries,
  getEntryId,
  getNextPageUrl,
  findNewestFeedURL,
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

    it('prefers EPUB over PDF when both formats are listed', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>Multi-format Book</title>
    <id>urn:test:multi</id>
    <link href="/dl/book.pdf" type="application/pdf"
          rel="http://opds-spec.org/acquisition"/>
    <link href="/dl/book.epub" type="application/epub+zip"
          rel="http://opds-spec.org/acquisition"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;

      const acqLink = getAcquisitionLink(pub);
      expect(acqLink!.href).toBe('/dl/book.epub');
      expect(acqLink!.type).toBe('application/epub+zip');
    });

    it('prefers MOBI over PDF when EPUB is absent', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>Multi-format Book</title>
    <id>urn:test:multi</id>
    <link href="/dl/book.pdf" type="application/pdf"
          rel="http://opds-spec.org/acquisition"/>
    <link href="/dl/book.mobi" type="application/x-mobipocket-ebook"
          rel="http://opds-spec.org/acquisition"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;

      const acqLink = getAcquisitionLink(pub);
      expect(acqLink!.href).toBe('/dl/book.mobi');
    });

    it('prefers EPUB over MOBI', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>Multi-format Book</title>
    <id>urn:test:multi</id>
    <link href="/dl/book.mobi" type="application/x-mobipocket-ebook"
          rel="http://opds-spec.org/acquisition"/>
    <link href="/dl/book.epub" type="application/epub+zip"
          rel="http://opds-spec.org/acquisition"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;

      const acqLink = getAcquisitionLink(pub);
      expect(acqLink!.href).toBe('/dl/book.epub');
    });

    it('falls back to first acquisition link when no preferred format matches', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>Comic</title>
    <id>urn:test:cbz</id>
    <link href="/dl/comic.cbz" type="application/vnd.comicbook+zip"
          rel="http://opds-spec.org/acquisition"/>
    <link href="/dl/comic.txt" type="text/plain"
          rel="http://opds-spec.org/acquisition"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;

      const acqLink = getAcquisitionLink(pub);
      expect(acqLink!.href).toBe('/dl/comic.cbz');
    });

    it('handles MIME type parameters when matching format priority', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>Book with profile</title>
    <id>urn:test:profile</id>
    <link href="/dl/book.pdf" type="application/pdf"
          rel="http://opds-spec.org/acquisition"/>
    <link href="/dl/book.epub" type="application/epub+zip; profile=opds"
          rel="http://opds-spec.org/acquisition"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;

      const acqLink = getAcquisitionLink(pub);
      expect(acqLink!.href).toBe('/dl/book.epub');
    });

    it('skips paid (buy) acquisition links', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>Paid Book</title>
    <id>urn:test:paid</id>
    <link href="/buy/book.epub" type="application/epub+zip"
          rel="http://opds-spec.org/acquisition/buy"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;
      expect(getAcquisitionLink(pub)).toBeUndefined();
    });

    it('skips borrow, subscribe, and sample acquisition links', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:lend', title: 'Library Loan' },
        links: [
          {
            href: '/borrow/book.epub',
            type: 'application/epub+zip',
            rel: 'http://opds-spec.org/acquisition/borrow',
            properties: {},
          },
          {
            href: '/subscribe/book.epub',
            type: 'application/epub+zip',
            rel: 'http://opds-spec.org/acquisition/subscribe',
            properties: {},
          },
          {
            href: '/sample/book.epub',
            type: 'application/epub+zip',
            rel: 'http://opds-spec.org/acquisition/sample',
            properties: {},
          },
        ],
        images: [],
      };
      expect(getAcquisitionLink(pub)).toBeUndefined();
    });

    it('prefers open-access over plain acquisition when both exist', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>Mixed Book</title>
    <id>urn:test:mixed</id>
    <link href="/dl/book.epub" type="application/epub+zip"
          rel="http://opds-spec.org/acquisition"/>
    <link href="/oa/book.epub" type="application/epub+zip"
          rel="http://opds-spec.org/acquisition/open-access"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;
      const acqLink = getAcquisitionLink(pub);
      expect(acqLink!.href).toBe('/oa/book.epub');
    });

    it('picks open-access EPUB even when buy link is listed first', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>Mixed Access</title>
    <id>urn:test:mixed</id>
    <link href="/buy/book.pdf" type="application/pdf"
          rel="http://opds-spec.org/acquisition/buy"/>
    <link href="/oa/book.epub" type="application/epub+zip"
          rel="http://opds-spec.org/acquisition/open-access"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;
      const acqLink = getAcquisitionLink(pub);
      expect(acqLink!.href).toBe('/oa/book.epub');
    });

    it('skips indirect acquisition links', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:indirect', title: 'Indirect Only' },
        links: [
          {
            href: '/landing-page',
            type: 'application/atom+xml;type=entry;profile=opds-catalog',
            rel: 'http://opds-spec.org/acquisition/indirect',
            properties: {},
          },
        ],
        images: [],
      };
      expect(getAcquisitionLink(pub)).toBeUndefined();
    });

    it('skips links with indirectAcquisition properties', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:indirect2', title: 'Indirect Chain' },
        links: [
          {
            href: '/landing',
            type: 'application/atom+xml;type=entry;profile=opds-catalog',
            rel: 'http://opds-spec.org/acquisition',
            properties: {
              indirectAcquisition: [{ type: 'application/epub+zip' }],
            },
          },
        ],
        images: [],
      };
      expect(getAcquisitionLink(pub)).toBeUndefined();
    });

    it('prefers Advanced EPUB (by link title) over compatible EPUB', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:adv1', title: 'Standard Ebooks Style' },
        links: [
          {
            href: '/dl/book.compat.epub',
            type: 'application/epub+zip',
            rel: 'http://opds-spec.org/acquisition/open-access',
            title: 'Recommended compatible epub',
            properties: {},
          },
          {
            href: '/dl/book.advanced.epub',
            type: 'application/epub+zip',
            rel: 'http://opds-spec.org/acquisition/open-access',
            title: 'Advanced epub features',
            properties: {},
          },
        ],
        images: [],
      };
      expect(getAcquisitionLink(pub)!.href).toBe('/dl/book.advanced.epub');
    });

    it('prefers EPUB3 (by .epub3 href) over plain EPUB', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:adv2', title: 'EPUB3 Variant' },
        links: [
          {
            href: '/dl/book.epub',
            type: 'application/epub+zip',
            rel: 'http://opds-spec.org/acquisition/open-access',
            properties: {},
          },
          {
            href: '/dl/book.epub3',
            type: 'application/epub+zip',
            rel: 'http://opds-spec.org/acquisition/open-access',
            properties: {},
          },
        ],
        images: [],
      };
      expect(getAcquisitionLink(pub)!.href).toBe('/dl/book.epub3');
    });

    it('prefers EPUB over AZW3', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>Multi-format</title>
    <id>urn:test:epub-vs-azw3</id>
    <link href="/dl/book.azw3" type="application/x-mobi8-ebook"
          rel="http://opds-spec.org/acquisition"/>
    <link href="/dl/book.epub" type="application/epub+zip"
          rel="http://opds-spec.org/acquisition"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;
      expect(getAcquisitionLink(pub)!.href).toBe('/dl/book.epub');
    });

    it('prefers AZW3 over PDF', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>Multi-format</title>
    <id>urn:test:azw3-vs-pdf</id>
    <link href="/dl/book.pdf" type="application/pdf"
          rel="http://opds-spec.org/acquisition"/>
    <link href="/dl/book.azw3" type="application/x-mobi8-ebook"
          rel="http://opds-spec.org/acquisition"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;
      expect(getAcquisitionLink(pub)!.href).toBe('/dl/book.azw3');
    });

    it('prefers AZW over CBZ', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:azw-cbz', title: 'AZW vs CBZ' },
        links: [
          {
            href: '/dl/book.cbz',
            type: 'application/vnd.comicbook+zip',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
          {
            href: '/dl/book.azw',
            type: 'application/vnd.amazon.ebook',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
        ],
        images: [],
      };
      expect(getAcquisitionLink(pub)!.href).toBe('/dl/book.azw');
    });

    it('prefers CBZ over TXT (other formats)', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:cbz-txt', title: 'CBZ vs TXT' },
        links: [
          {
            href: '/dl/book.txt',
            type: 'text/plain',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
          {
            href: '/dl/book.cbz',
            type: 'application/vnd.comicbook+zip',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
        ],
        images: [],
      };
      expect(getAcquisitionLink(pub)!.href).toBe('/dl/book.cbz');
    });

    it('treats PDF and CBZ as the same tier (uses feed order to break ties)', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:pdf-cbz', title: 'PDF vs CBZ' },
        links: [
          {
            href: '/dl/book.pdf',
            type: 'application/pdf',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
          {
            href: '/dl/book.cbz',
            type: 'application/vnd.comicbook+zip',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
        ],
        images: [],
      };
      // PDF is listed first, so it wins on tie.
      expect(getAcquisitionLink(pub)!.href).toBe('/dl/book.pdf');
    });

    it('infers EPUB tier from href extension when MIME type is missing', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:notype1', title: 'No Type' },
        links: [
          {
            href: '/dl/book.pdf',
            type: 'application/pdf',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
          {
            // No type attribute — server forgot to set it.
            href: '/dl/book.epub',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
        ],
        images: [],
      };
      expect(getAcquisitionLink(pub)!.href).toBe('/dl/book.epub');
    });

    it('infers EPUB tier from link title when MIME type is missing', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:notype2', title: 'Title-Only Format' },
        links: [
          {
            href: '/download/2',
            type: 'application/pdf',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
          {
            // Opaque href, but title labels the format.
            href: '/download/1',
            title: 'EPUB',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
        ],
        images: [],
      };
      expect(getAcquisitionLink(pub)!.href).toBe('/download/1');
    });

    it('infers Advanced EPUB tier from link title when MIME type is missing', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:notype3', title: 'Advanced inference' },
        links: [
          {
            href: '/download/compat',
            title: 'Compatible epub',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
          {
            href: '/download/advanced',
            title: 'Advanced epub features',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
        ],
        images: [],
      };
      expect(getAcquisitionLink(pub)!.href).toBe('/download/advanced');
    });

    it('treats application/octet-stream as unspecified and falls back to href/title', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:octet', title: 'Octet stream' },
        links: [
          {
            href: '/dl/book.pdf',
            type: 'application/pdf',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
          {
            href: '/dl/book.epub',
            type: 'application/octet-stream',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
        ],
        images: [],
      };
      // The octet-stream link is actually an EPUB (per its href), so it wins.
      expect(getAcquisitionLink(pub)!.href).toBe('/dl/book.epub');
    });

    it('keeps explicit MIME type even when href ext disagrees', () => {
      const pub: OPDSPublication = {
        metadata: { id: 'urn:test:explicit', title: 'Explicit MIME' },
        links: [
          {
            // PDF that happens to live at a generic URL.
            href: '/api/file/123',
            type: 'application/pdf',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
          {
            href: '/dl/book.txt',
            type: 'text/plain',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
        ],
        images: [],
      };
      // PDF (tier 3) wins over TXT (tier 4) by declared MIME.
      expect(getAcquisitionLink(pub)!.href).toBe('/api/file/123');
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

    it('dedupes a publication that appears in both feed.publications and a group', () => {
      const sharedPub: OPDSPublication = {
        metadata: { id: 'urn:dup', title: 'Shared Book' },
        links: [
          {
            href: '/dl/dup.epub',
            type: 'application/epub+zip',
            rel: 'http://opds-spec.org/acquisition',
            properties: {},
          },
        ],
        images: [],
      };
      const feed: OPDSFeed = {
        metadata: { title: 'Test' },
        links: [],
        publications: [sharedPub],
        groups: [
          {
            metadata: { title: 'Featured' },
            links: [],
            publications: [sharedPub],
          },
        ],
      };
      const items = collectNewEntries(feed, new Set(), 'https://example.com');
      expect(items).toHaveLength(1);
      expect(items[0]!.entryId).toBe('urn:dup');
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

  describe('findNewestFeedURL', () => {
    it('detects rel=http://opds-spec.org/sort/new on a top-level feed link (Calibre / Calibre-Web)', () => {
      const feed: OPDSFeed = {
        metadata: { title: 'Calibre Library' },
        links: [
          { href: '/opds/new', rel: 'http://opds-spec.org/sort/new', properties: {} },
          { href: '/opds/all', rel: 'self', properties: {} },
        ],
      };
      expect(findNewestFeedURL(feed, 'https://calibre.example.com/opds')).toBe(
        'https://calibre.example.com/opds/new',
      );
    });

    it('detects rel=sort/new on a navigation entry', () => {
      const feed: OPDSFeed = {
        metadata: { title: 'Library' },
        links: [],
        navigation: [
          { title: 'By Author', href: '/by-author', properties: {} },
          {
            title: 'New Books',
            href: '/new',
            rel: 'http://opds-spec.org/sort/new',
            properties: {},
          },
        ],
      };
      expect(findNewestFeedURL(feed, 'https://example.com/opds')).toBe('https://example.com/new');
    });

    it('detects "Newest" by navigation title (Standard Ebooks-style)', () => {
      const feed: OPDSFeed = {
        metadata: { title: 'Standard Ebooks' },
        links: [],
        navigation: [
          { title: 'Subjects', href: '/subjects', properties: {} },
          { title: 'Newest Releases', href: '/new-releases', properties: {} },
          { title: 'Collections', href: '/collections', properties: {} },
        ],
      };
      expect(findNewestFeedURL(feed, 'https://standardebooks.org/feeds/opds')).toBe(
        'https://standardebooks.org/new-releases',
      );
    });

    it('detects "Recently Added" by title', () => {
      const feed: OPDSFeed = {
        metadata: { title: 'Library' },
        links: [],
        navigation: [{ title: 'Recently Added', href: '/recent', properties: {} }],
      };
      expect(findNewestFeedURL(feed, 'https://example.com/opds')).toBe(
        'https://example.com/recent',
      );
    });

    it('detects "Latest" by title', () => {
      const feed: OPDSFeed = {
        metadata: { title: 'Library' },
        links: [],
        navigation: [{ title: 'Latest Books', href: '/latest', properties: {} }],
      };
      expect(findNewestFeedURL(feed, 'https://example.com/opds')).toBe(
        'https://example.com/latest',
      );
    });

    it('detects ?sort_order=release_date in href (Project Gutenberg-style)', () => {
      const feed: OPDSFeed = {
        metadata: { title: 'Project Gutenberg' },
        links: [],
        navigation: [
          { title: 'Browse', href: '/ebooks/search.opds/?sort_order=title', properties: {} },
          {
            title: 'Sort by date',
            href: '/ebooks/search.opds/?sort_order=release_date',
            properties: {},
          },
        ],
      };
      expect(findNewestFeedURL(feed, 'https://m.gutenberg.org/ebooks.opds/')).toBe(
        'https://m.gutenberg.org/ebooks/search.opds/?sort_order=release_date',
      );
    });

    it('detects /new-releases in href without explicit title or rel', () => {
      const feed: OPDSFeed = {
        metadata: { title: 'Library' },
        links: [],
        navigation: [
          { title: 'Browse', href: '/feeds/all', properties: {} },
          { title: 'Browse', href: '/feeds/new-releases', properties: {} },
        ],
      };
      expect(findNewestFeedURL(feed, 'https://example.com/opds')).toBe(
        'https://example.com/feeds/new-releases',
      );
    });

    it('returns undefined when nothing matches', () => {
      const feed: OPDSFeed = {
        metadata: { title: 'Library' },
        links: [],
        navigation: [
          { title: 'By Author', href: '/by-author', properties: {} },
          { title: 'By Title', href: '/by-title', properties: {} },
          { title: 'Search', href: '/search', properties: {} },
        ],
      };
      expect(findNewestFeedURL(feed, 'https://example.com/opds')).toBeUndefined();
    });

    it('prefers rel=sort/new over a title heuristic match', () => {
      const feed: OPDSFeed = {
        metadata: { title: 'Library' },
        links: [
          {
            href: '/opds/sort-new',
            rel: 'http://opds-spec.org/sort/new',
            properties: {},
          },
        ],
        navigation: [{ title: 'Newest fiction', href: '/fiction/newest', properties: {} }],
      };
      expect(findNewestFeedURL(feed, 'https://example.com/opds')).toBe(
        'https://example.com/opds/sort-new',
      );
    });

    it('resolves relative hrefs against the base URL', () => {
      const feed: OPDSFeed = {
        metadata: { title: 'Library' },
        links: [],
        navigation: [{ title: 'Newest', href: '../newest', properties: {} }],
      };
      expect(findNewestFeedURL(feed, 'https://example.com/opds/feeds/root')).toBe(
        'https://example.com/opds/newest',
      );
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
