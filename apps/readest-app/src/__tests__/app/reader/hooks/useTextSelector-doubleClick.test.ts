import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// A double-click (or touch double-tap) on a word should select that word and
// route it through the same selection state that drives the quick action /
// annotation toolbar — mirroring a long-press selection.

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

// A jsdom document carrying a real text node and a caretRangeFromPoint that
// resolves to a caret inside "world".
const makeDoc = (caretOffset: number | null, text = 'Hello world test') => {
  const container = document.createElement('div');
  const node = document.createTextNode(text);
  container.appendChild(node);
  document.body.appendChild(container);
  Object.assign(document, {
    caretRangeFromPoint: () => {
      if (caretOffset === null) return null;
      const r = document.createRange();
      r.setStart(node, caretOffset);
      r.collapse(true);
      return r;
    },
  });
  return { container, node, doc: document as Document };
};

const mouseDown = (detail: number, x = 50, y = 50) =>
  ({ detail, button: 0, clientX: x, clientY: y }) as MouseEvent;

const mousePointer = (x = 50, y = 50) =>
  ({ pointerType: 'mouse', clientX: x, clientY: y }) as PointerEvent;

const makeRangeVisibleAt = (range: Range, x = 50, y = 50) => {
  Object.assign(range, {
    getClientRects: () =>
      ({
        0: { left: x - 5, right: x + 5, top: y - 5, bottom: y + 5 },
        length: 1,
        item: () => null,
      }) as unknown as DOMRectList,
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.appService = { isAndroidApp: false, isMobile: false };
  h.osPlatform = 'macos';
  h.viewSettings = { scrolled: false };
  document.getSelection()?.removeAllRanges();
});

afterEach(() => {
  cleanup();
  delete (document as { caretRangeFromPoint?: unknown }).caretRangeFromPoint;
  document.body.innerHTML = '';
});

describe('useTextSelector double-click word selection', () => {
  test('selects the word at the point and reports it as a selection', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, doc } = makeDoc(8); // caret inside "world"

    await result.current.handleDoubleClick(doc, 0, 50, 50);

    expect(setSelection).toHaveBeenCalledTimes(1);
    const arg = setSelection.mock.calls[0]![0] as TextSelection;
    expect(arg.text).toBe('world');
    expect(arg.index).toBe(0);
    // The DOM selection now holds the word, like a long-press selection.
    expect(document.getSelection()?.toString()).toBe('world');
    expect(result.current.isTextSelected.current).toBe(true);

    document.body.removeChild(container);
  });

  test('does nothing when the point is not on a word', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, doc } = makeDoc(null); // caretRangeFromPoint resolves nothing

    await result.current.handleDoubleClick(doc, 0, 0, 0);

    expect(setSelection).not.toHaveBeenCalled();
    document.body.removeChild(container);
  });

  test('skips when a native selection already exists (desktop double-click path)', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, node, doc } = makeDoc(8);

    // Simulate the browser having already selected the word natively.
    const pre = document.createRange();
    pre.setStart(node, 6);
    pre.setEnd(node, 11);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(pre);

    await result.current.handleDoubleClick(doc, 0, 50, 50);

    // The existing pointerup path owns this; the double-click handler must not
    // double-fire the selection.
    expect(setSelection).not.toHaveBeenCalled();
    document.body.removeChild(container);
  });

  test('normalizes a native double-click before publishing the selection', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, node, doc } = makeDoc(8);

    // Chromium can include the separator after a word in its native selection.
    const pre = document.createRange();
    pre.setStart(node, 6);
    pre.setEnd(node, 12);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(pre);
    makeRangeVisibleAt(pre);
    expect(sel.toString()).toBe('world ');

    result.current.handleMouseDown(mouseDown(2));
    await result.current.handlePointerUp(doc, 0, mousePointer());
    // The later click-derived double-click message must not publish a second,
    // competing TextSelection.
    await result.current.handleDoubleClick(doc, 0, 50, 50);

    // Keep the browser's live selection untouched. Only the Range captured by
    // Readest is normalized, avoiding native touch-handle rewrites (#1553).
    expect(sel.toString()).toBe('world ');
    expect(setSelection).toHaveBeenCalledTimes(1);
    const arg = setSelection.mock.calls[0]![0] as TextSelection;
    expect(arg.text).toBe('world');
    expect(arg.range.toString()).toBe('world');
    expect(arg.range).not.toBe(sel.getRangeAt(0));

    document.body.removeChild(container);
  });

  test('keeps only the clicked word when native selection spans Unicode whitespace', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, node, doc } = makeDoc(2, 'space\u202fbetween');
    const pre = document.createRange();
    pre.selectNodeContents(node);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(pre);
    makeRangeVisibleAt(pre);

    result.current.handleMouseDown(mouseDown(2));
    await result.current.handlePointerUp(doc, 0, mousePointer());

    expect(sel.toString()).toBe('space\u202fbetween');
    expect(setSelection).toHaveBeenCalledTimes(1);
    const arg = setSelection.mock.calls[0]![0] as TextSelection;
    expect(arg.text).toBe('space');
    expect(arg.range.toString()).toBe('space');
    expect(arg.range).not.toBe(sel.getRangeAt(0));

    document.body.removeChild(container);
  });

  test('preserves a native double-click selection deliberately extended into whitespace', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, node, doc } = makeDoc(8);

    // A double-click then drag can intentionally select only the separator,
    // without reaching the next word.
    const pre = document.createRange();
    pre.setStart(node, 6);
    pre.setEnd(node, 12);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(pre);
    makeRangeVisibleAt(pre, 60, 50);

    result.current.handleMouseDown(mouseDown(2));
    result.current.handlePointerMove(doc, 0, mousePointer(60, 50));
    await result.current.handlePointerUp(doc, 0, mousePointer(60, 50));
    await result.current.handleDoubleClick(doc, 0, 50, 50);

    expect(sel.toString()).toBe('world ');
    expect(setSelection).toHaveBeenCalledTimes(1);
    expect((setSelection.mock.calls[0]![0] as TextSelection).text).toBe('world ');

    document.body.removeChild(container);
  });

  test('does not normalize a stale selection outside the double-click target', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, node, doc } = makeDoc(8);
    const pre = document.createRange();
    pre.setStart(node, 6);
    pre.setEnd(node, 12);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(pre);
    makeRangeVisibleAt(pre, 200, 200);

    result.current.handleMouseDown(mouseDown(2));
    await result.current.handlePointerUp(doc, 0, mousePointer());

    expect(sel.toString()).toBe('world ');
    expect(setSelection).not.toHaveBeenCalled();

    document.body.removeChild(container);
  });
});

