// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { parseCalibreWebFeed, parseCalibreWebNav } from '@/services/calibre/calibreWebClient';

// Shaped after cps/templates/feed.xml of Calibre-Web.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/terms/" xmlns:dcterms="http://purl.org/dc/terms/">
  <id>urn:uuid:2853dacf-ed79-42f5-8e8a-a7bb3d1ae6a2</id>
  <updated>2026-09-01T10:00:00+00:00</updated>
  <link rel="self" href="/opds/books/letter/00" type="application/atom+xml"/>
  <link rel="next" title="Next" href="/opds/books/letter/00?offset=60" type="application/atom+xml"/>
  <title>Calibre-Web</title>
  <entry>
    <title>The Three-Body Problem</title>
    <id>urn:uuid:aaa-bbb-ccc</id>
    <updated>2026-08-01T10:00:00+00:00</updated>
    <author><name>Cixin Liu</name></author>
    <author><name>Ken Liu</name></author>
    <publisher><name>Head of Zeus</name></publisher>
    <published>2014-01-01T00:00:00+00:00</published>
    <dcterms:language>eng</dcterms:language>
    <dcterms:language>zho</dcterms:language>
    <category scheme="x" term="Science Fiction" label="Science Fiction"/>
    <category scheme="x" term="Novel" label="Novel"/>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml">RATING: ★★★★<br/>TAGS: Science Fiction, Novel<br/>SERIES: Remembrance of Earth's Past [1.00]<br/><p>Trisolaris is coming.</p></div></content>
    <link type="image/jpeg" href="/opds/cover/12" rel="http://opds-spec.org/image"/>
    <link type="image/jpeg" href="/opds/cover/12" rel="http://opds-spec.org/image/thumbnail"/>
    <link rel="http://opds-spec.org/acquisition" href="/opds/download/12/epub/" length="1048576" title="EPUB" type="application/epub+zip"/>
    <link rel="http://opds-spec.org/acquisition" href="/opds/download/12/mobi/" length="2097152" title="MOBI" type="application/x-mobipocket-ebook"/>
  </entry>
  <entry>
    <title>Untitled Series Entry</title>
    <id>urn:uuid:ddd-eee</id>
    <updated>2026-08-02T10:00:00+00:00</updated>
    <author><name>Author B</name></author>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Second book.</p></div></content>
    <link rel="http://opds-spec.org/acquisition" href="/opds/download/13/pdf/" length="4096" title="PDF" type="application/pdf"/>
  </entry>
  <entry>
    <title>Science Fiction</title>
    <id>/opds/category/12</id>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="/opds/category/12"/>
  </entry>
</feed>`;

const NAV_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:uuid:root</id>
  <entry>
    <title>All</title>
    <id>/opds/books</id>
    <link rel="subsection" href="/opds/books"/>
  </entry>
</feed>`;

