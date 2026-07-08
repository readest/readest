import { describe, expect, it } from 'vitest';
import { resolveArticleInput, handleOpenArticle } from '@/services/rss/articleIngest';
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

describe('handleOpenArticle', () => {
  it('imports, marks read, and navigates on success', async () => {
    const calls: string[] = [];
    await handleOpenArticle({} as never, {
      openArticle: async () => ({ hash: 'h1', title: 'A' }) as never,
      updateBooks: async () => void calls.push('update'),
      markRead: () => calls.push('read'),
      navigate: (hash) => calls.push(`nav:${hash}`),
      onError: () => calls.push('error'),
    });
    expect(calls).toEqual(['update', 'read', 'nav:h1']);
  });

  it('reports an error and does not navigate on failure', async () => {
    const calls: string[] = [];
    await handleOpenArticle({} as never, {
      openArticle: async () => {
        throw new Error('fetch failed');
      },
      updateBooks: async () => void calls.push('update'),
      markRead: () => calls.push('read'),
      navigate: () => calls.push('nav'),
      onError: (m) => calls.push(`error:${m}`),
    });
    expect(calls).toEqual(['error:fetch failed']);
  });
});
