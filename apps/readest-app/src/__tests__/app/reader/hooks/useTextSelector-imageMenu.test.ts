import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// readest/readest issues #6558, #6562, #6563: a desktop right-click on an image
// opens Readest's own image menu (Copy Image / Save Image) instead of the
// webview's, whose items differ per engine and include a useless "Copy image
// address" for the blob URL. EPUB and PDF behave the same: a PDF page is a
// canvas under its text layer, so foliate-js finds its images by position.

const h = vi.hoisted(() => ({
  view: {
    next: vi.fn(),
    prev: vi.fn(),
    deselect: vi.fn(),
    getCFI: vi.fn(() => 'cfi'),
    renderer: { containerPosition: 100, scrollLocked: false },
  },
  appService: { isAndroidApp: false, isMobile: false },
  osPlatform: 'macos',
  viewSettings: { scrolled: false } as { scrolled: boolean; vertical?: boolean },
  dispatch: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewSettings: () => h.viewSettings,
    getProgress: () => null,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({}) }),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    onSync: vi.fn(),
    offSync: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    dispatch: h.dispatch,
  },
}));
vi.mock('@/app/reader/hooks/useInstantAnnotation', () => ({
  useInstantAnnotation: () => ({
    isInstantAnnotationEnabled: () => false,
    handleInstantAnnotationPointerDown: vi.fn(() => true),
    handleInstantAnnotationPointerMove: vi.fn(() => true),
    handleInstantAnnotationPointerCancel: vi.fn(),
    handleInstantAnnotationPointerUp: vi.fn(async () => false),
    reapplyInstantAnnotation: vi.fn(),
    cancelInstantAnnotation: vi.fn(),
  }),
}));
vi.mock('@/utils/misc', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: () => h.osPlatform };
});

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';
import type { TextSelection } from '@/utils/sel';

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

const setup = (setSelection: (s: TextSelection | null) => void) => {
  const noop = vi.fn();
  return renderHook(() =>
    useTextSelector(
      'book-1',
      ZERO_INSETS,
      setSelection as React.Dispatch<React.SetStateAction<TextSelection | null>>,
      noop,
      noop,
      // getAnnotationText: return the range text so we can assert the selected word
      vi.fn(async (range: Range) => range.toString()),
      noop,
    ),
  );
};

const rightClick = (target: Element, x = 50, y = 50) => {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(event);
  return event;
};

type ImageMenu = { bookKey: string; getImage: () => Promise<Blob>; x: number; y: number };
const imageMenus = () =>
  h.dispatch.mock.calls
    .filter(([name]) => name === 'image-context-menu')
    .map(([, detail]) => detail as ImageMenu);

beforeEach(() => {
  vi.clearAllMocks();
  h.appService = { isAndroidApp: false, isMobile: false };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const listen = () => {
  const { result } = setup(vi.fn());
  document.addEventListener('contextmenu', result.current.handleContextmenu);
  return () => document.removeEventListener('contextmenu', result.current.handleContextmenu);
};

describe('useTextSelector image context menu (#6558)', () => {
  test('opens the image menu for an image in a reflowable page', async () => {
    const blob = new Blob(['jpg'], { type: 'image/jpeg' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ blob: async () => blob })),
    );
    const stop = listen();
    document.body.innerHTML = '<p>text <img src="blob:http://localhost/figure"></p>';
    const event = rightClick(document.querySelector('img')!, 30, 40);
    expect(event.defaultPrevented).toBe(true);
    const [menu, ...rest] = imageMenus();
    expect(rest).toEqual([]);
    expect(menu).toMatchObject({ bookKey: 'book-1', x: 30, y: 40 });
    await expect(menu!.getImage()).resolves.toBe(blob);
    expect(fetch).toHaveBeenCalledWith('blob:http://localhost/figure');
    vi.unstubAllGlobals();
    stop();
  });

  test('asks the PDF page for the image under the pointer', () => {
    const stop = listen();
    document.body.innerHTML = '<div id="canvas"></div><div class="textLayer"></div>';
    const getImage = vi.fn();
    const getImageAt = vi.fn((x: number, y: number) => (x > 50 && y > 600 ? getImage : null));
    Object.assign(document, { getImageAt });
    const textLayer = document.querySelector('.textLayer')!;

    expect(rightClick(textLayer, 10, 10).defaultPrevented).toBe(false);
    expect(imageMenus()).toEqual([]);

    expect(rightClick(textLayer, 100, 650).defaultPrevented).toBe(true);
    expect(imageMenus()).toEqual([{ bookKey: 'book-1', getImage, x: 100, y: 650 }]);
    expect(getImageAt).toHaveBeenLastCalledWith(100, 650);
    delete (document as { getImageAt?: unknown }).getImageAt;
    stop();
  });

  test('leaves the native menu to text', () => {
    const stop = listen();
    document.body.innerHTML = '<p>plain text</p>';
    expect(rightClick(document.querySelector('p')!).defaultPrevented).toBe(false);
    expect(imageMenus()).toEqual([]);
    stop();
  });

  test('shows no menu on mobile', () => {
    h.appService = { isAndroidApp: true, isMobile: true };
    const stop = listen();
    document.body.innerHTML = '<img src="blob:http://localhost/figure">';
    expect(rightClick(document.querySelector('img')!).defaultPrevented).toBe(true);
    expect(imageMenus()).toEqual([]);
    stop();
  });
});
