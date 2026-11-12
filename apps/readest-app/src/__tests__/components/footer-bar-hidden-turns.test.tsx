import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import FooterBar from '@/app/reader/components/footerbar/FooterBar';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import type { BookProgress, PageInfo } from '@/types/book';

// The footer bar is hidden while reading. A page turn writes a new position
// and the book's progress into bookDataStore, and a progress save
// writes it again; re-rendering the hidden bar's panels and ~40 buttons on
// each of those cost the Kindle ~1 s of CPU per turn.

const counts = vi.hoisted(() => ({ buttons: 0, panels: 0, panelFraction: -1 }));
// A store hook called with a selector, or without one for the whole state.
const { storeHook } = vi.hoisted(() => ({
  storeHook:
    <T extends object>(state: T) =>
    (select?: (s: T) => unknown) =>
      select ? select(state) : state,
}));

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobile: true } }) }));
vi.mock('@/app/reader/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: () => {} }));
vi.mock('@/app/reader/hooks/useWindowFocusRestore', () => ({
  useWindowFocusRestore: () => () => false,
}));
vi.mock('@/app/reader/components/tts/TTSControl', () => ({ default: () => null }));
vi.mock('@/app/reader/components/rsvp', () => ({ RSVPControl: () => null }));
vi.mock('@/components/Button', () => ({
  default: ({ label }: { label?: string }) => {
    counts.buttons++;
    return <button aria-label={label} />;
  },
}));
vi.mock('@/app/reader/components/footerbar/NavigationPanel', () => ({
  NavigationPanel: ({ progressFraction }: { progressFraction: number }) => {
    counts.panels++;
    counts.panelFraction = progressFraction;
    return null;
  },
}));
vi.mock('@/app/reader/components/footerbar/FontLayoutPanel', () => ({
  FontLayoutPanel: () => {
    counts.panels++;
    return null;
  },
}));
vi.mock('@/app/reader/components/footerbar/ColorPanel', () => ({
  ColorPanel: () => {
    counts.panels++;
    return null;
  },
}));
vi.mock('@/app/reader/components/footerbar/NavigationBar', () => ({
  NavigationBar: () => {
    counts.panels++;
    return null;
  },
}));
vi.mock('@/app/reader/components/footerbar/PageJumpInput', () => ({ default: () => null }));

vi.mock('@/store/readerStore', () => {
  const useReaderStore = create(() => ({
    hoveredBookKey: '' as string | null,
    bottomBarTab: '',
    viewStates: {
      'book-1': { key: 'book-1', gridInsets: null, inited: false },
    } as Record<string, object>,
    setHoveredBookKey: (key: string | null) => useReaderStore.setState({ hoveredBookKey: key }),
    setBottomBarTab: (tab: string) => useReaderStore.setState({ bottomBarTab: tab }),
    getView: () => null,
    getViewState: () => null,
    getProgress: () => null,
    getViewSettings: () => null,
  }));
  return { useReaderStore };
});
vi.mock('@/store/bookDataStore', () => {
  const useBookDataStore = create(() => ({
    config: { progress: [1, 100], location: 'a' } as object,
    getConfig: () => useBookDataStore.getState().config,
    setConfig: () => {},
    getBookData: () => ({ isFixedLayout: false }),
  }));
  // as the real hooks: the book's data without its config, and the config
  // without the progress and location a page turn writes, compared shallowly
  const useBookData = () => useBookDataStore(useShallow(() => ({ isFixedLayout: false })));
  const useBookConfig = () =>
    useBookDataStore(
      useShallow((s) => {
        const { progress: _p, location: _l, ...rest } = s.config as Record<string, unknown>;
        return rest;
      }),
    );
  return { useBookDataStore, useBookData, useBookConfig };
});
// Store actions are stable references, as zustand's are.
vi.mock('@/store/sidebarStore', () => {
  const state = { isSideBarVisible: false, isSideBarPinned: false, setSideBarVisible: () => {} };
  return { useSidebarStore: storeHook(state) };
});
vi.mock('@/store/deviceStore', () => {
  const state = { acquireBackKeyInterception: () => {}, releaseBackKeyInterception: () => {} };
  return { useDeviceControlStore: storeHook(state) };
});
vi.mock('@/store/themeStore', () => ({
  useThemeStore: (select: (s: { isIPhoneDuo: boolean }) => unknown) =>
    select({ isIPhoneDuo: false }),
}));

// The mocked stores, typed as the test's own (the real modules' types differ).
const { useReaderStore } = (await import('@/store/readerStore')) as unknown as {
  useReaderStore: StoreApi<{
    hoveredBookKey: string | null;
    viewStates: Record<string, object>;
  }>;
};
const { useBookDataStore } = (await import('@/store/bookDataStore')) as unknown as {
  useBookDataStore: StoreApi<{ config: object }>;
};

const insets = { top: 0, right: 0, bottom: 0, left: 0 };
const page = (current: number): PageInfo => ({ current, total: 100 });
const footer = () => (
  <FooterBar bookKey='book-1' bookFormat='EPUB' isHoveredAnim={false} gridInsets={insets} />
);
const turnTo = (current: number) =>
  setBookProgress('book-1', { section: page(0), pageinfo: page(current) } as BookProgress);

// A hidden footer of a book whose first page is on screen
beforeEach(() => {
  counts.buttons = 0;
  counts.panels = 0;
  useReaderStore.setState({
    hoveredBookKey: '',
    viewStates: { 'book-1': { key: 'book-1', gridInsets: null, inited: true } },
  });
});

afterEach(() => {
  cleanup();
  clearBookProgress('book-1');
  vi.useRealTimers();
});

const updateViewState = (change: object) =>
  act(() =>
    useReaderStore.setState((s) => ({
      viewStates: { 'book-1': { ...s.viewStates['book-1'], ...change } },
    })),
  );

describe('FooterBar while hidden', () => {
  it('re-renders none of its panels or buttons on page turns and progress saves', () => {
    act(() => turnTo(1));
    render(footer());
    expect(counts.buttons).toBeGreaterThan(0);
    counts.buttons = 0;
    counts.panels = 0;

    // a page turn: a new position, and the progress written into the book's config
    act(() => {
      turnTo(2);
      useBookDataStore.setState({ config: { progress: [3, 100], location: 'b' } });
    });
    // the progress save that follows
    act(() => useBookDataStore.setState({ config: { progress: [3, 100], updatedAt: 1 } }));

    expect(counts.buttons).toBe(0);
    expect(counts.panels).toBe(0);

    // shown, it catches up with the position in the render that shows it
    act(() => useReaderStore.setState({ hoveredBookKey: 'book-1' }));
    expect(counts.panelFraction).toBe(0.03);
  });

  // Opening a book sets the page area's insets, which the footer doesn't show
  it('re-renders none of its buttons when the page insets are set', () => {
    render(footer());
    expect(counts.buttons).toBeGreaterThan(0);
    counts.buttons = 0;
    counts.panels = 0;
    updateViewState({ gridInsets: { top: 10, right: 0, bottom: 0, left: 0 } });
    expect(counts.buttons).toBe(0);
    expect(counts.panels).toBe(0);
  });
});

// Building the hidden footer's bars and panels was a large share of the work between tapping a
// book and seeing its page on an e-ink reader running QuickJS (Readest Lite)
describe('FooterBar while a book opens', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    updateViewState({ inited: false });
  });

  it('builds its bars and panels once the first page has been painted', () => {
    render(footer());
    expect(counts.buttons).toBe(0);
    expect(counts.panels).toBe(0);

    // the view went to the first page; it is painted with the next frame
    updateViewState({ inited: true });
    expect(counts.buttons).toBe(0);
    act(() => vi.advanceTimersToNextFrame());
    act(() => vi.runOnlyPendingTimers());
    expect(counts.buttons).toBeGreaterThan(0);
    expect(counts.panels).toBeGreaterThan(0);
  });

  it('builds them at once when shown before the first page is', () => {
    render(footer());
    act(() => useReaderStore.setState({ hoveredBookKey: 'book-1' }));
    expect(counts.buttons).toBeGreaterThan(0);
    expect(counts.panels).toBeGreaterThan(0);
  });
});
