// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useHandwriting } from '@/app/reader/hooks/useHandwriting';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import type { BookProgress } from '@/types/book';

// Ink is kept per section and placed against the text, so the hook follows the
// section, and the page only while there is ink to place or the pen is on.
// Every page turn writes a new progress: in a book with no ink and the pen off,
// a turn within a section must not re-render the overlay.

const h = vi.hoisted(() => {
  const readerState = {
    viewStates: { 'book-1': { drawingEnabled: false } },
    setDrawingEnabled: () => {},
    getView: (): unknown => null,
    getViewSettings: () => ({ scrolled: false }),
  };
  const settingsState = {
    settings: {
      globalReadSettings: {
        handwritingTool: 'pen',
        handwritingColor: '#1a1a1a',
        handwritingWidth: 0.004,
        handwritingMarkerColor: '#ffeb3b',
        handwritingMarkerWidth: 0.02,
      },
    },
  };
  return { readerState, settingsState };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    (selector?: (state: typeof h.readerState) => unknown) =>
      selector ? selector(h.readerState) : h.readerState,
    { getState: () => h.readerState },
  ),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => h.settingsState, { getState: () => h.settingsState }),
}));
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({
    getBookData: () => ({ isFixedLayout: false }),
    getConfig: () => ({ booknotes: [] }),
    setConfig: vi.fn(),
    saveConfig: vi.fn(),
  })),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));

const turnTo = (page: number, section: number) =>
  act(() =>
    setBookProgress('book-1', {
      location: `epubcfi(/6/${2 * section + 2}!/4/${2 * page + 2})`,
      section: { current: section, total: 9 },
      pageinfo: { current: page, total: 40 },
    } as unknown as BookProgress),
  );

afterEach(() => {
  cleanup();
  clearBookProgress('book-1');
  h.readerState.viewStates['book-1'].drawingEnabled = false;
});

const renderCounted = () => {
  let renders = 0;
  renderHook(() => {
    renders++;
    return useHandwriting('book-1');
  });
  return () => renders;
};

describe('useHandwriting on a page turn', () => {
  it('does not re-render for a turn within the section in a book with no ink and the pen off', () => {
    turnTo(1, 3);
    const renders = renderCounted();
    const before = renders();

    turnTo(2, 3);
    turnTo(3, 3);

    expect(renders()).toBe(before);
  });

  it('follows a turn into the next section', () => {
    turnTo(1, 3);
    const renders = renderCounted();
    const before = renders();

    turnTo(0, 4);

    expect(renders()).toBeGreaterThan(before);
  });

  it('follows every turn while the pen is on', () => {
    h.readerState.viewStates['book-1'].drawingEnabled = true;
    turnTo(1, 3);
    const renders = renderCounted();
    const before = renders();

    turnTo(2, 3);

    expect(renders()).toBeGreaterThan(before);
  });
});
