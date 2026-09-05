import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import FoliateViewer from '@/app/reader/components/FoliateViewer';
import { useFoliateEvents } from '@/app/reader/hooks/useFoliateEvents';

const { setProgress, readerState } = vi.hoisted(() => {
  const setProgress = vi.fn();
  return {
    setProgress,
    readerState: {
      setProgress,
      getViewState: () => ({}),
      getViewSettings: () => ({}),
    },
  };
});

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (s: typeof readerState) => unknown) => select(readerState),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (select: (s: { getBookData: () => null }) => unknown) =>
    select({ getBookData: () => null }),
}));
vi.mock('@/store/parallelViewStore', () => ({ useParallelViewStore: () => () => [] }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/store/themeStore', () => ({ useThemeStore: () => ({}) }));
vi.mock('@/store/customFontStore', () => ({ useCustomFontStore: () => ({}) }));
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({}) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => null }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (text: string) => text }));
vi.mock('@/libs/document', () => ({}));
vi.mock('foliate-js/view.js', () => ({}));
vi.mock('@/types/view', () => ({
  wrappedFoliateView: (view: HTMLElement) =>
    Object.assign(view, { open: () => new Promise(() => {}) }),
}));
vi.mock('@/services/constants', () => ({ BOOK_IDS_SEPARATOR: ',' }));
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
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({ useCapturedTurn: () => {} }));
vi.mock('@/app/reader/hooks/usePagination', () => ({ usePagination: () => ({}) }));
vi.mock('@/app/reader/hooks/useProgressSync', () => ({ useProgressSync: () => {} }));
vi.mock('@/app/reader/hooks/useProgressAutoSave', () => ({ useProgressAutoSave: () => {} }));
vi.mock('@/app/reader/hooks/useAutoSaveBookCover', () => ({ useBookCoverAutoSave: () => {} }));
vi.mock('@/app/reader/hooks/useFileSync', () => ({ useFileSync: () => {} }));
vi.mock('@/app/reader/hooks/useTextTranslation', () => ({ useTextTranslation: () => {} }));
vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: vi.fn() }),
}));
vi.mock('@/hooks/useAutoFocus', () => ({ useAutoFocus: () => {} }));
vi.mock('@/hooks/useEinkMode', () => ({ useEinkMode: () => ({}) }));
vi.mock('@/hooks/useUICSS', () => ({ useUICSS: () => {} }));
vi.mock('@/hooks/useDiscordPresence', () => ({ useDiscordPresence: () => {} }));
vi.mock('@/app/reader/hooks/bookOrbitProgressProvider', () => ({ bookOrbitProgressProvider: {} }));
vi.mock('@/app/reader/components/paragraph', () => ({ ParagraphControl: () => null }));
vi.mock('@/app/reader/components/BrightnessOverlay', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ImageViewer', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TableViewer', () => ({ default: () => null }));

const props = {
  bookKey: 'test-book',
  bookDoc: {},
  config: {},
  gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  contentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
} as ComponentProps<typeof FoliateViewer>;

const relocate = (detail: object) => {
  const handlers = vi.mocked(useFoliateEvents).mock.lastCall?.[1];
  act(() => handlers?.onRelocate?.(new CustomEvent('relocate', { detail })));
};

describe('reader relocation progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