describe('parseCalibreWebFeed', () => {
  it('extracts acquisition entries with the numeric id from download links', () => {
    const { entries } = parseCalibreWebFeed(FEED);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.id).toBe('12');
    expect(entries[0]!.json.formats).toEqual(['epub', 'mobi']);
    expect(entries[1]!.id).toBe('13');
    expect(entries[1]!.json.formats).toEqual(['pdf']);
  });

  it('maps authors, tags, languages, publisher and dates', () => {
    const { entries } = parseCalibreWebFeed(FEED);
    const first = entries[0]!.json;
    expect(first.title).toBe('The Three-Body Problem');
    expect(first.authors).toEqual(['Cixin Liu', 'Ken Liu']);
    expect(first.tags).toEqual(['Science Fiction', 'Novel']);
    expect(first.languages).toEqual(['eng', 'zho']);
    expect(first.publisher).toBe('Head of Zeus');
    expect(first.pubdate).toBe('2014-01-01T00:00:00+00:00');
    expect(first.last_modified).toBe('2026-08-01T10:00:00+00:00');
  });

  it('recovers rating, series and description from the xhtml content blob', () => {
    const { entries } = parseCalibreWebFeed(FEED);
    const first = entries[0]!.json;
    expect(first.rating).toBe(4);
    expect(first.series).toBe("Remembrance of Earth's Past");
    expect(first.series_index).toBe(1);
    expect(first.comments).toBe('Trisolaris is coming.');
  });

  it('skips navigation entries and reports the next-page href', () => {
    const { entries, nextHref } = parseCalibreWebFeed(FEED);
    expect(entries.map((e) => e.id)).not.toContain('/opds/category/12');
    expect(nextHref).toBe('/opds/books/letter/00?offset=60');
  });

  it('parses a navigation feed to zero entries', () => {
    const feed = parseCalibreWebFeed(NAV_FEED);
    expect(feed.entries).toEqual([]);
    expect(feed.nextHref).toBeUndefined();
  });

  it('rejects an HTML login page with an actionable error', () => {
    expect(() => parseCalibreWebFeed('<html><body>Please log in</body></html>')).toThrow(
      /Enable OPDS/,
    );
  });

  it('recovers from real-world unescaped metadata (entities, bare &, control chars)', () => {
    // Calibre-Web injects book-comment HTML into the Atom document with
    // |safe: &nbsp;/&mdash; are undefined in XML and a bare & breaks it —
    // the #1 reason real servers fail strict parsing.
    const broken = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:dcterms="http://purl.org/dc/terms/">
  <id>urn:uuid:root</id>
  <entry>
    <title>Tom &amp; Jerry \u0007Annual&nbsp;Edition</title>
    <id>urn:uuid:book-14</id>
    <updated>2026-08-03T10:00:00+00:00</updated>
    <author><name>Author C</name></author>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Tom &amp; Jerry &mdash; the &quot;whole&quot; race&hellip;</p></div></content>
    <link rel="http://opds-spec.org/acquisition" href="/opds/download/14/epub/" length="1" title="EPUB" type="application/epub+zip"/>
  </entry>
</feed>`;
    const { entries, nextHref } = parseCalibreWebFeed(broken);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.id).toBe('14');
    expect(entries[0]!.json.title).toContain('Tom');
    expect(entries[0]!.json.title).toContain('\u00A0');
    // Stored as re-serialized HTML: & is correctly escaped for display.
    expect(entries[0]!.json.comments).toContain('Jerry');
    expect(nextHref).toBeUndefined();
  });

  it('keeps an unknown named entity as literal text instead of failing', () => {
    const unknownEntity = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:uuid:root</id>
  <entry>
    <title>Weird &foo; Title</title>
    <id>urn:uuid:book-15</id>
    <link rel="http://opds-spec.org/acquisition" href="/opds/download/15/mobi/" length="1" title="MOBI" type="application/x-mobipocket-ebook"/>
  </entry>
</feed>`;
    const { entries } = parseCalibreWebFeed(unknownEntity);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.json.title).toBe('Weird &foo; Title');
  });

  it('extracts shelf nav entries by href pattern', () => {
    const shelfIndex = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <id>urn:uuid:shelfindex</id>
  <link rel="next" href="/opds/shelfindex?offset=50"/>
  <entry>
    <title>Favorites</title>
    <id>/opds/shelf/7</id>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="/opds/shelf/7"/>
  </entry>
  <entry>
    <title>To Read</title>
    <id>/opds/shelf/9</id>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="/opds/shelf/9"/>
  </entry>
  <entry>
    <title>New Books</title>
    <id>/opds/new</id>
    <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="/opds/new"/>
  </entry>
</feed>`;
    const { links, nextHref } = parseCalibreWebNav(shelfIndex, /\/opds\/shelf\/(\d+)/);
    expect(links).toEqual([
      { id: '7', title: 'Favorites', href: '/opds/shelf/7' },
      { id: '9', title: 'To Read', href: '/opds/shelf/9' },
    ]);
    expect(nextHref).toBe('/opds/shelfindex?offset=50');
  });
});
