import { describe, it, expect } from 'vitest';
import { getFeed } from 'foliate-js/opds.js';

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
      const feed = getFeed(doc);

      // Should have navigation items (the "Sub/" folder)
      expect(feed.navigation).toBeDefined();
      expect(feed.navigation!).toHaveLength(1);
      expect(feed.navigation![0].title).toBe('Sub/');

      // Should have publication items (the book)
      expect(feed.publications).toBeDefined();
      expect(feed.publications!).toHaveLength(1);
      expect(feed.publications![0].metadata.title).toBe(
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
      const feed = getFeed(doc);

      expect(feed.navigation).toBeUndefined();
      expect(feed.publications).toBeDefined();
      expect(feed.publications!).toHaveLength(2);
      expect(feed.publications![0].metadata.title).toBe(
        'Children of the Fleet - Orson Scott Card.epub',
      );
      expect(feed.publications![1].metadata.title).toBe(
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
      const feed = getFeed(doc);

      expect(feed.publications).toBeUndefined();
      expect(feed.navigation).toBeDefined();
      expect(feed.navigation!).toHaveLength(2);
      expect(feed.navigation![0].title).toBe('Fiction/');
      expect(feed.navigation![1].title).toBe('Non-Fiction/');
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
      const feed = getFeed(doc);

      expect(feed.publications).toBeDefined();
      expect(feed.publications!).toHaveLength(1);
      expect(feed.publications![0].metadata.title).toBe('Some Book.epub');

      expect(feed.navigation).toBeDefined();
      expect(feed.navigation!).toHaveLength(1);
      expect(feed.navigation![0].title).toBe('Sub/');
    });
  });
});
