import { describe, it, expect } from 'vitest';
import { getFeed, getPublication } from 'foliate-js/opds.js';
import { SYMBOL, type OPDSFeed, type OPDSPublication } from '@/types/opds';

const MIME_XML = 'application/xml';

const parseXML = (xml: string): Document => {
  return new DOMParser().parseFromString(xml, MIME_XML as DOMParserSupportedType);
};

describe('OPDS feed parsing', () => {
  describe('getFeed with mixed navigation and publication entries (Copyparty)', () => {
    // Reproduces https://github.com/readest/readest/issues/3667
    // Copyparty mixes folder entries (navigation) and book entries (publications)
    // in the same feed. When a folder comes first, all items were classified as
    // navigation, causing books to show as "Untitled".
    const copypartyRootFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Readest-Test</title>
    <link rel="search"
    href="/copyparty/books/Readest-Test?opds&amp;osd"
    type="application/opensearchdescription+xml"/>
    <entry>
        <title>Sub/</title>
        <link rel="subsection"
        href="Sub/?opds"
        type="application/atom+xml;profile=opds-catalog"/>
        <updated>2026-03-28T05:37:03Z</updated>
    </entry>
    <entry>
        <title>Children of the Fleet - Orson Scott Card.epub</title>
        <updated>2025-11-02T17:50:21Z</updated>
        <link rel="http://opds-spec.org/acquisition"
        href="Children%20of%20the%20Fleet%20-%20Orson%20Scott%20Card.epub?dl"
        type="application/epub+zip"/>
        <link rel="http://opds-spec.org/image/thumbnail"
        href="Children%20of%20the%20Fleet%20-%20Orson%20Scott%20Card.epub?dl&amp;th=jf"
        type="image/jpeg"/>
        <link rel="http://opds-spec.org/image"
        href="Children%20of%20the%20Fleet%20-%20Orson%20Scott%20Card.epub?dl&amp;th=jf3"
        type="image/jpeg"/>
    </entry>
</feed>`;

    it('should separate navigation and publication entries in mixed feeds', () => {
      const doc = parseXML(copypartyRootFeed);
      const feed = getFeed(doc) as OPDSFeed;

      // Should have navigation items (the "Sub/" folder)
      expect(feed.navigation).toBeDefined();
      expect(feed.navigation!).toHaveLength(1);
      expect(feed.navigation![0]!.title).toBe('Sub/');

      // Should have publication items (the book)
      expect(feed.publications).toBeDefined();
      expect(feed.publications!).toHaveLength(1);
      expect(feed.publications![0]!.metadata.title).toBe(
        'Children of the Fleet - Orson Scott Card.epub',
      );
    });

    it('should handle feeds with only publications (subfolder case)', () => {
      const subFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <link rel="search"
    href="/copyparty/books/Readest-Test/Sub?opds&amp;osd"
    type="application/opensearchdescription+xml"/>
    <entry>
        <title>Children of the Fleet - Orson Scott Card.epub</title>
        <updated>2025-11-02T17:50:21Z</updated>
        <link rel="http://opds-spec.org/acquisition"
        href="Children%20of%20the%20Fleet%20-%20Orson%20Scott%20Card.epub?dl"
        type="application/epub+zip"/>
    </entry>
    <entry>
        <title>Earth Afire - Orson Scott Card &amp; Aaron Johnston.epub</title>
        <updated>2025-11-02T17:50:22Z</updated>
        <link rel="http://opds-spec.org/acquisition"
        href="Earth%20Afire%20-%20Orson%20Scott%20Card%20%26%20Aaron%20Johnston.epub?dl"
        type="application/epub+zip"/>
    </entry>
</feed>`;

      const doc = parseXML(subFeed);
      const feed = getFeed(doc) as OPDSFeed;

      expect(feed.navigation).toBeUndefined();
      expect(feed.publications).toBeDefined();
      expect(feed.publications!).toHaveLength(2);
      expect(feed.publications![0]!.metadata.title).toBe(
        'Children of the Fleet - Orson Scott Card.epub',
      );
      expect(feed.publications![1]!.metadata.title).toBe(
        'Earth Afire - Orson Scott Card & Aaron Johnston.epub',
      );
    });

    it('should handle feeds with only navigation entries', () => {
      const navFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <title>Root</title>
    <entry>
        <title>Fiction/</title>
        <link rel="subsection"
        href="Fiction/?opds"
        type="application/atom+xml;profile=opds-catalog"/>
        <updated>2026-03-28T05:37:03Z</updated>
    </entry>
    <entry>
        <title>Non-Fiction/</title>
        <link rel="subsection"
        href="Non-Fiction/?opds"
        type="application/atom+xml;profile=opds-catalog"/>
        <updated>2026-03-28T05:37:03Z</updated>
    </entry>
</feed>`;

      const doc = parseXML(navFeed);
      const feed = getFeed(doc) as OPDSFeed;

      expect(feed.publications).toBeUndefined();
      expect(feed.navigation).toBeDefined();
      expect(feed.navigation!).toHaveLength(2);
      expect(feed.navigation![0]!.title).toBe('Fiction/');
      expect(feed.navigation![1]!.title).toBe('Non-Fiction/');
    });

    it('should parse entry id and updated fields from publications', () => {
      const doc = parseXML(copypartyRootFeed);
      const feed = getFeed(doc) as OPDSFeed;

      // The book entry has an <updated> element but no <id>
      expect(feed.publications).toBeDefined();
      expect(feed.publications![0]!.metadata.updated).toBe('2025-11-02T17:50:21Z');
    });

    it('should handle navigation entry after publications', () => {
      // Reverse order: publications first, then navigation
      const reverseFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
    <entry>
        <title>Some Book.epub</title>
        <updated>2025-11-02T17:50:21Z</updated>
        <link rel="http://opds-spec.org/acquisition"
        href="Some%20Book.epub?dl"
        type="application/epub+zip"/>
    </entry>
    <entry>
        <title>Sub/</title>
        <link rel="subsection"
        href="Sub/?opds"
        type="application/atom+xml;profile=opds-catalog"/>
        <updated>2026-03-28T05:37:03Z</updated>
    </entry>
</feed>`;

      const doc = parseXML(reverseFeed);
      const feed = getFeed(doc) as OPDSFeed;

      expect(feed.publications).toBeDefined();
      expect(feed.publications!).toHaveLength(1);
      expect(feed.publications![0]!.metadata.title).toBe('Some Book.epub');

      expect(feed.navigation).toBeDefined();
      expect(feed.navigation!).toHaveLength(1);
      expect(feed.navigation![0]!.title).toBe('Sub/');
    });
  });

  describe('metadata-only entries without an acquisition link (Calibre, #4599)', () => {
    // Reproduces https://github.com/readest/readest/issues/4599
    // A Calibre book whose file was removed (e.g. a borrowed/loaned title kept
    // for tracking) still emits a full metadata entry with cover/thumbnail
    // links but no acquisition link. Such an entry was classified as a
    // navigation item whose href fell back to links[0] — the cover image — so
    // tapping it tried to load the image as a feed and crashed with a JSON
    // parse error. It should be treated as a publication (so its metadata is
    // shown) with no downloadable format.
    const calibreNoFormatFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:dc="http://purl.org/dc/elements/1.1/"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <title>Calibre Library</title>
  <entry>
    <title>A Borrowed Book</title>
    <id>urn:uuid:1234</id>
    <author><name>Jane Author</name></author>
    <updated>2026-01-15T10:30:00Z</updated>
    <dc:language>eng</dc:language>
    <summary>A book I borrowed; the file is no longer available.</summary>
    <link type="image/jpeg" href="/get/cover/123/lib" rel="http://opds-spec.org/image"/>
    <link type="image/png" href="/get/thumb/123/lib" rel="http://opds-spec.org/image/thumbnail"/>
  </entry>
</feed>`;

    it('classifies a metadata+cover entry with no acquisition link as a publication', () => {
      const doc = parseXML(calibreNoFormatFeed);
      const feed = getFeed(doc) as OPDSFeed;

      expect(feed.publications).toBeDefined();
      expect(feed.publications!).toHaveLength(1);
      expect(feed.publications![0]!.metadata.title).toBe('A Borrowed Book');
      // The crash path: the entry must NOT become a navigation item pointing at
      // the cover image.
      expect(feed.navigation).toBeUndefined();
    });

    it('exposes no acquisition link for a format-less publication', () => {
      const doc = parseXML(calibreNoFormatFeed);
      const feed = getFeed(doc) as OPDSFeed;
      const pub = feed.publications![0]!;
      const hasAcquisition = pub.links.some((link) => {
        const rels = Array.isArray(link.rel) ? link.rel : [link.rel ?? ''];
        return rels.some((rel) => rel.startsWith('http://opds-spec.org/acquisition'));
      });
      expect(hasAcquisition).toBe(false);
    });

    it('still classifies a true navigation entry (sub-catalog link, no image) as navigation', () => {
      const navFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Root</title>
  <entry>
    <title>By Author</title>
    <link rel="subsection" href="author/?opds"
          type="application/atom+xml;profile=opds-catalog"/>
    <updated>2026-03-28T05:37:03Z</updated>
  </entry>
</feed>`;
      const doc = parseXML(navFeed);
      const feed = getFeed(doc) as OPDSFeed;

      expect(feed.publications).toBeUndefined();
      expect(feed.navigation).toBeDefined();
      expect(feed.navigation!).toHaveLength(1);
      expect(feed.navigation![0]!.title).toBe('By Author');
    });
  });

  describe('entry id and updated parsing', () => {
    const shelfFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog">
  <id>urn:shelf:series:stratechery</id>
  <title>Shelf — Stratechery</title>
  <updated>2026-01-15T10:30:00.000Z</updated>
  <entry>
    <title>Issue One</title>
    <id>urn:shelf:issue:abc123</id>
    <updated>2026-01-15T10:30:00.000Z</updated>
    <published>2026-01-14T00:00:00.000Z</published>
    <link href="/dl/abc123.token"
          type="application/epub+zip"
          rel="http://opds-spec.org/acquisition"/>
  </entry>
  <entry>
    <title>Issue Two</title>
    <id>urn:shelf:issue:def456</id>
    <updated>2026-01-16T08:00:00.000Z</updated>
    <link href="/dl/def456.token"
          type="application/epub+zip"
          rel="http://opds-spec.org/acquisition"/>
  </entry>
</feed>`;

    it('should parse id and updated on publications', () => {
      const doc = parseXML(shelfFeed);
      const feed = getFeed(doc) as OPDSFeed;

      expect(feed.publications).toHaveLength(2);
      expect(feed.publications![0]!.metadata.id).toBe('urn:shelf:issue:abc123');
      expect(feed.publications![0]!.metadata.updated).toBe('2026-01-15T10:30:00.000Z');
      expect(feed.publications![0]!.metadata.published).toBe('2026-01-14T00:00:00.000Z');
      expect(feed.publications![1]!.metadata.id).toBe('urn:shelf:issue:def456');
      expect(feed.publications![1]!.metadata.updated).toBe('2026-01-16T08:00:00.000Z');
    });

    it('should parse id and updated on the feed itself', () => {
      const doc = parseXML(shelfFeed);
      const feed = getFeed(doc) as OPDSFeed;

      expect(feed.metadata.id).toBe('urn:shelf:series:stratechery');
      expect(feed.metadata.updated).toBe('2026-01-15T10:30:00.000Z');
    });

    it('should parse id and updated via getPublication directly', () => {
      const doc = parseXML(shelfFeed);
      const entry = doc.querySelector('entry')!;
      const pub = getPublication(entry) as OPDSPublication;

      expect(pub.metadata.id).toBe('urn:shelf:issue:abc123');
      expect(pub.metadata.updated).toBe('2026-01-15T10:30:00.000Z');
    });

    // Regression test for https://github.com/readest/readest/issues/4156
    // CWA (and other OPDS 1.x servers) place the book description in
    // <entry><summary>. foliate-js attaches it under SYMBOL.CONTENT, so the
    // SYMBOL exported from @/types/opds must be the same Symbol instance the
    // parser writes — otherwise PublicationView reads undefined and the
    // description disappears from the book details page.
    it('should expose <summary> via SYMBOL.CONTENT for OPDS 1.x feeds', () => {
      const opds1Feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>CWA Library</title>
  <entry>
    <title>A Book With A Summary</title>
    <summary>A short blurb describing the book, set by the OPDS server in &lt;summary&gt;.</summary>
    <link rel="http://opds-spec.org/acquisition"
          href="book.epub" type="application/epub+zip"/>
  </entry>
</feed>`;
      const doc = parseXML(opds1Feed);
      const feed = getFeed(doc) as OPDSFeed;

      expect(feed.publications).toHaveLength(1);
      const metadata = feed.publications![0]!.metadata;
      const content = metadata[SYMBOL.CONTENT];
      expect(content).toBeDefined();
      expect(content!.value).toContain('A short blurb describing the book');
    });

    it('should handle entries without id or updated gracefully', () => {
      const minimalFeed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Minimal</title>
  <entry>
    <title>No ID Book</title>
    <link rel="http://opds-spec.org/acquisition"
          href="book.epub" type="application/epub+zip"/>
  </entry>
</feed>`;
      const doc = parseXML(minimalFeed);
      const feed = getFeed(doc) as OPDSFeed;

      expect(feed.publications).toHaveLength(1);
      expect(feed.publications![0]!.metadata.id).toBeUndefined();
      expect(feed.publications![0]!.metadata.updated).toBeUndefined();
    });
  });
});
