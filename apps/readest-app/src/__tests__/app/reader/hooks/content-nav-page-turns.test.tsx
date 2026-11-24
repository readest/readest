// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useBooknotesNav } from '@/app/reader/hooks/useBooknotesNav';
import { useSearchNav } from '@/app/reader/hooks/useSearchNav';
import { useSidebarStore } from '@/store/sidebarStore';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import type { BookNote, BookProgress, BookSearchMatch } from '@/types/book';

// The search and booknote bars find the results on the shown page. They stay
// mounted while reading; with no results there is nothing to find, so a page
// turn must not re-render them.

vi.mock('@/store/readerStore', () => {
  const state = { getView: () => null };
  return {
    useReaderStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});
vi.mock('@/store/bookDataStore', () => {
  const state = { getConfig: () => ({ booknotes: [] }) };
  return {
    useBookDataStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});

const turnTo = (page: number) =>
  act(() =>
    setBookProgress('book-1', {
      location: `epubcfi(/6/4!/4/${2 * page + 2},/1:0,/1:10)`,
    } as unknown as BookProgress),
  );

afterEach(() => {
  cleanup();
  clearBookProgress('book-1');
  act(() => {
    useSidebarStore.getState().clearSearch('book-1');
    useSidebarStore.getState().clearBooknotesNav('book-1');
  });
});

const countRenders = (hook: () => unknown) => {
  let renders = 0;
  renderHook(() => {
    renders++;
    return hook();
  });
  return () => renders;
};

describe.each([
  ['useSearchNav', () => useSearchNav('book-1')],
  ['useBooknotesNav', () => useBooknotesNav('book-1', [])],
])('%s on a page turn', (_name, hook) => {
  it('does not re-render without results', () => {
    turnTo(1);
    const renders = countRenders(hook);
    const before = renders();

    turnTo(2);
    turnTo(3);

    expect(renders()).toBe(before);
  });
});

describe('the bars with results', () => {
  // one result on page 1 and one on page 2: on page 2 the first is behind
  const cfis = ['epubcfi(/6/4!/4/4,/1:2,/1:5)', 'epubcfi(/6/4!/4/6,/1:2,/1:5)'];

  it('finds the search results on the page turned to', () => {
    const matches: BookSearchMatch[] = cfis.map((cfi) => ({
      cfi,
      excerpt: { pre: '', match: 'x', post: '' },
    }));
    act(() => useSidebarStore.getState().setSearchResults('book-1', matches));
    turnTo(1);
    const { result } = renderHook(() => useSearchNav('book-1'));
    expect(result.current.hasPreviousPage).toBe(false);

    turnTo(2);

    expect(result.current.hasPreviousPage).toBe(true);
    expect(result.current.hasNextPage).toBe(false);
  });

  it('finds the booknotes on the page turned to', () => {
    const notes = cfis.map((cfi, i) => ({ id: `n${i}`, type: 'annotation', cfi }) as BookNote);
    act(() => {
      useSidebarStore.getState().setActiveBooknoteType('book-1', 'annotation');
      useSidebarStore.getState().setBooknoteResults('book-1', notes);
    });
    turnTo(1);
    const { result } = renderHook(() => useBooknotesNav('book-1', []));
    expect(result.current.hasPreviousPage).toBe(false);

    turnTo(2);

    expect(result.current.hasPreviousPage).toBe(true);
    expect(result.current.hasNextPage).toBe(false);
  });
});
