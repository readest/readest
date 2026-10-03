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
  appService: { isAndroidApp: false, isMobile: false } as Record<string, boolean>,
  osPlatform: 'macos',
  textAtPoint: false,
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

vi.mock('@/app/reader/utils/crossDocSelection', async (importActual) => {
  const actual = await importActual<typeof import('@/app/reader/utils/crossDocSelection')>();
  return { ...actual, isTextAtPoint: () => h.textAtPoint };
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
  h.textAtPoint = false;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const listeners: EventListener[] = [];
const listen = () => {
  const { result } = setup(vi.fn());
  listeners.push(result.current.handleContextmenu);
  document.addEventListener('contextmenu', result.current.handleContextmenu);
};

afterEach(() => {
  for (const listener of listeners.splice(0)) {
    document.removeEventListener('contextmenu', listener);
  }
});

describe('useTextSelector image context menu (#6558)', () => {
  test('opens the image menu for an image in a reflowable page', async () => {
    const blob = new Blob(['jpg'], { type: 'image/jpeg' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ blob: async () => blob })),
    );
    listen();
    document.body.innerHTML = '<p>text <img src="blob:http://localhost/figure"></p>';
    const event = rightClick(document.querySelector('img')!, 30, 40);
    expect(event.defaultPrevented).toBe(true);
    const [menu, ...rest] = imageMenus();
    expect(rest).toEqual([]);
    expect(menu).toMatchObject({ bookKey: 'book-1', x: 30, y: 40 });
    await expect(menu!.getImage()).resolves.toBe(blob);
    expect(fetch).toHaveBeenCalledWith('blob:http://localhost/figure');
    vi.unstubAllGlobals();
  });

  const svgPage = (inner: string) => {
    document.body.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`;
    return document.querySelectorAll('image');
  };
  const loadedFrom = async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ blob: async () => new Blob() })),
    );
    await imageMenus().at(-1)!.getImage();
    const url = vi.mocked(fetch).mock.calls[0]![0];
    vi.unstubAllGlobals();
    return url;
  };

  test('takes the SVG <image> under the pointer, not the first one', async () => {
    listen();
    const [, second] = svgPage(
      '<image xlink:href="blob:http://localhost/first"/><image xlink:href="blob:http://localhost/second"/>',
    );
    expect(rightClick(second!).defaultPrevented).toBe(true);
    expect(await loadedFrom()).toBe('blob:http://localhost/second');
  });

  test('resolves a relative SVG <image> href against its document', async () => {
    listen();
    const [image] = svgPage('<image href="images/figure.png"/>');
    rightClick(image!);
    expect(await loadedFrom()).toBe(new URL('images/figure.png', document.baseURI).href);
  });

  test('asks the PDF page for the image under the pointer', () => {
    listen();
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
  });

  test('leaves the native menu to text', () => {
    listen();
    document.body.innerHTML = '<p>plain text</p>';
    expect(rightClick(document.querySelector('p')!).defaultPrevented).toBe(false);
    expect(imageMenus()).toEqual([]);
  });
});

// readest/readest#6574: on iOS and Android a long press on an image opens the
// same menu. Android's WebView reports the long press as a contextmenu event,
// iOS WebKit fires none, so a touch held still on an image opens it there.
describe('useTextSelector image long-press menu (#6574)', () => {
  test('opens the image menu from an Android long press', () => {
    h.appService = { isAndroidApp: true, isMobile: true };
    listen();
    document.body.innerHTML = '<img src="blob:http://localhost/figure">';
    expect(rightClick(document.querySelector('img')!, 30, 40).defaultPrevented).toBe(true);
    expect(imageMenus()).toMatchObject([{ bookKey: 'book-1', x: 30, y: 40 }]);
  });

  test('keeps a long press on text for selection', () => {
    h.appService = { isAndroidApp: true, isMobile: true };
    listen();
    document.body.innerHTML = '<p>plain text</p>';
    expect(rightClick(document.querySelector('p')!).defaultPrevented).toBe(true);
    expect(imageMenus()).toEqual([]);
  });

  test('keeps a long press on PDF text for selection, even over an image', () => {
    h.appService = { isAndroidApp: true, isMobile: true };
    listen();
    document.body.innerHTML = '<div class="textLayer"><span>scanned words</span></div>';
    Object.assign(document, { getImageAt: () => vi.fn() });
    const textLayer = document.querySelector('.textLayer')!;
    h.textAtPoint = true;
    rightClick(document.querySelector('span')!);
    expect(imageMenus()).toEqual([]);
    h.textAtPoint = false;
    rightClick(textLayer);
    expect(imageMenus()).toHaveLength(1);
    delete (document as { getImageAt?: unknown }).getImageAt;
  });

  describe('iOS', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      h.appService = { isIOSApp: true, isMobile: true };
      document.body.innerHTML = '<p>text</p><img src="blob:http://localhost/figure">';
    });
    afterEach(() => vi.useRealTimers());

    const touch = (type: string, target: Element, x = 30, y = 40) =>
      ({
        type,
        target,
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        button: 0,
      }) as unknown as PointerEvent;
    const press = (target: Element) => {
      const { result } = setup(vi.fn());
      result.current.handlePointerDown(document, 0, touch('pointerdown', target));
      return result.current;
    };

    test('opens the image menu once a touch has held still on an image', () => {
      press(document.querySelector('img')!);
      vi.advanceTimersByTime(499);
      expect(imageMenus()).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(imageMenus()).toMatchObject([{ bookKey: 'book-1', x: 30, y: 40 }]);
    });

    test('a tap, a scroll or a swipe opens no menu', () => {
      const img = document.querySelector('img')!;
      press(img).handlePointerUp(document, 0, touch('pointerup', img));
      press(img).handlePointerCancel(document, 0, touch('pointercancel', img));
      press(img).handlePointerMove(document, 0, touch('pointermove', img, 30, 52));
      vi.advanceTimersByTime(1000);
      expect(imageMenus()).toEqual([]);
    });

    test('a reader closed mid-hold opens no menu', () => {
      const { result, unmount } = setup(vi.fn());
      const img = document.querySelector('img')!;
      result.current.handlePointerDown(document, 0, touch('pointerdown', img));
      unmount();
      vi.advanceTimersByTime(1000);
      expect(imageMenus()).toEqual([]);
    });

    test('a hold on text opens no menu', () => {
      press(document.querySelector('p')!);
      vi.advanceTimersByTime(1000);
      expect(imageMenus()).toEqual([]);
    });
  });
});
