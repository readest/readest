import { describe, expect, it } from 'vitest';
import { resolveArticleInput } from '@/services/rss/articleIngest';
import type { RssFeedItem } from '@/types/rss';

const item = (over: Partial<RssFeedItem>): RssFeedItem => ({
  id: '1',
  title: 'A',
  link: 'https://x.example.com/a',
  read: false,
  ...over,
});

describe('resolveArticleInput', () => {
  it('uses feed content without network when contentHtml is substantial', () => {
    const html = `<p>${'word '.repeat(60)}</p>`;
    expect(resolveArticleInput(item({ contentHtml: html }), null)).toEqual({
      kind: 'article',
      html,
      url: 'https://x.example.com/a',
    });
  });

  it('falls back to page HTML when the feed has no full content', () => {
    const page = '<html><body><article>full</article></body></html>';
    expect(resolveArticleInput(item({ contentHtml: undefined }), page)).toEqual({
      kind: 'page',
      html: page,
      url: 'https://x.example.com/a',
    });
  });

  it('throws when there is neither feed content nor a fetched page', () => {
    expect(() => resolveArticleInput(item({ contentHtml: undefined }), null)).toThrow(
      /no full content/i,
    );
  });
});
