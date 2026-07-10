import { describe, expect, it } from 'vitest';
import { discoverFeedUrls } from '@/services/rss/feedDiscovery';

describe('discoverFeedUrls', () => {
  it('extracts and absolutizes RSS/Atom/JSON alternate links', () => {
    const html = `<html><head>
      <link rel="alternate" type="application/rss+xml" href="/feed.xml">
      <link rel="alternate" type="application/atom+xml" href="https://cdn.example.com/atom">
      <link rel="alternate" type="application/json" href="feed.json">
      <link rel="stylesheet" href="/x.css">
    </head></html>`;
    expect(discoverFeedUrls(html, 'https://example.com/blog/')).toEqual([
      'https://example.com/feed.xml',
      'https://cdn.example.com/atom',
      'https://example.com/blog/feed.json',
    ]);
  });

  it('returns an empty array when no feed links are present', () => {
    expect(discoverFeedUrls('<html><head></head></html>', 'https://example.com')).toEqual([]);
  });
});
