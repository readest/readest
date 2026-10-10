import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import type { OPDSFeed, OPDSPublication } from '@/types/opds';
import { FeedView } from '@/app/opds/components/FeedView';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/components/CachedImage', () => ({
  CachedImage: () => <div />,
}));
await import('@/styles/globals.css');

afterEach(cleanup);

const WAIT = { timeout: 5000 };

const feedOf = (count: number): OPDSFeed => ({
  metadata: { title: 'Catalog' },
  links: [],
  publications: Array.from(
    { length: count },
    (_, index): OPDSPublication => ({
      metadata: { id: `urn:book:${index}`, title: `Book ${index}` },
      links: [],
      images: [],
    }),
  ),
});

const renderFeed = (feed: OPDSFeed, scrollKey?: string) =>
  render(
    <div style={{ width: 900, height: 600 }}>
      <FeedView
        feed={feed}
        baseURL='https://opds.example.com/opds'
        resolveURL={(href, base) => new URL(href, base).toString()}
        onNavigate={vi.fn()}
        onPublicationSelect={vi.fn()}
        onGenerateCachedImageUrl={vi.fn(async (url: string) => url)}
        isOPDSCatalog={() => true}
        scrollKey={scrollKey}
      />
    </div>,
  );

const scrollerOf = (root: HTMLElement) =>
  root.querySelector<HTMLElement>('[data-virtuoso-scroller]')!;

const firstVisible = (root: HTMLElement) => {
  const top = scrollerOf(root).getBoundingClientRect().top;
  const card = Array.from(root.querySelectorAll<HTMLElement>('[data-index]')).find(
    (el) => el.getBoundingClientRect().bottom > top,
  );
  return card?.textContent?.match(/Book \d+/)?.[0];
};

describe('OPDS feed scroll position in Chromium', () => {
  it('returns to the same place after the feed remounts (opening a book and coming back)', async () => {
    const first = renderFeed(feedOf(400), 'https://opds.example.com/opds/all');
    const scroller = scrollerOf(first.container);
    await waitFor(() => expect(scroller.scrollHeight).toBeGreaterThan(5000), WAIT);
    scroller.scrollTop = 4000;
    fireEvent.scroll(scroller);
    await waitFor(() => expect(firstVisible(first.container)).not.toMatch(/^Book [0-9]$/), WAIT);
    const scrollTop = scroller.scrollTop;
    const book = firstVisible(first.container);
    expect(scrollTop).toBeGreaterThan(0);
    first.unmount();

    const second = renderFeed(feedOf(400), 'https://opds.example.com/opds/all');
    await waitFor(() => expect(scrollerOf(second.container).scrollTop).toBe(scrollTop), WAIT);
    await waitFor(() => expect(firstVisible(second.container)).toBe(book), WAIT);
    second.unmount();

    // A different feed has its own position: it starts at the top.
    const other = renderFeed(feedOf(400), 'https://opds.example.com/opds/other');
    await waitFor(
      () => expect(scrollerOf(other.container).scrollHeight).toBeGreaterThan(5000),
      WAIT,
    );
    expect(scrollerOf(other.container).scrollTop).toBe(0);
    other.unmount();

    // Same key but different entries: the saved offset no longer applies.
    const changed = renderFeed(feedOf(250), 'https://opds.example.com/opds/all');
    await waitFor(
      () => expect(scrollerOf(changed.container).scrollHeight).toBeGreaterThan(3000),
      WAIT,
    );
    expect(scrollerOf(changed.container).scrollTop).toBe(0);
  });
});
