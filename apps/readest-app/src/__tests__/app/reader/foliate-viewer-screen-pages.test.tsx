import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import FoliateViewer from '@/app/reader/components/FoliateViewer';
import { useFoliateEvents } from '@/app/reader/hooks/useFoliateEvents';
import {
  clearChapterScreens,
  getChapterScreensVersion,
  getMeasuredChapterScreens,
  getScreenPageMap,
} from '@/utils/chapterScreens';

// Turning Stable Page Numbers off changes no layout, so nothing relocates.
// The loaded chapters have to be measured right away, or the footer keeps
// byte-grid numbers until the next page turn (#7445: "Toggling the Show
// Footer off and on is sometimes required").

const layout = vi.hoisted(() => ({
  contents: [] as { index: number; contentPages: number }[],
  page: 1,
}));
const { readerState, openGate, bookDataState, attrs, viewSettings } = vi.hoisted(() => {
  const viewSettings = {
    writingMode: 'auto',
    showHeader: true,
    vertical: false,
    compactMarginTopPx: 16,
    stablePageNumbers: true,
    disableDoubleClick: false,
  };
  return {
    attrs: new Map<string, string>(),
    bookDataState: { bookData: null as unknown },
    openGate: { pending: null as Promise<void> | null, started: false },
    viewSettings,
    readerState: {
      setProgress: vi.fn(),
      getViewState: () => ({}),
      getViewSettings: () => viewSettings,
      setView: () => {},
      setViewInited: () => {},
    },
  };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (s: typeof readerState) => unknown) => select(readerState),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (select: (s: { getBookData: () => unknown }) => unknown) =>
    select({ getBookData: () => bookDataState.bookData }),
}));
vi.mock('@/store/parallelViewStore', () => ({ useParallelViewStore: () => () => [] }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => ({ settings: {} }), { getState: () => ({ settings: {} }) }),
}));
vi.mock('@/store/themeStore', () => {
  const state = { isIPhoneDuo: false, duoFold: null, safeAreaInsets: null };
  const useThemeStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  return { useThemeStore: Object.assign(useThemeStore, { getState: () => state }) };
});
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ getLoadedFonts: () => [], getAvailableFonts: () => [] }),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({}) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => null }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/libs/document', () => ({}));
vi.mock('foliate-js/view.js', () => ({}));
vi.mock('@/types/view', () => ({
  wrappedFoliateView: (view: HTMLElement & { book?: unknown }) => {
    const anyCall: object = new Proxy(() => anyCall, { get: () => anyCall, apply: () => anyCall });
    return Object.assign(view, {
      open: async (book: unknown) => {
        view.book = book;
        openGate.started = true;
        await openGate.pending;
      },
      init: async () => {},
      goToFraction: async () => {},
      // Records the attributes the reader writes; everything else is a no-op.
      // On the second of chapter 1's six screens, chapter 2 preloaded.
      renderer: new Proxy(
        {
          setAttribute: (name: string, value: unknown) => attrs.set(name, String(value)),
          getAttribute: (name: string) => attrs.get(name) ?? null,
          removeAttribute: (name: string) => attrs.delete(name),
          primaryIndex: 1,
          get page() {
            return layout.page;
          },
          pages: 6,
          columnCount: 1,
          getContents: () => layout.contents,
        },
        {
          get: (target, key) => (key in target ? target[key as keyof typeof target] : anyCall),
        },
      ),
    });
  },
}));
vi.mock('@/utils/style', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getStyles: () => '',
}));
vi.mock('@/services/transformService', () => ({}));
vi.mock('@/app/reader/utils/wordlensSection', () => ({}));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: vi.fn() }));
vi.mock('@/app/reader/hooks/useBrightnessGesture', () => ({ useBrightnessGesture: () => ({}) }));
// Stable, as the hook's useCallback is: a new function per render would
// recreate commitRelocate, whose effect cleanup drops the measurements.
const isWipeAhead = vi.hoisted(() => () => false);
vi.mock('@/app/reader/hooks/useAutoScroll', () => ({
  useAutoScroll: () => ({ isWipeAhead }),
}));
vi.mock('@/app/reader/hooks/useAutoScrollSpeedGesture', () => ({
  useAutoScrollSpeedGesture: () => ({}),
}));
vi.mock('@/app/reader/hooks/useMiddleClickAutoscroll', () => ({
  useMiddleClickAutoscroll: () => null,
}));
vi.mock('@/app/reader/hooks/useKOSync', () => ({ useKOSync: () => ({}) }));
vi.mock('@/app/reader/hooks/useIframeEvents', () => ({
  useMouseEvent: () => ({}),
  useTouchEvent: () => ({}),
  useOpenMediaEvent: () => {},
}));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({
  useCapturedTurn: () => {},
  applyPageTurnAttributes: () => {},
}));
vi.mock('@/app/reader/hooks/usePagination', () => ({ usePagination: () => ({}) }));
vi.mock('@/app/reader/hooks/useProgressSync', () => ({ useProgressSync: () => {} }));
vi.mock('@/app/reader/hooks/useABSProgressSync', () => ({ useABSProgressSync: () => {} }));
vi.mock('@/app/reader/hooks/useProgressAutoSave', () => ({ useProgressAutoSave: () => {} }));
vi.mock('@/app/reader/hooks/useAutoSaveBookCover', () => ({ useBookCoverAutoSave: () => {} }));
vi.mock('@/app/reader/hooks/useFileSync', () => ({ useFileSync: () => {} }));
vi.mock('@/app/reader/hooks/useTextTranslation', () => ({ useTextTranslation: () => {} }));
vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: vi.fn() }),
}));
vi.mock('@/hooks/useAutoFocus', () => ({ useAutoFocus: () => {} }));
vi.mock('@/hooks/useEinkMode', () => ({ useEinkMode: () => ({ applyEinkMode: () => {} }) }));
vi.mock('@/hooks/useUICSS', () => ({ useUICSS: () => {} }));
vi.mock('@/hooks/useDiscordPresence', () => ({ useDiscordPresence: () => {} }));
vi.mock('@/app/reader/hooks/bookOrbitProgressProvider', () => ({ bookOrbitProgressProvider: {} }));
vi.mock('@/app/reader/hooks/grimmoryProgressProvider', () => ({ grimmoryProgressProvider: {} }));
vi.mock('@/app/reader/components/paragraph', () => ({ ParagraphControl: () => null }));
vi.mock('@/app/reader/components/BrightnessOverlay', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ImageViewer', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TableViewer', () => ({ default: () => null }));

