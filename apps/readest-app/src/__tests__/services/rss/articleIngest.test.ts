import { describe, expect, it } from 'vitest';
import {
  resolveArticleInput,
  handleOpenArticle,
  openFeedArticle,
} from '@/services/rss/articleIngest';
import { md5Fingerprint } from '@/utils/md5';
import type { Book } from '@/types/book';
import type { RssFeed, RssFeedItem } from '@/types/rss';

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

describe('openFeedArticle grouping', () => {
  it('tags the imported article into the per-feed group (groupId + groupName)', async () => {
    const feed = {
      id: 'f',
      url: 'https://x/feed',
      title: 'My Feed',
      addedAt: 0,
      items: [],
    } as RssFeed;
    const feedItem = {
      id: 'i',
      title: 'T',
      link: 'https://x/a',
      read: false,
      contentHtml: `<p>${'word '.repeat(80)}</p>`,
    } as RssFeedItem;
    let captured: { groupId?: string; groupName?: string } | undefined;
    const book = await openFeedArticle({
      item: feedItem,
      feed,
      books: [],
      appService: {} as never,
      settings: {} as never,
      isLoggedIn: false,
      translate: (k: string) => k,
      convert: async () => ({ file: new File(['x'], 'a.epub'), title: 'T', author: '' }),
      ingest: (async (opts: { groupId?: string; groupName?: string }) => {
        captured = { groupId: opts.groupId, groupName: opts.groupName };
        return { hash: 'h1', title: 'T' } as Book;
      }) as never,
    });
    expect(book.hash).toBe('h1');
    expect(captured?.groupName).toBe('My Feed');
    expect(captured?.groupId).toBe(md5Fingerprint('My Feed'));
  });
});
