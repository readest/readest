import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// iOS streams selectionchange while a finger drags the system selection
// handles, and the Annotator hides the annotation popup on every touchmove
// ("popup should not follow the selection while dragging"). Processing each
// selectionchange re-showed the popup between the hides, so the toolbar
// flashed for the whole drag. Touch selectionchange in paginated mode must
// defer to the end of the gesture and be processed once.

const h = vi.hoisted(() => ({
  view: {
    next: vi.fn(),
    prev: vi.fn(),
    deselect: vi.fn(),
    getCFI: vi.fn(() => 'cfi'),
    renderer: { containerPosition: 100, scrollLocked: false },
  },
  appService: { isAndroidApp: false, isMobile: true },
  osPlatform: 'ios',
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
  useBookDataStore: () => ({ getBookData: () => ({}) }),
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

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

const setup = () => {
  const setSelection = vi.fn();
  const noop = vi.fn();
  const dismiss = vi.fn();
  const hook = renderHook(() =>
    useTextSelector(
      'book-1',
      ZERO_INSETS,
      setSelection as never,
      noop,
      noop,
      vi.fn(async () => 'text'),
      dismiss,
    ),
  );
  return { ...hook, setSelection, dismiss };
};

let currentSel: Selection | null = null;
const doc = {
  getSelection: () => currentSel,
  createRange: () => ({
    setStart: () => {},
    collapse: () => {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
  }),
  defaultView: { frameElement: { getBoundingClientRect: () => ({ left: 0, top: 0 }) } },
} as unknown as Document;

const setDocSelection = (valid: boolean) => {
  const node = document.createTextNode('selected text');
  currentSel = {
    focusNode: node,
    focusOffset: 0,
    isCollapsed: !valid,
    rangeCount: valid ? 1 : 0,
    toString: () => (valid ? 'selected text' : ''),
    getRangeAt: () => ({}) as Range,
  } as unknown as Selection;
};

const touchDown = (result: ReturnType<typeof setup>['result']) => {
  result.current.handleTouchStart();
  result.current.handlePointerDown(doc, 0, {
    pointerType: 'touch',
    button: 0,
    clientX: 100,
    clientY: 100,
    target: document.createElement('span'),
    preventDefault: vi.fn(),
  } as unknown as PointerEvent);
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  h.appService = { isAndroidApp: false, isMobile: true };
  h.osPlatform = 'ios';
  h.viewSettings = { scrolled: false };
  currentSel = null;
});

afterEach(() => {
  cleanup();
});

describe('touch selectionchange defers to the gesture end (toolbar flash)', () => {
  test('selectionchange during an active touch drag does not update the selection', async () => {
    const { result, setSelection } = setup();

    touchDown(result);
    setDocSelection(true);
    result.current.handleSelectionchange(doc, 0);
    await flush();

    expect(setSelection).not.toHaveBeenCalled();
  });

  test('the deferred selection is processed once when the touch ends', async () => {
    const { result, setSelection } = setup();

    touchDown(result);
    setDocSelection(true);
    result.current.handleSelectionchange(doc, 0);
    result.current.handleSelectionchange(doc, 0);
    await flush();
    expect(setSelection).not.toHaveBeenCalled();

    result.current.handleTouchEnd(doc, 0);
    await flush();

    expect(setSelection).toHaveBeenCalledTimes(1);
    expect(setSelection.mock.lastCall?.[0]).toMatchObject({ text: 'text', index: 0 });
  });

  test('a touch end without a pending selectionchange stays quiet', async () => {
    const { result, setSelection } = setup();

    touchDown(result);
    result.current.handleTouchEnd(doc, 0);
    await flush();

    expect(setSelection).not.toHaveBeenCalled();
  });

  test('scroll mode keeps the immediate path (its gesture may end in pointercancel)', async () => {
    h.viewSettings = { scrolled: true };
    const { result, setSelection } = setup();

    touchDown(result);
    setDocSelection(true);
    result.current.handleSelectionchange(doc, 0);
    await flush();

    expect(setSelection).toHaveBeenCalled();
  });

  test('Android keeps the immediate path (selectionchange is its primary signal)', async () => {
    h.appService = { isAndroidApp: true, isMobile: true };
    h.osPlatform = 'android';
    const { result, setSelection } = setup();

    touchDown(result);
    setDocSelection(true);
    result.current.handleSelectionchange(doc, 0);
    await flush();

    expect(setSelection).toHaveBeenCalled();
  });
});
