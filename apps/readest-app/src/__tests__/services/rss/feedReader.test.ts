import { describe, expect, it } from 'vitest';
import { refreshFeedManifest } from '@/services/rss/feedReader';
import { slotForArticleId } from '@/services/rss/feedManifest';
import type { FileSystem } from '@/types/system';
import type { ParsedFeed } from '@/types/rss';

function memFs() {
  const store = new Map<string, string>();
  const key = (p: string, b: string) => `${b}:${p}`;
  return {
    exists: async (p: string, b: string) => store.has(key(p, b)),
    readFile: async (p: string, b: string) => {
      const v = store.get(key(p, b));
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    writeFile: async (p: string, b: string, c: string) => {
      store.set(key(p, b), c);
    },
  } as unknown as FileSystem;
}

const parsed = (items: Array<{ id: string; contentHtml?: string }>): ParsedFeed => ({
  title: 'Blog',
  items: items.map((it) => ({
    id: it.id,
    title: `T-${it.id}`,
    link: `https://x/${it.id}`,
    read: false,
    contentHtml: it.contentHtml,
  })),
});

describe('refreshFeedManifest', () => {
  it('assigns slots and caches new entries once; page-fetches only thin ones', async () => {
    const fs = memFs();
    const extractCalls: string[] = [];
    const deps = {
      fetchAndParse: async () =>
        parsed([{ id: 'a', contentHtml: `<p>${'x '.repeat(120)}</p>` }, { id: 'b' }]),
      extractFor: async (e: FeedArticleEntryLike) => {
        extractCalls.push(e.id);
        return `<p>fetched ${e.id}</p>`;
      },
    };
    let m = await refreshFeedManifest(fs, 'feedhash', 'https://x/feed', 'Blog', deps);
    expect(m.entries.map((e) => e.id)).toEqual(['a', 'b']);
    expect(extractCalls).toEqual(['b']);

    deps.fetchAndParse = async () =>
      parsed([{ id: 'c' }, { id: 'a', contentHtml: `<p>${'x '.repeat(120)}</p>` }, { id: 'b' }]);
    m = await refreshFeedManifest(fs, 'feedhash', 'https://x/feed', 'Blog', deps);
    expect([...m.entries].map((e) => e.id).sort()).toEqual(['a', 'b', 'c']);
    expect(m.entries.find((e) => e.id === 'c')!.slot).toBe(slotForArticleId('c'));
    expect(extractCalls).toEqual(['b', 'c']);
  });

  it('one failing extraction does not abort the refresh', async () => {
    const fs = memFs();
    const deps = {
      fetchAndParse: async () =>
        parsed([{ id: 'good', contentHtml: `<p>${'x '.repeat(120)}</p>` }, { id: 'bad' }]),
      extractFor: async (e: FeedArticleEntryLike) => {
        if (e.id === 'bad') throw new Error('network fail');
        return '<p>ok</p>';
      },
    };
    const m = await refreshFeedManifest(fs, 'fh', 'https://x/feed', 'Blog', deps);
    // Both entries kept their manifest slots despite 'bad' failing:
    expect(m.entries.map((e) => e.id).sort()).toEqual(['bad', 'good']);
    // 'good' was cached from feed content; 'bad' skipped, not cached.
  });
});

type FeedArticleEntryLike = { id: string; link: string };
