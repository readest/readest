// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import SearchResults from '@/app/reader/components/sidebar/SearchResults';
import { BookSearchResult } from '@/types/book';

const navState = vi.hoisted(() => ({ searchProgress: 1 }));
const readerStoreState = vi.hoisted(() => ({
  getProgress: () => ({ location: '' }),
  getView: () => null,
}));

vi.mock('@/store/readerStore', () => ({
  // Emulate zustand's selector semantics: with a selector return its result,
  // without (SearchResultItem's whole-store destructure) return the state.
  useReaderStore: (selector?: (s: typeof readerStoreState) => unknown) =>
    selector ? selector(readerStoreState) : readerStoreState,
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({
    getSearchNavState: () => ({
      searchProgress: navState.searchProgress,
      searchError: null,
    }),
  }),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

vi.mock('@/utils/cfi', () => ({
  findNearestCfi: () => null,
  isCfiInLocation: () => false,
}));

const makeResults = (): BookSearchResult[] =>
  ['Chapter One', 'Chapter Two'].map((label, chapter) => ({
    label,
    subitems: [0, 1].map((match) => ({
      cfi: `epubcfi(/6/${chapter + 2}!/4/${match + 1})`,
      excerpt: { pre: 'pre ', match: 'hit', post: ' post' },
    })),
  }));

const renderResults = (results = makeResults()) =>
  render(<SearchResults bookKey='book-1' results={results} onSelectResult={vi.fn()} />);

const resultItems = () => screen.getAllByRole('button').filter((el) => el.tagName === 'LI');

describe('SearchResults chapter sections', () => {
  afterEach(() => {
    cleanup();
    navState.searchProgress = 1;
  });

  it('collapses and expands a chapter section when its header is toggled', () => {
    renderResults();
    expect(resultItems()).toHaveLength(4);

    const header = screen.getByRole('button', { name: /Chapter One/ });
    fireEvent.click(header);
    expect(resultItems()).toHaveLength(2);
    expect(header.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(header);
    expect(resultItems()).toHaveLength(4);
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  // A new search resets searchProgress to 0 but leaves the previous results
  // mounted until the first hit arrives. Sections are keyed by index+label, so
  // without an explicit reset the reused key kept the section collapsed for
  // results the reader had never seen.
  it('expands every section again when a new search starts', () => {
    const { rerender } = renderResults();
    fireEvent.click(screen.getByRole('button', { name: /Chapter One/ }));
    expect(resultItems()).toHaveLength(2);

    navState.searchProgress = 0;
    rerender(<SearchResults bookKey='book-1' results={makeResults()} onSelectResult={vi.fn()} />);

    expect(resultItems()).toHaveLength(4);
    const header = screen.getByRole('button', { name: /Chapter One/ });
    expect(header.getAttribute('aria-expanded')).toBe('true');
  });

  it('styles the chapter header for RTL and e-ink', () => {
    renderResults();
    const header = screen.getByRole('button', { name: /Chapter One/ });

    // DESIGN.md 2.8: logical properties only, the sidebar flips direction for RTL books.
    expect(header.innerHTML).not.toMatch(/\bml-2\b/);
    expect(header.innerHTML).toMatch(/\bms-2\b/);
    // The sidebar itself is bg-base-100 under e-ink, so a bare bg-base-200 header
    // would render as a grey band there.
    const sticky = header.closest('h3')!;
    expect(sticky.className).toContain('eink:bg-base-100');
    expect(sticky.className).toContain('not-eink:bg-base-200');
  });
});

describe('SearchResults keyboard', () => {
  afterEach(() => {
    cleanup();
  });

  // A focused result keeps plain keys to itself, but Ctrl/Cmd+F must reach the
  // reader's window handlers so a repeated Ctrl+F selects the search term.
  it.each([
    ['Ctrl+F', true, { key: 'f', ctrlKey: true }],
    ['Cmd+F', true, { key: 'f', metaKey: true }],
    ['F', false, { key: 'f' }],
    ['ArrowDown', false, { key: 'ArrowDown' }],
  ])('%s from a focused result reaches the window: %s', (_name, reaches, init) => {
    renderResults();
    const onWindowKeyDown = vi.fn();
    window.addEventListener('keydown', onWindowKeyDown);
    fireEvent.keyDown(resultItems()[0]!, init);
    window.removeEventListener('keydown', onWindowKeyDown);
    expect(onWindowKeyDown).toHaveBeenCalledTimes(reaches ? 1 : 0);
  });

  it('lets Search in Book bound to Ctrl+Enter through without opening the result', () => {
    localStorage.setItem('customShortcuts', JSON.stringify({ onShowSearchBar: ['ctrl+Enter'] }));
    try {
      const onSelectResult = vi.fn();
      render(
        <SearchResults bookKey='book-1' results={makeResults()} onSelectResult={onSelectResult} />,
      );
      const onWindowKeyDown = vi.fn();
      window.addEventListener('keydown', onWindowKeyDown);
      fireEvent.keyDown(resultItems()[0]!, { key: 'Enter', ctrlKey: true });
      window.removeEventListener('keydown', onWindowKeyDown);
      expect(onWindowKeyDown).toHaveBeenCalledTimes(1);
      expect(onSelectResult).not.toHaveBeenCalled();
    } finally {
      localStorage.removeItem('customShortcuts');
    }
  });

  it('lets a rebound Search in Book key through instead of Ctrl+F', () => {
    localStorage.setItem('customShortcuts', JSON.stringify({ onShowSearchBar: ['ctrl+e'] }));
    try {
      renderResults();
      const onWindowKeyDown = vi.fn();
      window.addEventListener('keydown', onWindowKeyDown);
      fireEvent.keyDown(resultItems()[0]!, { key: 'f', ctrlKey: true });
      fireEvent.keyDown(resultItems()[0]!, { key: 'e', ctrlKey: true });
      window.removeEventListener('keydown', onWindowKeyDown);
      expect(onWindowKeyDown.mock.calls.map(([event]) => event.key)).toEqual(['e']);
    } finally {
      localStorage.removeItem('customShortcuts');
    }
  });
});
