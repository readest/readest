// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  view: {
    next: vi.fn(),
    prev: vi.fn(),
    goLeft: vi.fn(),
    goRight: vi.fn(),
    deselect: vi.fn(),
    getCFI: vi.fn(() => 'cfi'),
    renderer: { containerPosition: 0 },
  },
  appService: { isAndroidApp: true, isIOSApp: false, isMobile: true },
  osPlatform: 'android',
  viewSettings: { scrolled: false } as { scrolled: boolean },
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
  ...bookDataStoreHooks(() => ({ getBookData: () => ({}) })),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { onSync: vi.fn(), offSync: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/app/reader/hooks/useInstantAnnotation', () => ({
  useInstantAnnotation: () => ({
    isInstantAnnotationEnabled: () => false,
    handleInstantAnnotationPointerDown: vi.fn(),
    handleInstantAnnotationPointerMove: vi.fn(),
    handleInstantAnnotationPointerCancel: vi.fn(),
    handleInstantAnnotationPointerUp: vi.fn(),
    reapplyInstantAnnotation: vi.fn(),
    cancelInstantAnnotation: vi.fn(),
  }),
}));
vi.mock('@/utils/misc', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: () => h.osPlatform };
});

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';

const setup = () => {
  const noop = vi.fn();
  return renderHook(() =>
    useTextSelector(
      'book-1',
      { top: 0, right: 0, bottom: 0, left: 0 },
      noop,
      noop,
      noop,
      vi.fn(async () => ''),
      noop,
    ),
  );
};

let currentSel: Selection | null = null;
const doc = {
  documentElement: document.createElement('html'),
  getSelection: () => currentSel,
  createRange: () => ({
    setStart: () => {},
    collapse: () => {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
  }),
  defaultView: { frameElement: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
} as unknown as Document;

const select = () => {
  const node = document.createTextNode('selected text');
  currentSel = {
    focusNode: node,
    focusOffset: 0,
    isCollapsed: false,
    rangeCount: 1,
    toString: () => 'selected text',
    getRangeAt: () => document.createRange(),
  } as unknown as Selection;
};

// The paginator's relocate event, which the hook receives from the renderer.
const relocate = (reason: string) => new CustomEvent('relocate', { detail: { reason } });

beforeEach(() => {
  vi.clearAllMocks();
  currentSel = null;
  h.view.renderer.containerPosition = 1200;
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

// Android scrolls the paginated container under a held selection; the hook
// pins it to where the selection was made (#873).
describe('useTextSelector Android selection scroll pin', () => {
  test('pins the container back when the browser scrolls it', () => {
    const { result } = setup();
    select();
    result.current.handleSelectionchange(doc, 0);

    h.view.renderer.containerPosition = 1500;
    result.current.handleScroll();

    expect(h.view.renderer.containerPosition).toBe(1200);
  });

  // Pinning the Notebook beside the page narrows the reader; the paginator
  // lays the pages out again and re-anchors, sometimes in several steps, each
  // relocating with reason 'anchor' (#7789).
  test('follows the paginator when it re-anchors after a resize', () => {
    const { result } = setup();
    select();
    result.current.handleSelectionchange(doc, 0);

    for (const position of [1820, 910]) {
      h.view.renderer.containerPosition = position;
      result.current.handleRendererRelocate(relocate('anchor'));
      result.current.handleScroll();
      expect(h.view.renderer.containerPosition).toBe(position);
    }

    // Still pinned there against the browser's own scrolls, which relocate
    // as a container scroll.
    h.view.renderer.containerPosition = 1350;
    result.current.handleScroll();
    result.current.handleRendererRelocate(relocate('container-scroll'));
    expect(h.view.renderer.containerPosition).toBe(910);
  });
});
