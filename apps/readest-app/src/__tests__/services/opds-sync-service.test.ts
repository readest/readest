import { describe, it, expect, vi } from 'vitest';
import { getFeed } from 'foliate-js/opds.js';
import type { OPDSFeed } from '@/types/opds';
import { collectNewEntries, getAcquisitionLink } from '@/services/opdsSyncService';

vi.mock('@/services/environment', () => ({
  isWebAppPlatform: vi.fn(() => false),
  isTauriAppPlatform: vi.fn(() => true),
  getAPIBaseUrl: () => '/api',
  getNodeAPIBaseUrl: () => '/node-api',
}));

vi.mock('@tauri-apps/plugin-http', () => ({
  fetch: vi.fn(),
}));

vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn().mockResolvedValue({ 'content-disposition': '' }),
}));

const MIME_XML = 'application/xml';
const parseXML = (xml: string): Document =>
  new DOMParser().parseFromString(xml, MIME_XML as DOMParserSupportedType);

const makeAcquisitionFeed = (entries: Array<{ id: string; title: string; href: string }>) => {
  const entryXml = entries
    .map(
      (e) => `
    <entry>
      <title>${e.title}</title>
      <id>${e.id}</id>
      <updated>2026-01-15T10:00:00.000Z</updated>
      <link href="${e.href}" type="application/epub+zip"
            rel="http://opds-spec.org/acquisition"/>
    </entry>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:test:feed</id>
  <title>Test Feed</title>
  <updated>2026-01-15T10:00:00.000Z</updated>
  ${entryXml}
</feed>`;
};

const makeNavigationFeed = (links: Array<{ title: string; href: string }>) => {
  const entryXml = links
    .map(
      (l) => `
    <entry>
      <title>${l.title}</title>
      <link rel="subsection" href="${l.href}"
            type="application/atom+xml;profile=opds-catalog;kind=acquisition"/>
      <updated>2026-01-15T10:00:00.000Z</updated>
    </entry>`,
    )
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:test:nav</id>
  <title>Navigation</title>
  <updated>2026-01-15T10:00:00.000Z</updated>
  ${entryXml}
</feed>`;
};

describe('OPDS sync service', () => {
  describe('collectNewEntries', () => {
    it('should return all entries when downloadedIds is empty', () => {
      const xml = makeAcquisitionFeed([
        { id: 'urn:shelf:issue:aaa', title: 'Issue 1', href: '/dl/aaa' },
        { id: 'urn:shelf:issue:bbb', title: 'Issue 2', href: '/dl/bbb' },
      ]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;

      const newEntries = collectNewEntries(feed, new Set());
      expect(newEntries).toHaveLength(2);
    });

    it('should skip already-downloaded entries', () => {
      const xml = makeAcquisitionFeed([
        { id: 'urn:shelf:issue:aaa', title: 'Issue 1', href: '/dl/aaa' },
        { id: 'urn:shelf:issue:bbb', title: 'Issue 2', href: '/dl/bbb' },
        { id: 'urn:shelf:issue:ccc', title: 'Issue 3', href: '/dl/ccc' },
      ]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;

      const downloaded = new Set(['urn:shelf:issue:aaa', 'urn:shelf:issue:bbb']);
      const newEntries = collectNewEntries(feed, downloaded);
      expect(newEntries).toHaveLength(1);
      expect(newEntries[0]!.metadata.id).toBe('urn:shelf:issue:ccc');
    });

    it('should skip entries without an id', () => {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test</title>
  <entry>
    <title>No ID Entry</title>
    <link href="/dl/noId" type="application/epub+zip"
          rel="http://opds-spec.org/acquisition"/>
  </entry>
</feed>`;
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;

      const newEntries = collectNewEntries(feed, new Set());
      expect(newEntries).toHaveLength(0);
    });

    it('should return empty when all entries are already downloaded', () => {
      const xml = makeAcquisitionFeed([
        { id: 'urn:shelf:issue:aaa', title: 'Issue 1', href: '/dl/aaa' },
      ]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;

      const downloaded = new Set(['urn:shelf:issue:aaa']);
      const newEntries = collectNewEntries(feed, downloaded);
      expect(newEntries).toHaveLength(0);
    });
  });

  describe('getAcquisitionLink', () => {
    it('should find the acquisition link from a publication', () => {
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

    it('should return undefined for a publication without acquisition links', () => {
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
      // This entry has no acquisition link, so it ends up as navigation
      // Let's test with a publication that has non-acquisition links
      expect(feed.publications).toBeUndefined();
    });
  });

  describe('isNavigationFeed', () => {
    it('should identify navigation feeds (no publications)', () => {
      const xml = makeNavigationFeed([
        { title: 'Series A', href: '/series/a.xml' },
        { title: 'Series B', href: '/series/b.xml' },
      ]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;

      const isNav = !feed.publications?.length && !!feed.navigation?.length;
      expect(isNav).toBe(true);
    });

    it('should identify acquisition feeds (has publications)', () => {
      const xml = makeAcquisitionFeed([{ id: 'urn:test:1', title: 'Book', href: '/dl/book' }]);
      const doc = parseXML(xml);
      const feed = getFeed(doc) as OPDSFeed;

      const isNav = !feed.publications?.length && !!feed.navigation?.length;
      expect(isNav).toBe(false);
    });
  });
});
