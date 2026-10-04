import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Book } from '@/types/book';
import { createBookshelf } from '@/services/bookshelves/definitions';
import BookshelfStream from '@/app/library/components/BookshelfStream';

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
afterEach(cleanup);

const book: Book = {
  hash: 'one',
  title: 'One',
  author: 'Writer',
  format: 'EPUB',
  createdAt: 1,
  updatedAt: 1,
};

describe('bookshelf stream import action', () => {
  it('stays hidden until the shelves render, so it never flashes at the top', () => {
    // jsdom has no layout, so Virtuoso mounts its footer but never renders a row.
    render(
      <BookshelfStream
        sections={[{ definition: createBookshelf('books', 'books'), items: [book] }]}
        autoColumns={false}
        fixedColumns={3}
        importAction={<button type='button'>Import Books</button>}
        renderItem={() => null}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Import Books' })).toBeNull();
  });
});
