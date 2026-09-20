import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// A long press near or on a link never selected text in the Android app
// (#6242): Chromium's touch adjustment retargets the press onto the link, and a
// link long press opens no selection. While a touch is held the section
// document carries a class that takes links out of hit testing, so the native
// long press selects the word under the finger. It is lifted on release, before
// the tap gesture resolves its target, so a tap still follows the link.

const h = vi.hoisted(() => ({
  view: {
    renderer: { containerPosition: 0, scrollLocked: false, getContents: () => [] },
  },
  appService: { isAndroidApp: true, isMobile: true },
  osPlatform: 'android',
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewSettings: () => ({ scrolled: false }),
    getProgress: () => null,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ isFixedLayout: false }) }),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { onSync: vi.fn(), offSync: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/utils/bridge', () => ({
  setSelectionSuppressed: vi.fn(async () => {}),
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
import { LINK_TOUCH_HOLD_CLASS } from '@/utils/style';

const setup = () => {
  const noop = vi.fn();
  return renderHook(() =>
    useTextSelector(
      'book-1',
      { top: 0, right: 0, bottom: 0, left: 0 },
      noop,
      noop,
      noop,
      vi.fn(async (range: Range) => range.toString()),
      noop,
    ),
  );
};

const makeDoc = () => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<p>a close friend of <a href="#n14">[14]</a></p>';
  return doc;
};

const pointer = (type: string, pointerType: string) =>
  ({
    type,
    pointerType,
    button: 0,
    clientX: 10,
    clientY: 10,
    target: null,
  }) as unknown as PointerEvent;

const isHeld = (doc: Document) => doc.documentElement.classList.contains(LINK_TOUCH_HOLD_CLASS);

beforeEach(() => {
  document.body.innerHTML = '';
  h.appService = { isAndroidApp: true, isMobile: true };
  h.osPlatform = 'android';
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('link touch hold', () => {
  test('a touch press holds links out of hit testing until release', async () => {
    const { result } = setup();
    const doc = makeDoc();
    result.current.handlePointerDown(doc, 0, pointer('pointerdown', 'touch'));
    expect(isHeld(doc)).toBe(true);
    await result.current.handlePointerUp(doc, 0, pointer('pointerup', 'touch'));
    expect(isHeld(doc)).toBe(false);
  });

  test('the long press pointercancel releases the hold', () => {
    const { result } = setup();
    const doc = makeDoc();
    result.current.handlePointerDown(doc, 0, pointer('pointerdown', 'touch'));
    result.current.handlePointerCancel(doc, 0, pointer('pointercancel', 'touch'));
    expect(isHeld(doc)).toBe(false);
  });

  test('a mouse press leaves links clickable', () => {
    const { result } = setup();
    const doc = makeDoc();
    result.current.handlePointerDown(doc, 0, pointer('pointerdown', 'mouse'));
    expect(isHeld(doc)).toBe(false);
  });

  test('only the Android app holds links', () => {
    h.appService = { isAndroidApp: false, isMobile: true };
    h.osPlatform = 'ios';
    const { result } = setup();
    const doc = makeDoc();
    result.current.handlePointerDown(doc, 0, pointer('pointerdown', 'touch'));
    expect(isHeld(doc)).toBe(false);
  });
});
