import { beforeEach, describe, expect, it } from 'vitest';
import { useFeedStore } from '@/store/feedStore';
import type { ParsedFeed } from '@/types/rss';

const parsed = (title: string, itemIds: string[]): ParsedFeed => ({
  title,
  siteUrl: 'https://s.example.com',
  items: itemIds.map((id) => ({
    id,
    title: `T-${id}`,
    link: `https://s.example.com/${id}`,
    read: false,
  })),
});

beforeEach(() => {
  useFeedStore.setState({ feeds: [] });
});

describe('feedStore', () => {
  it('adds a subscription from a fetched feed', async () => {
    const feed = await useFeedStore
      .getState()
      .addFeed('https://s.example.com/feed', async () => parsed('Blog', ['a', 'b']));
    expect(feed.title).toBe('Blog');
    expect(useFeedStore.getState().feeds).toHaveLength(1);
    expect(useFeedStore.getState().unreadCount(feed.id)).toBe(2);
  });

  it('rejects a duplicate subscription', async () => {
    const f = async () => parsed('Blog', ['a']);
    await useFeedStore.getState().addFeed('https://s.example.com/feed', f);
    await expect(useFeedStore.getState().addFeed('https://s.example.com/feed', f)).rejects.toThrow(
      /already subscribed/i,
    );
  });

  it('merges new items on refresh and preserves read flags', async () => {
    const feed = await useFeedStore
      .getState()
      .addFeed('https://s.example.com/feed', async () => parsed('Blog', ['a', 'b']));
    useFeedStore.getState().markItemRead(feed.id, 'a');
    expect(useFeedStore.getState().unreadCount(feed.id)).toBe(1);

    await useFeedStore.getState().refreshFeed(feed.id, async () => parsed('Blog', ['c', 'a', 'b']));
    const items = useFeedStore.getState().feeds[0]!.items;
    expect(items.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
    expect(items.find((i) => i.id === 'a')!.read).toBe(true); // preserved
    expect(items.find((i) => i.id === 'c')!.read).toBe(false); // new -> unread
    expect(useFeedStore.getState().unreadCount(feed.id)).toBe(2);
  });

  it('records an error message when refresh fails', async () => {
    const feed = await useFeedStore
      .getState()
      .addFeed('https://s.example.com/feed', async () => parsed('Blog', ['a']));
    await useFeedStore.getState().refreshFeed(feed.id, async () => {
      throw new Error('boom');
    });
    expect(useFeedStore.getState().feeds[0]!.errorMessage).toBe('boom');
  });
});
