import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import FoliateViewer from '@/app/reader/components/FoliateViewer';
import { useFoliateEvents } from '@/app/reader/hooks/useFoliateEvents';

const {
  readerState,
  bookDataState,
  themeState,
  directionState,
  rendererAttrs,
  setViewSettingsMock,
} = vi.hoisted(() => {
  const initialSettings = {
    writingMode: 'auto',
    vertical: false,
    rtl: false,
    maxInlineSize: 720,
    maxColumnCount: 2,
    defaultFontSize: 16,
    defaultLineHeight: 1.6,
  };
  const setViewSettingsMock = vi.fn((_key: string, next: typeof initialSettings) => {
    readerState.viewStates['test-book'].viewSettings = next;
  });
  const readerState = {
    viewStates: {
      'test-book': {
        viewSettings: initialSettings,
      },
    },
    setProgress: vi.fn(),
    getViewState: () => ({}),
    getViewSettings: (key: string) =>
      key === 'test-book' ? readerState.viewStates['test-book'].viewSettings : null,
    setView: () => {},
    setViewInited: () => {},
    setViewSettings: setViewSettingsMock,
  };
  const rendererAttrs = new Map<string, string>();
  return {
    readerState,
    setViewSettingsMock,
    bookDataState: { bookData: { book: {} } as unknown },
    themeState: { isDarkMode: false, isIPhoneDuo: false, duoFold: null, safeAreaInsets: null },
    directionState: { vertical: true, rtl: true },
    rendererAttrs,
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
  getDirection: () => ({ ...directionState }),
}));
vi.mock('foliate-js/view.js', () => ({}));
vi.mock('@/types/view', () => ({
  wrappedFoliateView: (view: HTMLElement & { book?: unknown }) => {
    const anyCall: object = new Proxy(() => anyCall, {
      get: (_target, prop) => {
        if (prop === 'setStyles') return () => {};
        if (prop === 'setAttribute') {
          return (name: string, value: string) => rendererAttrs.set(name, value);
        }
        if (prop === 'getAttribute') {
          return (name: string) => rendererAttrs.get(name) ?? null;
        }
        return anyCall;
      },
      apply: () => anyCall,
    });
    return Object.assign(view, {
      open: async (book: unknown) => {
        view.book = book;
      },
      init: async () => {},
      goToFraction: async () => {},
      renderer: anyCall,
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

describe('FoliateViewer mixed-direction load handling (#7374)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rendererAttrs.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 393 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 852 });
    readerState.viewStates['test-book'].viewSettings = {
      writingMode: 'auto',
      vertical: false,
      rtl: false,
      maxInlineSize: 720,
      maxColumnCount: 2,
      defaultFontSize: 16,
      defaultLineHeight: 1.6,
    };
  });

  it('synchronously updates max-inline-size on vertical section load without mutating store object and ignores preloads', async () => {
    const props = {
      bookKey: 'test-book',
      bookDoc: { metadata: {} },
      config: {},
      gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      contentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    } as unknown as ComponentProps<typeof FoliateViewer>;

    render(<FoliateViewer {...props} />);
    await waitFor(() => expect(vi.mocked(useFoliateEvents).mock.calls.some(([v]) => v)).toBe(true));
    const boundOnLoad = vi.mocked(useFoliateEvents).mock.calls.find(([view]) => view)![1]!.onLoad!;

    const initialSettings = readerState.viewStates['test-book'].viewSettings;

    directionState.vertical = true;
    directionState.rtl = true;
    const verticalDoc = Object.assign(document.implementation.createHTMLDocument('vertical'), {
      isEventListenersAdded: true,
    });
    boundOnLoad(new CustomEvent('load', { detail: { doc: verticalDoc, index: 1 } }));

    expect(initialSettings.vertical).toBe(false);
    expect(setViewSettingsMock).toHaveBeenCalledTimes(1);
    expect(setViewSettingsMock).toHaveBeenCalledWith(
      'test-book',
      expect.objectContaining({ vertical: true, rtl: true }),
    );
    expect(rendererAttrs.get('max-inline-size')).toBe('852px');

    setViewSettingsMock.mockClear();
    directionState.vertical = false;
    directionState.rtl = false;
    const preloadHorizontalDoc = Object.assign(
      document.implementation.createHTMLDocument('preload-colophon'),
      { isEventListenersAdded: true },
    );
    boundOnLoad(
      new CustomEvent('load', {
        detail: { doc: preloadHorizontalDoc, index: 2, isPreload: true },
      }),
    );

    expect(setViewSettingsMock).not.toHaveBeenCalled();
    expect(rendererAttrs.get('max-inline-size')).toBe('852px');
  });
});
