import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import { createBookshelf } from '@/services/bookshelves/definitions';
import BookshelfStream, { type ShelfSection } from '@/app/library/components/BookshelfStream';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
// Renders only the footer and hands the test the row-render callback, so the
// test decides when rows are "on screen" (the real list never renders rows
// in jsdom, which has no layout).
const virtuoso = vi.hoisted(() => ({ itemsRendered: (_items: unknown[]) => {} }));
vi.mock('react-virtuoso', () => ({
  Virtuoso: ({
    components,
    context,
    itemsRendered,
  }: {
    components: { Footer: React.ComponentType<{ context: unknown }> };
    context: unknown;
    itemsRendered: (items: unknown[]) => void;
  }) => {
    virtuoso.itemsRendered = itemsRendered;
    return <components.Footer context={context} />;
  },
}));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);

const shelf = (id: string): ShelfSection[] => [
  {
    definition: createBookshelf(id, id),
    items: [
      {
        hash: id,
        title: id,
        author: 'Writer',
        format: 'EPUB',
        createdAt: 1,
        updatedAt: 1,
      } as Book,
    ],
  },
];
const stream = (sections: ShelfSection[]) => (
  <BookshelfStream
    sections={sections}
    autoColumns={false}
    fixedColumns={3}
    importAction={<button type='button'>Import Books</button>}
    renderItem={() => null}
  />
);
const importButton = () => screen.queryByRole('button', { name: 'Import Books' });

describe('bookshelf stream import action', () => {
  it('stays hidden until the shelves render, so it never flashes at the top', () => {
    render(stream(shelf('books')));
    expect(importButton()).toBeNull();
    act(() => virtuoso.itemsRendered([{}]));
    expect(importButton()).not.toBeNull();
  });

  it('hides again for another shelf until its rows render', () => {
    const { rerender } = render(stream(shelf('books')));
    act(() => virtuoso.itemsRendered([{}]));
    rerender(stream(shelf('other')));
    expect(importButton()).toBeNull();
    act(() => virtuoso.itemsRendered([{}]));
    expect(importButton()).not.toBeNull();
  });

  it('shows at once when there are no rows to wait for', () => {
    render(stream([]));
    expect(importButton()).not.toBeNull();
  });
});
