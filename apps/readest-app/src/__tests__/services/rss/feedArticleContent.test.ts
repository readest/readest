import { describe, expect, it } from 'vitest';
import { resolveArticleHtml, extractArticle } from '@/services/rss/feedArticleContent';
import type { RssFeedItem } from '@/types/rss';

const item = (over: Partial<RssFeedItem>): RssFeedItem => ({
  id: '1',
  title: 'A',
  link: 'https://x/a',
  read: false,
  ...over,
});

describe('resolveArticleHtml', () => {
  it('uses feed content when substantial', () => {
    const html = `<p>${'word '.repeat(60)}</p>`;
    expect(resolveArticleHtml(item({ contentHtml: html }))).toEqual({ html });
  });
  it('needs a page fetch when thin', () => {
    expect(resolveArticleHtml(item({ contentHtml: undefined }))).toEqual({ needsPage: true });
  });
});

describe('extractArticle', () => {
  it('extracts readable content and strips scripts', () => {
    const page = `<html><body><article><h1>Hi</h1>${'<p>Readable paragraph here.</p>'.repeat(10)}<script>evil()</script></article></body></html>`;
    const out = extractArticle(page, 'https://x/a');
    expect(out).toContain('Readable paragraph');
    expect(out).not.toContain('<script');
  });
  it('resolves relative img src to absolute URL via base injection', () => {
    const page = `<html><body><article><h1>Img</h1>${'<p>Words here for readability.</p>'.repeat(10)}<img src="/photo.jpg"/></article></body></html>`;
    const out = extractArticle(page, 'https://example.com/article');
    expect(out).toContain('https://example.com/photo.jpg');
  });
});
