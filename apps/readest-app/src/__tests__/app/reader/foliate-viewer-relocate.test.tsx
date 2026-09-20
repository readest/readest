import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import FoliateViewer from '@/app/reader/components/FoliateViewer';
import { useFoliateEvents } from '@/app/reader/hooks/useFoliateEvents';

const { processOcrDocument, setProgress, readerState, view, bookData } = vi.hoisted(() => {
  const processOcrDocument = vi.fn().mockResolvedValue(null);
  const doc = {} as Document;
  const renderer = {
    atEnd: false,
    getContents: vi.fn(() => [{ doc, index: 0 }]),
    removeAttribute: vi.fn(),
    setAttribute: vi.fn(),
    setStyles: vi.fn(),
  };
  const view = Object.assign(document.createElement('foliate-view'), {
    book: {},
    goToFraction: vi.fn().mockResolvedValue(undefined),
    init: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue(undefined),
    renderer,
  });
  const setProgress = vi.fn();
  const readerState = {
    setView: vi.fn(),
    setPreviewMode: vi.fn(),
    setProgress,
    setViewInited: vi.fn(),
    setViewSettings: vi.fn(),
    viewStates: {} as Record<string, { ocrEnabled?: boolean }>,
    getViewState: () => ({}),
    getViewSettings: () => ({ writingMode: '' }),
  };
  const bookData = {
    book: { format: 'CBZ', primaryLanguage: 'ja' },
    isFixedLayout: true,
  };
  return { processOcrDocument, setProgress, readerState, view, bookData };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (s: typeof readerState) => unknown) => select(readerState),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (select: (s: { getBookData: () => typeof bookData }) => unknown) =>
    select({ getBookData: () => bookData }),
}));
vi.mock('@/store/parallelViewStore', () => ({ useParallelViewStore: () => () => [] }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => ({ settings: {} }), { getState: () => ({ settings: {} }) }),
}));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({}) }));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ getLoadedFonts: () => [], getAvailableFonts: () => [] }),
}));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({}) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => null }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/libs/document', () => ({}));
vi.mock('foliate-js/view.js', () => ({}));
vi.mock('@/types/view', () => ({
  wrappedFoliateView: () => view,
}));
vi.mock('@/services/constants', () => ({ BOOK_IDS_SEPARATOR: ',' }));
vi.mock('@/services/transformService', () => ({ transformContent: vi.fn() }));
vi.mock('@/app/reader/hooks/useOcrSession', () => ({
  useOcrSession: () => processOcrDocument,
}));
vi.mock('@/utils/style', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/style')>()),
  applyTranslationStyle: vi.fn(),
  getStyles: vi.fn().mockReturnValue(''),
}));
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
  applyPageTurnAttributes: vi.fn(),
  useCapturedTurn: () => {},
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
vi.mock('@/hooks/useEinkMode', () => ({ useEinkMode: () => ({ applyEinkMode: vi.fn() }) }));
vi.mock('@/hooks/useUICSS', () => ({ useUICSS: () => {} }));
vi.mock('@/hooks/useDiscordPresence', () => ({ useDiscordPresence: () => {} }));
vi.mock('@/app/reader/hooks/bookOrbitProgressProvider', () => ({ bookOrbitProgressProvider: {} }));
vi.mock('@/app/reader/components/paragraph', () => ({ ParagraphControl: () => null }));
vi.mock('@/app/reader/components/BrightnessOverlay', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ImageViewer', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TableViewer', () => ({ default: () => null }));

const props = {
  bookKey: 'test-book',
  bookDoc: { metadata: {} },
  config: {},
  gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  contentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
} as ComponentProps<typeof FoliateViewer>;

const relocate = (detail: object, handlers = vi.mocked(useFoliateEvents).mock.lastCall?.[1]) => {
  act(() => handlers?.onRelocate?.(new CustomEvent('relocate', { detail })));
};

describe('reader relocation progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readerState.viewStates = {};
    view.renderer.getContents.mockReturnValue([{ doc: document, index: 0 }]);
    vi.useFakeTimers();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ignores a late relocation without progress after the view closes', () => {
    render(<FoliateViewer {...props} />);
    relocate({ cfi: 'epubcfi(/6/2)' });
    act(() => vi.advanceTimersByTime(20));
    expect(setProgress).not.toHaveBeenCalled();
  });

  it('preserves the pending valid position when a late relocation has no progress', () => {
    render(<FoliateViewer {...props} />);
    relocate({ cfi: 'epubcfi(/6/2)', location: { current: 3, next: 4, total: 10 } });
    relocate({ cfi: 'epubcfi(/6/4)' });
    act(() => vi.advanceTimersByTime(20));
    expect(setProgress).toHaveBeenCalledOnce();
    expect(setProgress.mock.lastCall?.[1]).toBe('epubcfi(/6/2)');
    expect(setProgress.mock.lastCall?.[5]).toEqual({ current: 3, next: 4, total: 10 });
  });

  it('still coalesces valid relocations to the latest page', () => {
    render(<FoliateViewer {...props} />);
    relocate({ location: { current: 3, next: 4, total: 10 } });
    relocate({ location: { current: 4, next: 5, total: 10 } });
    act(() => vi.advanceTimersByTime(20));
    expect(setProgress).toHaveBeenCalledOnce();
    expect(setProgress.mock.lastCall?.[5]).toEqual({ current: 4, next: 5, total: 10 });
  });

  it('flushes the last valid position on unmount after a late incomplete relocation', () => {
    const { unmount } = render(<FoliateViewer {...props} />);
    relocate({ location: { current: 3, next: 4, total: 10 } });
    relocate({});
    unmount();
    expect(setProgress).toHaveBeenCalledOnce();
    expect(setProgress.mock.lastCall?.[5]).toEqual({ current: 3, next: 4, total: 10 });
    act(() => vi.advanceTimersByTime(20));
    expect(setProgress).toHaveBeenCalledOnce();
  });

  it('ignores incomplete background events while committing valid progress immediately', () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<FoliateViewer {...props} />);
    relocate({});
    expect(setProgress).not.toHaveBeenCalled();
    relocate({ location: { current: 3, next: 4, total: 10 } });
    expect(setProgress).toHaveBeenCalledOnce();
    expect(setProgress.mock.lastCall?.[5]).toEqual({ current: 3, next: 4, total: 10 });
  });

  it('reads the current OCR setting from a handler bound before OCR was enabled', async () => {
    const { rerender } = render(<FoliateViewer {...props} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    const boundHandlers = vi
      .mocked(useFoliateEvents)
      .mock.calls.find(([boundView]) => boundView)?.[1];
    expect(boundHandlers?.onRelocate).toBeDefined();

    readerState.viewStates = { [props.bookKey]: { ocrEnabled: true } };
    rerender(<FoliateViewer {...props} />);
    view.renderer.getContents.mockReturnValue([{ doc: document, index: 8 }]);
    relocate({ location: { current: 1, next: 2, total: 10 } }, boundHandlers);
    act(() => vi.advanceTimersByTime(20));

    expect(processOcrDocument).toHaveBeenCalledExactlyOnceWith(document, 8);
    readerState.viewStates = {};
    rerender(<FoliateViewer {...props} />);
    relocate({ location: { current: 0, next: 1, total: 10 } }, boundHandlers);
    act(() => vi.advanceTimersByTime(20));
    expect(processOcrDocument).toHaveBeenCalledOnce();
  });
});
