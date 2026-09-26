import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { Book } from '@/types/book';
import { createBookshelf } from '@/services/bookshelves/definitions';
import { BookshelfCarousel, type ShelfSection } from '@/app/library/components/BookshelfStream';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
beforeAll(() => {
  // jsdom has no ResizeObserver; the carousel only uses it to measure itself.
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(cleanup);
const section = (count: number): ShelfSection => ({
  definition: { ...createBookshelf('Carousel', 'carousel') },
  items: Array.from({ length: count }, (_, index) => ({
    hash: `${index}`,
    title: `Book ${index}`,
    author: 'Writer',
    format: 'EPUB',
    createdAt: index,
    updatedAt: index,
  })) satisfies Book[],
});
const WIDTH = 900;
const COLUMNS = 6;
const ITEM_WIDTH = (WIDTH - 16) / COLUMNS;
let rendered = 0;
const renderItem = (item: Book | { id: string }) => {
  rendered += 1;
  return <div data-book={'hash' in item ? item.hash : item.id} />;
};
const mount = (count: number) =>
  render(
    <BookshelfCarousel
      section={section(count)}
      width={WIDTH}
      columns={COLUMNS}
      renderItem={renderItem}
    />,
  );
const scrollTo = (container: HTMLElement, left: number) => {
  const scroller = container.querySelector<HTMLElement>('.overflow-x-auto')!;
  scroller.scrollLeft = left;
  fireEvent.scroll(scroller);
};

describe('bookshelf carousel window', () => {
  it('keeps rendering cards when the shelf shrinks while scrolled to the end', () => {
    const { container, rerender } = mount(100);
    scrollTo(container, ITEM_WIDTH * 90);
    expect(container.querySelectorAll('[data-book]').length).toBeGreaterThan(0);
    rerender(
      <BookshelfCarousel
        section={section(20)}
        width={WIDTH}
        columns={COLUMNS}
        renderItem={renderItem}
      />,
    );
    expect(container.querySelectorAll('[data-book]').length).toBeGreaterThan(0);
  });
  it('re-renders only when the window or an edge arrow changes', () => {
    const { container } = mount(100);
    scrollTo(container, 40);
    rendered = 0;
    scrollTo(container, 45);
    scrollTo(container, 50);
    expect(rendered).toBe(0);
    scrollTo(container, ITEM_WIDTH * (COLUMNS + 1));
    expect(rendered).toBeGreaterThan(0);
  });
});
