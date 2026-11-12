// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { Profiler } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BookmarkToggler from '@/app/reader/components/BookmarkToggler';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import type { BookProgress } from '@/types/book';

// The bookmark button sits in the hidden header and shows whether the page is
// bookmarked. Every page turn writes a new progress; a turn that leaves the
// page as bookmarked (or not) as before must not re-render the button.

const h = vi.hoisted(() => ({
  booknotes: [] as unknown[],
  setRibbon: vi.fn(),
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/settingsStore', () => {
  const state = { settings: {} };
  return { useSettingsStore: () => state };
});
vi.mock('@/store/readerStore', () => {
  const state = {
    getProgress: () => null,
    getViewState: () => null,
    setBookmarkRibbonVisibility: (...args: unknown[]) => h.setRibbon(...args),
  };
  return {
    useReaderStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
});
vi.mock('@/store/bookDataStore', () => {
  const config = {
    get booknotes() {
      return h.booknotes;
    },
  };
  return {
    ...bookDataStoreHooks(() => ({
      getConfig: () => config,
      getBookData: () => null,
    })),
  };
});

const at = (location: string) => ({ location }) as unknown as BookProgress;

beforeEach(() => {
  h.booknotes = [];
  h.setRibbon.mockClear();
});
afterEach(() => {
  cleanup();
  clearBookProgress('book-1');
});

const renderToggler = () => {
  const onRender = vi.fn();
  render(
    <Profiler id='bookmark' onRender={onRender}>
      <BookmarkToggler bookKey='book-1' />
    </Profiler>,
  );
  return onRender;
};

describe('BookmarkToggler on a page turn', () => {
  it('does not re-render for a turn between pages that are not bookmarked', () => {
    act(() => setBookProgress('book-1', at('epubcfi(/6/4!/4/2,/1:0,/1:10)')));
    const onRender = renderToggler();
    onRender.mockClear();

    act(() => setBookProgress('book-1', at('epubcfi(/6/4!/4/4,/1:0,/1:10)')));
    act(() => setBookProgress('book-1', at('epubcfi(/6/4!/4/6,/1:0,/1:10)')));

    expect(onRender).not.toHaveBeenCalled();
  });

  it('shows the ribbon on a turn onto a bookmarked page and hides it on the next', () => {
    h.booknotes = [{ id: 'b1', type: 'bookmark', cfi: 'epubcfi(/6/4!/4/4,/1:2,/1:3)' }];
    act(() => setBookProgress('book-1', at('epubcfi(/6/4!/4/2,/1:0,/1:10)')));
    renderToggler();
    expect(h.setRibbon).toHaveBeenLastCalledWith('book-1', false);

    act(() => setBookProgress('book-1', at('epubcfi(/6/4!/4/4,/1:0,/1:10)')));
    expect(h.setRibbon).toHaveBeenLastCalledWith('book-1', true);

    act(() => setBookProgress('book-1', at('epubcfi(/6/4!/4/6,/1:0,/1:10)')));
    expect(h.setRibbon).toHaveBeenLastCalledWith('book-1', false);
  });
});
