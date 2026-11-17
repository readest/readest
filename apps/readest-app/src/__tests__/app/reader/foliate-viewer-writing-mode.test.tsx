import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import FoliateViewer from '@/app/reader/components/FoliateViewer';
import { useFoliateEvents } from '@/app/reader/hooks/useFoliateEvents';

const { readerState, bookDataState, themeState, h } = vi.hoisted(() => {
  const h = {
    settings: { writingMode: 'auto', vertical: false, rtl: false },
    directions: new Map<Document, { vertical: boolean; rtl: boolean }>(),
    contents: [] as { index: number; doc: Document }[],
    primaryIndex: -1,
  };
  return {
    h,
    bookDataState: { bookData: { book: {} } as unknown },
    themeState: { isDarkMode: false },
    readerState: {
      setProgress: vi.fn(),
      getViewState: () => ({}),
      getViewSettings: () => h.settings,
      setView: () => {},
      setViewInited: () => {},
      setViewSettings: (_key: string, settings: typeof h.settings) => {
        h.settings = settings;
      },
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
vi.mock('@/store/themeStore', () => ({
  useThemeStore: Object.assign(() => ({ ...themeState }), { getState: () => themeState }),
}));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ getLoadedFonts: () => [], getAvailableFonts: () => [] }),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({}) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => null }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/libs/document', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getDirection: (doc: Document) => h.directions.get(doc) ?? {},
}));
vi.mock('foliate-js/view.js', () => ({}));
vi.mock('@/types/view', () => ({
  wrappedFoliateView: (view: HTMLElement & { book?: unknown }) => {
    const anyCall: object = new Proxy(() => anyCall, { get: () => anyCall, apply: () => anyCall });
    return Object.assign(view, {
      open: async (book: unknown) => {
        view.book = book;
      },
      init: async () => {},
      goToFraction: async () => {},
      // The paginator's own view of which section is being read.
      renderer: new Proxy(anyCall, {
        get: (_target, prop) =>
          prop === 'getContents'
            ? () => h.contents
            : prop === 'primaryIndex'
              ? h.primaryIndex
              : anyCall,
      }),
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
vi.mock('@/app/reader/hooks/useAutoScroll', () => ({ useAutoScroll: () => ({}) }));
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

// Continuous scrolling keeps the neighbouring sections mounted, and they load
// after the one being read. A horizontal front matter landing last rewrote a
// vertical book's saved writing mode, and everything that reads it (page turns,
// the scrollbar, the footnote popup) then disagreed with the text (#7586).
it('lets only the section being read set the book writing mode', async () => {
  const props = {
    bookKey: 'test-book',
    bookDoc: { metadata: {} },
    config: {},
    gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    contentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as ComponentProps<typeof FoliateViewer>;
  render(<FoliateViewer {...props} />);
  await waitFor(() => expect(vi.mocked(useFoliateEvents).mock.calls.some(([v]) => v)).toBe(true));
  const onLoad = vi.mocked(useFoliateEvents).mock.calls.find(([view]) => view)![1]!.onLoad!;
  // Already wired for input, so the handler skips the iframe listeners.
  const section = (vertical: boolean) => {
    const doc = Object.assign(document.implementation.createHTMLDocument('section'), {
      isEventListenersAdded: true,
    });
    h.directions.set(doc, { vertical, rtl: vertical });
    return doc;
  };
  const frontMatter = section(false);
  const chapter = section(true);
  const load = (doc: Document, index: number) =>
    onLoad(new CustomEvent('load', { detail: { doc, index } }));

  h.contents = [{ index: 1, doc: chapter }];
  h.primaryIndex = 1;
  load(chapter, 1);
  expect(h.settings).toMatchObject({ vertical: true, rtl: true });

  h.contents = [
    { index: 0, doc: frontMatter },
    { index: 1, doc: chapter },
  ];
  load(frontMatter, 0);
  expect(h.settings).toMatchObject({ vertical: true, rtl: true });

  // Reading the front matter itself, it does speak for the book.
  h.primaryIndex = 0;
  load(frontMatter, 0);
  expect(h.settings).toMatchObject({ vertical: false, rtl: false });
});
