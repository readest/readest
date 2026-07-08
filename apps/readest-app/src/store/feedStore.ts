import { create } from 'zustand';
import { fetchAndParseFeed } from '@/services/rss/feedClient';
import type { ParsedFeed, RssFeed, RssFeedItem } from '@/types/rss';

type Fetcher = (url: string) => Promise<ParsedFeed>;

interface FeedState {
  feeds: RssFeed[];
  hydrate: (feeds: RssFeed[]) => void;
  addFeed: (url: string, fetcher?: Fetcher) => Promise<RssFeed>;
  removeFeed: (id: string) => void;
  refreshFeed: (id: string, fetcher?: Fetcher) => Promise<void>;
  markItemRead: (feedId: string, itemId: string, read?: boolean) => void;
  unreadCount: (feedId: string) => number;
}

const mergeItems = (existing: RssFeedItem[], incoming: RssFeedItem[]): RssFeedItem[] => {
  const readById = new Map(existing.map((i) => [i.id, i.read]));
  const known = new Map(existing.map((i) => [i.id, i]));
  const merged: RssFeedItem[] = [];
  for (const item of incoming) {
    if (!known.has(item.id)) merged.push({ ...item, read: false });
  }
  for (const item of incoming) {
    if (known.has(item.id)) merged.push({ ...item, read: readById.get(item.id) ?? false });
  }
  // Keep any previously-stored items the new fetch dropped (feeds truncate).
  for (const item of existing) {
    if (!incoming.some((i) => i.id === item.id)) merged.push(item);
  }
  return merged;
};

export const useFeedStore = create<FeedState>((set, get) => ({
  feeds: [],
  hydrate: (feeds) => set({ feeds }),
  addFeed: async (url, fetcher = fetchAndParseFeed) => {
    if (get().feeds.some((f) => f.url === url)) {
      throw new Error('You are already subscribed to this feed.');
    }
    const parsed = await fetcher(url);
    const feed: RssFeed = {
      id: url,
      url,
      title: parsed.title,
      siteUrl: parsed.siteUrl,
      description: parsed.description,
      iconUrl: parsed.iconUrl,
      addedAt: Date.now(),
      lastFetchedAt: Date.now(),
      items: parsed.items.map((i) => ({ ...i, read: false })),
    };
    set((s) => ({ feeds: [feed, ...s.feeds] }));
    return feed;
  },
  removeFeed: (id) => set((s) => ({ feeds: s.feeds.filter((f) => f.id !== id) })),
  refreshFeed: async (id, fetcher = fetchAndParseFeed) => {
    const feed = get().feeds.find((f) => f.id === id);
    if (!feed) return;
    try {
      const parsed = await fetcher(feed.url);
      set((s) => ({
        feeds: s.feeds.map((f) =>
          f.id === id
            ? {
                ...f,
                title: parsed.title || f.title,
                items: mergeItems(f.items, parsed.items),
                lastFetchedAt: Date.now(),
                errorMessage: undefined,
              }
            : f,
        ),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        feeds: s.feeds.map((f) => (f.id === id ? { ...f, errorMessage: message } : f)),
      }));
    }
  },
  markItemRead: (feedId, itemId, read = true) =>
    set((s) => ({
      feeds: s.feeds.map((f) =>
        f.id === feedId
          ? { ...f, items: f.items.map((i) => (i.id === itemId ? { ...i, read } : i)) }
          : f,
      ),
    })),
  unreadCount: (feedId) =>
    get()
      .feeds.find((f) => f.id === feedId)
      ?.items.filter((i) => !i.read).length ?? 0,
}));