afterEach(() => {
  cleanup();
  clearChapterScreens('test-book');
});

const props = {
  bookKey: 'test-book',
  bookDoc: { metadata: {}, transformTarget: new EventTarget() },
  config: {},
  gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  contentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
} as unknown as ComponentProps<typeof FoliateViewer>;

const screenCounts = () => getScreenPageMap('test-book', [{}, { size: 1 }, { size: 1 }]).counts;
const relocateInChapter1 = () =>
  vi.mocked(useFoliateEvents).mock.lastCall?.[1]?.onRelocate?.(
    new CustomEvent('relocate', {
      detail: { location: { current: 0, next: 1, total: 10 }, section: { current: 1, total: 3 } },
    }),
  );

const loaded = (chapter1: number, chapter2: number) => {
  layout.contents = [
    { index: 1, contentPages: chapter1 },
    { index: 2, contentPages: chapter2 },
  ];
};

it('measures the loaded chapters as soon as Stable Page Numbers is turned off', async () => {
  attrs.clear();
  openGate.pending = Promise.resolve();
  viewSettings.stablePageNumbers = true;
  loaded(6, 4);
  const { rerender } = render(<FoliateViewer {...props} />);
  await waitFor(() => expect(attrs.has('margin-top')).toBe(true));
  expect(getMeasuredChapterScreens('test-book')).toBeUndefined();
  const version = getChapterScreensVersion();

  viewSettings.stablePageNumbers = false;
  rerender(<FoliateViewer {...props} />);

  expect(Object.fromEntries(getMeasuredChapterScreens('test-book') ?? [])).toEqual({ 1: 6, 2: 4 });
  // The readouts re-render from the new snapshot.
  expect(getChapterScreensVersion()).toBeGreaterThan(version);
});

it('measures again after another setting drops the measurements', async () => {
  attrs.clear();
  openGate.pending = Promise.resolve();
  viewSettings.stablePageNumbers = false;
  viewSettings.disableDoubleClick = false;
  loaded(6, 4);
  const { rerender } = render(<FoliateViewer {...props} />);
  await waitFor(() => expect(attrs.has('margin-top')).toBe(true));
  rerender(<FoliateViewer {...props} />);
  const version = getChapterScreensVersion();

  // A setting that lays nothing out again brings no relocate: the readouts
  // and the jump targets must still have the loaded chapters' counts.
  viewSettings.disableDoubleClick = true;
  rerender(<FoliateViewer {...props} />);
  expect(Object.fromEntries(getMeasuredChapterScreens('test-book') ?? [])).toEqual({ 1: 6, 2: 4 });
  expect(getChapterScreensVersion()).toBeGreaterThan(version);

  // One that does lays the book out again and relocates in the same chapter:
  // that relocate takes the new counts.
  loaded(9, 5);
  relocateInChapter1();
  await waitFor(() => expect(screenCounts()).toEqual([0, 9, 5]));
  viewSettings.disableDoubleClick = false;
});

it('counts the screens a chapter gained once the reader pages past them', async () => {
  attrs.clear();
  openGate.pending = Promise.resolve();
  viewSettings.stablePageNumbers = false;
  loaded(6, 4);
  layout.page = 1;
  const { rerender } = render(<FoliateViewer {...props} />);
  await waitFor(() => expect(attrs.has('margin-top')).toBe(true));
  rerender(<FoliateViewer {...props} />);
  relocateInChapter1();
  await waitFor(() => expect(screenCounts()).toEqual([0, 6, 4]));

  // Late images lay chapter 1 out on eight screens, and the reader turns to
  // the seventh: the total and the jumps count the two added screens.
  loaded(8, 4);
  layout.page = 6;
  relocateInChapter1();
  await waitFor(() => expect(screenCounts()).toEqual([0, 8, 4]));
  layout.page = 1;
});