// #6803: double-clicking or long-pressing a word that a footnote marker follows
// selected the marker too, so the dictionary looked up "fox1".
describe('useTextSelector word selection next to a footnote marker', () => {
  const markerDoc = () => {
    const container = document.createElement('p');
    container.innerHTML = 'The fox<sup><a epub:type="noteref" href="#n1">1</a></sup> jumps';
    document.body.appendChild(container);
    const word = container.firstChild!;
    const marker = container.querySelector('a')!.firstChild!;
    Object.assign(document, {
      caretRangeFromPoint: () => {
        const r = document.createRange();
        r.setStart(word, 5);
        r.collapse(true);
        return r;
      },
    });
    // The browser's native word selection: "fox1".
    const pre = document.createRange();
    pre.setStart(word, 4);
    pre.setEnd(marker, 1);
    makeRangeVisibleAt(pre);
    const sel = document.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(pre);
    return { container, sel, doc: document as Document };
  };
  const touch = (x = 50, y = 50) =>
    ({
      pointerType: 'touch',
      pointerId: 1,
      button: 0,
      clientX: x,
      clientY: y,
      target: document.body,
    }) as unknown as PointerEvent;

  test('a mouse double-click looks up the word without the marker', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, sel, doc } = markerDoc();

    result.current.handleMouseDown(mouseDown(2));
    await result.current.handlePointerUp(doc, 0, mousePointer());

    expect(sel.toString()).toBe('fox1');
    const arg = setSelection.mock.calls[0]![0] as TextSelection;
    expect(arg.text).toBe('fox');
    document.body.removeChild(container);
  });

  // makeSelection re-applies the live range, so the browser fires a
  // selectionchange after the double-click; it must not republish "fox1".
  test('keeps the word when the selectionchange after a double-click arrives', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, doc } = markerDoc();

    result.current.handleMouseDown(mouseDown(2));
    await result.current.handlePointerUp(doc, 0, mousePointer());
    result.current.handleSelectionchange(doc, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const last = setSelection.mock.calls.at(-1)![0] as TextSelection;
    expect(last.text).toBe('fox');
    document.body.removeChild(container);
  });

  test('a still long-press looks up the word without the marker', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, sel, doc } = markerDoc();
    sel.removeAllRanges();
    result.current.handlePointerDown(doc, 0, touch());
    // The long-press selects the word natively while the finger is down.
    const pre = document.createRange();
    pre.setStart(container.firstChild!, 4);
    pre.setEnd(container.querySelector('a')!.firstChild!, 1);
    makeRangeVisibleAt(pre);
    sel.addRange(pre);
    await result.current.handlePointerUp(doc, 0, touch());

    const arg = setSelection.mock.calls[0]![0] as TextSelection;
    expect(arg.text).toBe('fox');
    document.body.removeChild(container);
  });

  // A handle drag starts from an existing selection.
  test('a selection dragged onto the marker keeps it (#6566)', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, sel, doc } = markerDoc();
    const word = document.createRange();
    word.setStart(container.firstChild!, 4);
    word.setEnd(container.firstChild!, 7);
    sel.removeAllRanges();
    sel.addRange(word);
    result.current.handlePointerDown(doc, 0, touch(10, 50));
    const pre = document.createRange();
    pre.setStart(container.firstChild!, 4);
    pre.setEnd(container.querySelector('a')!.firstChild!, 1);
    makeRangeVisibleAt(pre);
    sel.removeAllRanges();
    sel.addRange(pre);
    await result.current.handlePointerUp(doc, 0, touch(50, 50));

    const arg = setSelection.mock.calls[0]![0] as TextSelection;
    expect(arg.text).toBe('fox1');
    document.body.removeChild(container);
  });

  test('a long-press that goes on to drag onto the marker keeps it', async () => {
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, sel, doc } = markerDoc();
    sel.removeAllRanges();
    result.current.handlePointerDown(doc, 0, touch(10, 50));
    const word = document.createRange();
    word.setStart(container.firstChild!, 0);
    word.setEnd(container.firstChild!, 3);
    sel.addRange(word);
    result.current.handleSelectionchange(doc, 0);
    const pre = document.createRange();
    pre.setStart(container.firstChild!, 0);
    pre.setEnd(container.querySelector('a')!.firstChild!, 1);
    makeRangeVisibleAt(pre);
    sel.removeAllRanges();
    sel.addRange(pre);
    await result.current.handlePointerUp(doc, 0, touch(50, 50));

    const last = setSelection.mock.calls.at(-1)![0] as TextSelection;
    expect(last.text).toBe('The fox1');
    document.body.removeChild(container);
  });

  // Android publishes the long-press selection from selectionchange while the
  // finger is down; the release comes from the native bridge with no event.
  test('an Android long-press looks up the word without the marker', async () => {
    h.appService = { isAndroidApp: true, isMobile: true };
    h.osPlatform = 'android';
    const setSelection = vi.fn();
    const { result } = setup(setSelection);
    const { container, sel, doc } = markerDoc();
    sel.removeAllRanges();
    result.current.handlePointerDown(doc, 0, touch());
    const pre = document.createRange();
    pre.setStart(container.firstChild!, 4);
    pre.setEnd(container.querySelector('a')!.firstChild!, 1);
    makeRangeVisibleAt(pre);
    sel.addRange(pre);
    result.current.handleSelectionchange(doc, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await result.current.handlePointerUp(doc, 0);

    expect(sel.toString()).toBe('fox1');
    expect(setSelection).toHaveBeenCalled();
    for (const [arg] of setSelection.mock.calls) {
      expect((arg as TextSelection).text).toBe('fox');
    }
    document.body.removeChild(container);
  });
});
