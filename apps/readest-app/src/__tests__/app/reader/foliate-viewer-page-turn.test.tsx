import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import FoliateViewer from '@/app/reader/components/FoliateViewer';
import { clearBookProgress, setBookProgress, useBookProgress } from '@/store/readerProgressStore';
import type { BookProgress } from '@/types/book';

// A page turn writes the book's progress. The hooks that follow it (progress sync and save, KOSync,
// file sync, translation) must, but the viewer and what it holds (paragraph mode, overlays, menus)
// must not re-render with them.

const counts = vi.hoisted(() => ({ followers: 0, xray: 0, paragraph: 0 }));
const readerState = vi.hoisted(() => ({
  setProgress: vi.fn(),
  getViewState: () => ({}),
  getViewSettings: () => ({}),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (s: typeof readerState) => unknown) => select(readerState),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (select: (s: { getBookData: () => null }) => unknown) =>
    select({ getBookData: () => null }),
}));
vi.mock('@/store/parallelViewStore', () => ({ useParallelViewStore: () => () => [] }));
vi.mock('@/store/settingsStore', () => ({ useSettingsStore: () => ({ settings: {} }) }));
vi.mock('@/store/themeStore', () => {
  const state = { isIPhoneDuo: false, duoFold: null, safeAreaInsets: null };
  const useThemeStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  return { useThemeStore: Object.assign(useThemeStore, { getState: () => state }) };
});
vi.mock('@/store/customFontStore', () => ({
  // FoliateViewer's calibration fingerprint reads the loaded-font list at
  // render, so the minimal store mock has to provide it.
  useCustomFontStore: () => ({ getLoadedFonts: () => [] }),
}));
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
vi.mock('@/app/reader/hooks/useKOSync', () => ({
  useKOSync: (key: string) => {
    useBookProgress(key);
    return {};
  },
}));
vi.mock('@/app/reader/hooks/useIframeEvents', () => ({
  useMouseEvent: () => ({}),
  useTouchEvent: () => ({}),
  useOpenMediaEvent: () => {},
}));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({ useCapturedTurn: () => {} }));
vi.mock('@/app/reader/hooks/usePagination', () => ({ usePagination: () => ({}) }));
vi.mock('@/app/reader/hooks/useProgressSync', () => ({
  useProgressSync: (key: string) => {
    counts.followers++;
    useBookProgress(key);
  },
}));
vi.mock('@/app/reader/hooks/useABSProgressSync', () => ({
  useABSProgressSync: (key: string) => {
    counts.followers++;
    useBookProgress(key);
  },
}));
vi.mock('@/app/reader/hooks/useProgressAutoSave', () => ({
  useProgressAutoSave: (key: string) => {
    counts.followers++;
    useBookProgress(key);
  },
}));
vi.mock('@/app/reader/hooks/useXRayAutoUpdate', () => ({
  useXRayAutoUpdate: (key: string) => {
    counts.xray++;
    useBookProgress(key);
  },
}));
vi.mock('@/app/reader/hooks/useAutoSaveBookCover', () => ({ useBookCoverAutoSave: () => {} }));
vi.mock('@/app/reader/hooks/useFileSync', () => ({
  useFileSync: (key: string) => {
    counts.followers++;
    useBookProgress(key);
  },
}));
vi.mock('@/app/reader/hooks/useTextTranslation', () => ({
  useTextTranslation: (key: string) => {
    counts.followers++;
    useBookProgress(key);
  },
}));
vi.mock('@/hooks/useBackgroundTexture', () => ({
  useBackgroundTexture: () => ({ applyBackgroundTexture: vi.fn() }),
}));
vi.mock('@/hooks/useAutoFocus', () => ({ useAutoFocus: () => {} }));
vi.mock('@/hooks/useEinkMode', () => ({ useEinkMode: () => ({}) }));
vi.mock('@/hooks/useUICSS', () => ({ useUICSS: () => {} }));
vi.mock('@/hooks/useDiscordPresence', () => ({ useDiscordPresence: () => {} }));
vi.mock('@/app/reader/hooks/bookOrbitProgressProvider', () => ({ bookOrbitProgressProvider: {} }));
vi.mock('@/app/reader/hooks/grimmoryProgressProvider', () => ({ grimmoryProgressProvider: {} }));
vi.mock('@/app/reader/components/paragraph', () => ({
  ParagraphControl: () => {
    counts.paragraph++;
    return null;
  },
}));
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

const turnTo = (page: number) =>
  act(() =>
    setBookProgress('test-book', {
      location: `epubcfi(/6/4!/4/${page})`,
      pageinfo: { current: page, total: 10 },
    } as BookProgress),
  );

afterEach(() => {
  cleanup();
  clearBookProgress('test-book');
});

describe('FoliateViewer on a page turn', () => {
  it('re-renders only the hooks that follow the reading position', () => {
    render(<FoliateViewer {...props} />);
    turnTo(1);
    const { followers, xray, paragraph } = counts;

    turnTo(2);
    turnTo(3);

    expect(counts.followers).toBeGreaterThan(followers);
    expect(counts.xray).toBeGreaterThan(xray);
    expect(counts.paragraph).toBe(paragraph);
  });
});
