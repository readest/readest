import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// #7820: on a Windows tablet a long press selects a word, but the selection
// can't be extended. The release republishes the selection by re-adding its
// range, and the webview only draws its own touch handles for a selection the
// user made, so they go away. The mobile apps hand that job to the app's own
// handles; a touch selection on desktop Windows and Linux must too.

const h = vi.hoisted(() => ({
  view: {
    next: vi.fn(),
    prev: vi.fn(),
    deselect: vi.fn(),
    getCFI: vi.fn(() => 'cfi'),
    renderer: { containerPosition: 0, scrollLocked: false, getContents: () => [] },
  },
  appService: { isAndroidApp: false, isIOSApp: false, isMobile: false },
  osPlatform: 'windows',
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

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };
const WORD_RECT = { left: 90, right: 130, top: 90, bottom: 110, width: 40, height: 20 };

const setup = () => {
  const setSelection = vi.fn();
  const noop = vi.fn();
  const hook = renderHook(() =>
    useTextSelector(
      'book-1',
      ZERO_INSETS,
      setSelection as never,
      noop,
      noop,
      vi.fn(async (range: Range) => range.toString()),
      noop,
    ),
  );
  return { ...hook, setSelection };
};

const makePage = () => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  doc.body.innerHTML = '<p>a <span>word</span> in a book</p>';
  // jsdom lays nothing out; put the selected word under the release point.
  const { Range } = iframe.contentWindow as Window & typeof globalThis;
  Range.prototype.getClientRects = () => [WORD_RECT] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => WORD_RECT as DOMRect;
  return doc;
};

// What a long press leaves behind: the word under the finger selected.
const selectWord = (doc: Document) => {
  const range = doc.createRange();
  range.selectNodeContents(doc.querySelector('span')!);
  const sel = doc.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
};

const pointer = (pointerType: string) =>
  ({
    pointerType,
    button: 0,
    buttons: 0,
    clientX: 100,
    clientY: 100,
    target: document.createElement('span'),
    preventDefault: vi.fn(),
  }) as unknown as PointerEvent;

const flush = () => new Promise((r) => setTimeout(r, 0));

// Long press and release: pointerdown, the word selected while the finger is
// down, then pointerup and touchend, in Chromium's order.
const longPress = async (result: ReturnType<typeof setup>['result'], doc: Document) => {
  result.current.handleTouchStart();
  result.current.handlePointerDown(doc, 0, pointer('touch'));
  selectWord(doc);
  result.current.handleSelectionchange(doc, 0);
  await result.current.handlePointerUp(doc, 0, pointer('touch'));
  result.current.handleTouchEnd(doc, 0);
  await flush();
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  h.appService = { isAndroidApp: false, isIOSApp: false, isMobile: false };
  h.osPlatform = 'windows';
  h.viewSettings = { scrolled: false };
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('touch selection on desktop shows the app handles (#7820)', () => {
  test.each([
    'windows',
    'linux',
  ])('a long press on %s publishes the word with app handles', async (os) => {
    h.osPlatform = os;
    const doc = makePage();
    const { result, setSelection } = setup();

    await longPress(result, doc);

    expect(setSelection).toHaveBeenCalled();
    expect(setSelection.mock.lastCall?.[0]).toMatchObject({
      text: 'word',
      handlesSuppressed: true,
    });
  });

  test('a touch selection in scroll mode gets them too', async () => {
    h.viewSettings = { scrolled: true };
    const doc = makePage();
    const { result, setSelection } = setup();

    await longPress(result, doc);

    expect(setSelection.mock.lastCall?.[0]).toMatchObject({
      text: 'word',
      handlesSuppressed: true,
    });
  });

  test('a mouse selection on Windows keeps the plain selection', async () => {
    const doc = makePage();
    const { result, setSelection } = setup();

    result.current.handlePointerDown(doc, 0, pointer('mouse'));
    selectWord(doc);
    result.current.handleSelectionchange(doc, 0);
    await result.current.handlePointerUp(doc, 0, pointer('mouse'));
    await flush();

    expect(setSelection.mock.lastCall?.[0]).toMatchObject({ text: 'word' });
    expect(setSelection.mock.lastCall?.[0].handlesSuppressed).toBeFalsy();
  });

  test('iPadOS (a Macintosh user agent) keeps its native handles', async () => {
    h.osPlatform = 'macos';
    const doc = makePage();
    const { result, setSelection } = setup();

    await longPress(result, doc);

    expect(setSelection.mock.lastCall?.[0]).toMatchObject({ text: 'word' });
    expect(setSelection.mock.lastCall?.[0].handlesSuppressed).toBeFalsy();
  });

  test('the iOS app keeps its native handles', async () => {
    h.appService = { isAndroidApp: false, isIOSApp: true, isMobile: true };
    h.osPlatform = 'ios';
    const doc = makePage();
    const { result, setSelection } = setup();

    await longPress(result, doc);

    expect(setSelection.mock.lastCall?.[0]).toMatchObject({ text: 'word' });
    expect(setSelection.mock.lastCall?.[0].handlesSuppressed).toBeFalsy();
  });
});
