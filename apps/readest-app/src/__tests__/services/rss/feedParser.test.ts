// src/__tests__/services/rss/feedParser.test.ts
import { describe, expect, it } from 'vitest';
import { parseFeed } from '@/services/rss/feedParser';

const RSS = `<?xml version="1.0"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Blog</title>
    <link>https://example.com</link>
    <description>Words about things</description>
    <item>
      <title>First Post</title>
      <link>https://example.com/first</link>
      <guid>https://example.com/first</guid>
      <pubDate>Wed, 02 Jul 2025 10:00:00 GMT</pubDate>
      <description>A short summary.</description>
      <content:encoded><![CDATA[<p>Full <strong>body</strong>.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Example</title>
  <link href="https://atom.example.com" rel="alternate"/>
  <entry>
    <title>Atom Entry</title>
    <link href="https://atom.example.com/e1" rel="alternate"/>
    <id>urn:uuid:1</id>
    <updated>2025-07-01T12:00:00Z</updated>
    <summary>Atom summary.</summary>
    <content type="html">&lt;p&gt;Atom body.&lt;/p&gt;</content>
  </entry>
</feed>`;

const JSON_FEED = JSON.stringify({
  version: 'https://jsonfeed.org/version/1.1',
  title: 'JSON Example',
  home_page_url: 'https://json.example.com',
  items: [
    {
      id: 'j1',
      url: 'https://json.example.com/1',
      title: 'JSON Item',
      date_published: '2025-07-03T09:00:00Z',
      summary: 'JSON summary.',
      content_html: '<p>JSON body.</p>',
    },
  ],
});

describe('parseFeed', () => {
  it('parses RSS 2.0 channel metadata and items', () => {
    const feed = parseFeed(RSS, 'https://example.com/feed.xml');
    expect(feed.title).toBe('Example Blog');
    expect(feed.siteUrl).toBe('https://example.com');
    expect(feed.items).toHaveLength(1);
    const item = feed.items[0]!;
    expect(item.title).toBe('First Post');
    expect(item.link).toBe('https://example.com/first');
    expect(item.id).toBe('https://example.com/first');
    expect(item.summary).toBe('A short summary.');
    expect(item.contentHtml).toContain('<strong>body</strong>');
    expect(item.publishedAt).toBe(new Date('Wed, 02 Jul 2025 10:00:00 GMT').toISOString());
    expect(item.read).toBe(false);
  });

  it('parses Atom feeds, preferring alternate link and content', () => {
    const feed = parseFeed(ATOM, 'https://atom.example.com/feed');
    expect(feed.title).toBe('Atom Example');
    expect(feed.items[0]!.link).toBe('https://atom.example.com/e1');
    expect(feed.items[0]!.id).toBe('urn:uuid:1');
    expect(feed.items[0]!.contentHtml).toContain('Atom body.');
  });

  it('parses JSON Feed 1.1', () => {
    const feed = parseFeed(JSON_FEED, 'https://json.example.com/feed.json');
    expect(feed.title).toBe('JSON Example');
    expect(feed.items[0]!.link).toBe('https://json.example.com/1');
    expect(feed.items[0]!.contentHtml).toBe('<p>JSON body.</p>');
  });

  it('falls back to the item link as id when no guid is present', () => {
    const noGuid = RSS.replace('<guid>https://example.com/first</guid>', '');
    expect(parseFeed(noGuid, 'https://example.com/feed.xml').items[0]!.id).toBe(
      'https://example.com/first',
    );
  });

  it('throws on documents that are neither RSS/Atom nor JSON Feed', () => {
    expect(() => parseFeed('<html><body>not a feed</body></html>', 'https://x/y')).toThrow(
      'Unrecognized feed format',
    );
  });
});
