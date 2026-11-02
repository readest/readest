import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import FoliateViewer from '@/app/reader/components/FoliateViewer';
import type ImageViewer from '@/app/reader/components/ImageViewer';

type ImageViewerProps = ComponentProps<typeof ImageViewer>;

const { readerState, bookDataState, gallery } = vi.hoisted(() => {
  return {
    bookDataState: { bookData: null as unknown },
    gallery: {
      opened: false,
      contents: [] as { doc: Document; index: number }[],
      jump: Promise.resolve() as Promise<void>,
      pressImage: null as ((src: string) => Promise<void>) | null,
      viewer: null as ImageViewerProps | null,
    },
    readerState: {
      setProgress: vi.fn(),
      getViewState: () => ({}),
      getViewSettings: () => ({ writingMode: 'auto' }),
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
vi.mock('@/libs/document', () => ({
  convertBlobUrlToDataUrl: async (src: string) => `data:${src}`,
}));
vi.mock('foliate-js/view.js', () => ({}));
vi.mock('@/types/view', () => ({
  wrappedFoliateView: (view: HTMLElement & { book?: unknown }) => {
    const anyCall: object = new Proxy(() => anyCall, { get: () => anyCall, apply: () => anyCall });
    const renderer = new Proxy(
      {},
      { get: (_, key) => (key === 'getContents' ? () => gallery.contents : anyCall) },
    );
    return Object.assign(view, {
      open: async (book: unknown) => {
        view.book = book;
        gallery.opened = true;
      },
      init: async () => {},
      goToFraction: async () => {},
      goTo: () => gallery.jump,
      getCFI: (_index: number, range: Range) =>
        (range.startContainer as HTMLImageElement).getAttribute('src'),
      renderer,
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
  useOpenMediaEvent: (_bookKey: string, onImage: (src: string) => Promise<void>) => {
    gallery.pressImage = onImage;
  },
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
vi.mock('@/app/reader/components/paragraph', () => ({ ParagraphControl: () => null }));
vi.mock('@/app/reader/components/BrightnessOverlay', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ImageViewer', () => ({
  default: (props: ImageViewerProps) => {
    gallery.viewer = props;
    return null;
  },
}));
vi.mock('@/app/reader/components/TableViewer', () => ({ default: () => null }));

// Unmount each test's viewer and drop its images: a late render from a viewer
// left mounted would overwrite the next test's gallery.viewer props.
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  gallery.opened = false;
  gallery.pressImage = null;
  gallery.viewer = null;
});

// Paging the viewer to the next image jumps the book there, which can take a
// while when the image is in another section. The new picture must not borrow
// the previous one's filter or plate in the meantime.
it('does not paint the next image with the previous image style while the book jumps', async () => {
  const section = document.createElement('div');
  section.innerHTML =
    '<img src="blob:flourish" style="filter: invert(100%)"><img src="blob:ornament">';
  document.body.appendChild(section);
  gallery.contents = [{ doc: document, index: 0 }];
  const props = {
    bookKey: 'test-book',
    bookDoc: { metadata: {} },
    config: {},
    gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    contentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as ComponentProps<typeof FoliateViewer>;
  render(<FoliateViewer {...props} />);
  await waitFor(() => expect(gallery.opened).toBe(true));
  await act(async () => {});

  await act(() => gallery.pressImage!('blob:flourish'));
  expect(gallery.viewer?.renderStyle?.filter).toBe('invert(100%)');

  let land = () => {};
  gallery.jump = new Promise<void>((resolve) => {
    land = resolve;
  });
  let next: Promise<void> | undefined;
  await act(async () => {
    next = gallery.viewer!.onNext!() as unknown as Promise<void>;
  });
  expect(gallery.viewer?.src).toBe('data:blob:ornament');
  expect(gallery.viewer?.renderStyle?.filter).not.toBe('invert(100%)');

  await act(async () => {
    land();
    await next;
  });
  expect(gallery.viewer?.renderStyle).toEqual({ filter: 'none', plate: null });
});

// A jump that lands after the viewer moved on (closed, then opened on another
// image) must not paint the image now on screen with the one it jumped to.
it('ignores a jump that lands after the viewer moved to another image', async () => {
  const section = document.createElement('div');
  section.innerHTML =
    '<img src="blob:flourish" style="filter: invert(100%)"><img src="blob:ornament">' +
    '<img src="blob:star" style="filter: grayscale(100%)">';
  document.body.appendChild(section);
  gallery.contents = [{ doc: document, index: 0 }];
  gallery.jump = Promise.resolve();
  const props = {
    bookKey: 'test-book',
    bookDoc: { metadata: {} },
    config: {},
    gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
    contentInsets: { top: 0, right: 0, bottom: 0, left: 0 },
  } as unknown as ComponentProps<typeof FoliateViewer>;
  render(<FoliateViewer {...props} />);
  await waitFor(() => expect(gallery.pressImage).not.toBeNull());
  await act(async () => {});

  await act(() => gallery.pressImage!('blob:flourish'));
  let land = () => {};
  gallery.jump = new Promise<void>((resolve) => {
    land = resolve;
  });
  let next: Promise<void> | undefined;
  await act(async () => {
    next = gallery.viewer!.onNext!() as unknown as Promise<void>;
  });
  await act(async () => {
    gallery.viewer!.onClose();
  });
  await act(() => gallery.pressImage!('blob:star'));
  expect(gallery.viewer?.renderStyle?.filter).toBe('grayscale(100%)');

  await act(async () => {
    land();
    await next;
  });
  expect(gallery.viewer?.src).toBe('data:blob:star');
  expect(gallery.viewer?.renderStyle?.filter).toBe('grayscale(100%)');
});
