// @vitest-environment happy-dom
import { Profiler } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import RSVPControl from '@/app/reader/components/rsvp/RSVPControl';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import type { BookProgress } from '@/types/book';

// The speed-reading control stays mounted while reading and points its
// overlay at the current chapter. Of the progress it uses only the chapter, so
// a page turn within one must not re-render it.

vi.mock('@/app/reader/components/rsvp/RSVPOverlay', () => ({ default: () => null }));
vi.mock('@/app/reader/components/rsvp/RSVPStartDialog', () => ({ default: () => null }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/store/readerStore', () => {
  const state = {
    getView: () => null,
    getProgress: () => null,
    getViewSettings: () => null,
    getViewState: () => null,
  };
  return {
    useReaderStore: <R,>(selector?: (s: typeof state) => R) => (selector ? selector(state) : state),
  };
});
vi.mock('@/store/bookDataStore', () => {
  const state = {
    getBookData: () => ({ book: { format: 'EPUB' }, bookDoc: { toc: [] } }),
    getConfig: () => null,
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
  };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ themeCode: { primary: '#000' } }),
}));

const turnTo = (page: number, sectionHref: string) =>
  act(() =>
    setBookProgress('book-1', {
      location: `epubcfi(/6/4!/4/${2 * page + 2})`,
      sectionHref,
    } as unknown as BookProgress),
  );

afterEach(() => {
  cleanup();
  clearBookProgress('book-1');
});

describe('RSVPControl on a page turn', () => {
  it('does not re-render for a turn within the chapter', () => {
    turnTo(1, 'ch1.xhtml');
    const onRender = vi.fn();
    render(
      <Profiler id='rsvp' onRender={onRender}>
        <RSVPControl bookKey='book-1' gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />
      </Profiler>,
    );
    onRender.mockClear();

    turnTo(2, 'ch1.xhtml');
    turnTo(3, 'ch1.xhtml');

    expect(onRender).not.toHaveBeenCalled();
  });

  it('follows a turn into the next chapter', () => {
    turnTo(1, 'ch1.xhtml');
    const onRender = vi.fn();
    render(
      <Profiler id='rsvp' onRender={onRender}>
        <RSVPControl bookKey='book-1' gridInsets={{ top: 0, bottom: 0, left: 0, right: 0 }} />
      </Profiler>,
    );
    onRender.mockClear();

    turnTo(0, 'ch2.xhtml');

    expect(onRender).toHaveBeenCalled();
  });
});
