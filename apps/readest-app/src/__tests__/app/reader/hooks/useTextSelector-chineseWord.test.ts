import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// #8018: Android's WebView has no Chinese word dictionary, so a long-press on
// 思 in 独立思考 selects 思 alone, where iOS selects 思考. The selector widens
// the long-press (and a double-tap) to the word. The press's own selection
// takes the word at the release, and since the WebView drops its handles for a
// selection set from script, the app's own handles take over.

const h = vi.hoisted(() => ({
  view: {
    next: vi.fn(),
    prev: vi.fn(),
    deselect: vi.fn(),
    getCFI: vi.fn(() => 'cfi'),
    renderer: { containerPosition: 0, scrollLocked: false, getContents: () => [] },
  },
  appService: { isAndroidApp: true, isMobile: true },
  osPlatform: 'android',
  lang: 'zh',
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
  ...bookDataStoreHooks(() => ({
    getBookData: () => ({ book: { format: 'EPUB', primaryLanguage: h.lang } }),
  })),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { onSync: vi.fn(), offSync: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/utils/bridge', () => ({
  setSelectionSuppressed: vi.fn(async () => {}),
}));
vi.mock('@/utils/jieba', async (importActual) => ({
  ...(await importActual<typeof import('@/utils/jieba')>()),
  initJieba: vi.fn(async () => {}),
  isJiebaReady: () => true,
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
import type { TextSelection } from '@/utils/sel';

// Intl.Segmenter as Android has it: one segment per Han character.
class AndroidSegmenter {
  segment(text: string) {
    return [...text].map((segment, index) => ({
      segment,
      index,
      isWordLike: /\p{Script=Han}/u.test(segment),
    }));
  }
}

const TEXT = '独立思考是一种重要的能力。';
const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

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
      async (range: Range) => range.toString(),
      noop,
    ),
  );
  return { ...hook, setSelection };
};

const makePage = () => {
  const p = document.createElement('p');
  p.textContent = TEXT;
  document.body.appendChild(p);
  return { doc: document, node: p.firstChild as Text };
};

// What the WebView's long-press leaves: the one character under the finger.
const selectChar = (node: Text, char: string) => {
  const start = TEXT.indexOf(char);
  document.getSelection()!.setBaseAndExtent(node, start, node, start + char.length);
};

const touchDown = (result: ReturnType<typeof setup>['result'], doc: Document) => {
  result.current.handleTouchStart();
  result.current.handlePointerDown(doc, 0, {
    pointerType: 'touch',
    button: 0,
    clientX: 50,
    clientY: 50,
    target: doc.body,
    preventDefault: vi.fn(),
  } as unknown as PointerEvent);
};

// The WebView takes a long-press over once it selects: the page gets a
// pointercancel, and the release arrives only through the native-touch bridge
// (Annotator's handleNativeTouch).
const takeOver = (result: ReturnType<typeof setup>['result'], doc: Document) =>
  result.current.handlePointerCancel(doc, 0, { pointerType: 'touch' } as PointerEvent);
const release = async (result: ReturnType<typeof setup>['result'], doc: Document) => {
  result.current.handleTouchEnd();
  await result.current.handlePointerUp(doc, 0);
};

const flush = () => new Promise((r) => setTimeout(r, 20));

const lastSelection = (setSelection: ReturnType<typeof vi.fn>) =>
  setSelection.mock.calls.at(-1)?.[0] as TextSelection;

beforeEach(() => {
  vi.clearAllMocks();
  h.appService = { isAndroidApp: true, isMobile: true };
  h.osPlatform = 'android';
  h.lang = 'zh';
  vi.stubGlobal('Intl', { ...Intl, Segmenter: AndroidSegmenter });
  document.getSelection()?.removeAllRanges();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
  document.body.innerHTML = '';
});

describe('Chinese word selection on Android (#8018)', () => {
  test('a long-press publishes the word and leaves the press its selection', async () => {
    const { result, setSelection } = setup();
    const { doc, node } = makePage();

    touchDown(result, doc);
    selectChar(node, '思');
    result.current.handleSelectionchange(doc, 0);
    takeOver(result, doc);
    result.current.handleSelectionchange(doc, 0);
    await flush();

    expect(lastSelection(setSelection)).toMatchObject({ text: '思考', handlesSuppressed: false });
    // Set from script while the finger is down, the selection would stop the
    // press from dragging it on.
    expect(document.getSelection()!.toString()).toBe('思');
  });

  test('the release selects the word, on the app handles', async () => {
    const { result, setSelection } = setup();
    const { doc, node } = makePage();

    touchDown(result, doc);
    selectChar(node, '思');
    result.current.handleSelectionchange(doc, 0);
    takeOver(result, doc);
    await flush();
    await release(result, doc);
    await flush();

    expect(document.getSelection()!.toString()).toBe('思考');
    expect(lastSelection(setSelection)).toMatchObject({ text: '思考', handlesSuppressed: true });
  });

  test('a long-press in a book of another language keeps the character', async () => {
    h.lang = 'en';
    const { result, setSelection } = setup();
    const { doc, node } = makePage();

    touchDown(result, doc);
    selectChar(node, '思');
    result.current.handleSelectionchange(doc, 0);
    await flush();

    expect(document.getSelection()!.toString()).toBe('思');
    expect(lastSelection(setSelection)).toMatchObject({ text: '思', handlesSuppressed: false });
  });

  test('a drag that changes the long-press selection is left as dragged', async () => {
    const { result, setSelection } = setup();
    const { doc, node } = makePage();

    touchDown(result, doc);
    selectChar(node, '思');
    result.current.handleSelectionchange(doc, 0);
    await flush();
    // The finger drags on to 是: the selection now runs 思考是.
    const start = TEXT.indexOf('思');
    document.getSelection()!.setBaseAndExtent(node, start, node, start + 3);
    result.current.handleSelectionchange(doc, 0);
    await flush();
    await release(result, doc);
    await flush();

    expect(document.getSelection()!.toString()).toBe('思考是');
    expect(lastSelection(setSelection)).toMatchObject({ text: '思考是', handlesSuppressed: false });
  });

  test('a double-tap on one character selects its word', async () => {
    const { result, setSelection } = setup();
    const { doc, node } = makePage();
    Object.assign(document, {
      caretRangeFromPoint: () => {
        const range = document.createRange();
        range.setStart(node, TEXT.indexOf('思') + 1); // a caret after 思
        return range;
      },
    });

    await result.current.handleDoubleClick(doc, 0, 50, 50);

    expect(document.getSelection()!.toString()).toBe('思考');
    expect(lastSelection(setSelection)).toMatchObject({ text: '思考' });
  });
});
