import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Book } from '@/types/book';
import { BookMetadata } from '@/libs/document';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

// BookItem pulls in Env/Auth/router/settings providers; the selection wiring
// under test lives in RecentShelf itself, so render a marker stub that records
// the select-mode props each slide passes down.
vi.mock('@/app/library/components/BookItem', () => ({
  default: ({
    book,
    isSelectMode,
    bookSelected,
  }: {
    book: Book;
    isSelectMode: boolean;
    bookSelected: boolean;
  }) => (
    <div
      data-testid={`book-item-${book.hash}`}
      data-select-mode={isSelectMode}
      data-selected={bookSelected}
    />
  ),
}));

import RecentShelf from '@/app/library/components/RecentShelf';

// jsdom has no ResizeObserver; the shelf only uses it to place scroll arrows.
beforeEach(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const createBook = (hash: string): Book =>
  ({
    hash,
    format: 'EPUB',
    title: `Book ${hash}`,
    author: 'Test Author',
    createdAt: 1000,
    updatedAt: 2000,
    progress: [1, 100],
    metadata: {} as BookMetadata,
  }) as Book;

const noop = () => {};

const baseProps = {
  books: [createBook('aaa'), createBook('bbb')],
  coverFit: 'crop' as const,
  autoColumns: true,
  fixedColumns: 6,
  handleBookUpload: noop,
  handleBookDownload: noop,
  showBookDetailsModal: noop,
  showTimeRemaining: false,
  isSelectMode: false,
  selectedBooks: new Set<string>(),
  toggleSelection: noop,
  handleSetSelectMode: noop,
};

const tapSlide = (title: string) => {
  const slide = screen.getByRole('button', { name: title });
  fireEvent.pointerDown(slide, { pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
  fireEvent.pointerUp(slide, { pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
};

describe('RecentShelf select mode', () => {
  it('tap toggles selection instead of opening the book while in select mode', () => {
    const onOpenBook = vi.fn();
    const toggleSelection = vi.fn();
    render(
      <RecentShelf
        {...baseProps}
        isSelectMode
        onOpenBook={onOpenBook}
        toggleSelection={toggleSelection}
      />,
    );

    tapSlide('Book aaa');

    expect(toggleSelection).toHaveBeenCalledWith('aaa');
    expect(onOpenBook).not.toHaveBeenCalled();
  });

  it('tap opens the book when not in select mode', () => {
    const onOpenBook = vi.fn();
    const toggleSelection = vi.fn();
    render(
      <RecentShelf {...baseProps} onOpenBook={onOpenBook} toggleSelection={toggleSelection} />,
    );

    tapSlide('Book aaa');

    expect(onOpenBook).toHaveBeenCalledWith(baseProps.books[0]);
    expect(toggleSelection).not.toHaveBeenCalled();
  });

  it('long-press enters select mode and selects the book, like the grid', () => {
    vi.useFakeTimers();
    const onOpenBook = vi.fn();
    const toggleSelection = vi.fn();
    const handleSetSelectMode = vi.fn();
    render(
      <RecentShelf
        {...baseProps}
        onOpenBook={onOpenBook}
        toggleSelection={toggleSelection}
        handleSetSelectMode={handleSetSelectMode}
      />,
    );

    const slide = screen.getByRole('button', { name: 'Book aaa' });
    fireEvent.pointerDown(slide, { pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });
    vi.advanceTimersByTime(600);
    fireEvent.pointerUp(slide, { pointerId: 1, clientX: 10, clientY: 10, pointerType: 'touch' });

    expect(handleSetSelectMode).toHaveBeenCalledWith(true);
    expect(toggleSelection).toHaveBeenCalledWith('aaa');
    expect(onOpenBook).not.toHaveBeenCalled();
  });

  it('keyboard activation toggles selection while in select mode', () => {
    const onOpenBook = vi.fn();
    const toggleSelection = vi.fn();
    render(
      <RecentShelf
        {...baseProps}
        isSelectMode
        onOpenBook={onOpenBook}
        toggleSelection={toggleSelection}
      />,
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Book bbb' }), { key: 'Enter' });

    expect(toggleSelection).toHaveBeenCalledWith('bbb');
    expect(onOpenBook).not.toHaveBeenCalled();
  });

  it('passes selection state down so the checkmark badge renders', () => {
    render(
      <RecentShelf
        {...baseProps}
        isSelectMode
        selectedBooks={new Set(['bbb'])}
        onOpenBook={noop}
      />,
    );

    expect(screen.getByTestId('book-item-aaa').dataset['selectMode']).toBe('true');
    expect(screen.getByTestId('book-item-aaa').dataset['selected']).toBe('false');
    expect(screen.getByTestId('book-item-bbb').dataset['selected']).toBe('true');
  });
});
