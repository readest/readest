import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// Cross-page selection in fixed-layout books (#5809): every PDF page is its own
// iframe, so a selection cannot leave the page it started on. A mouse drag that
// leaves its page keeps reporting to that page (the browser captures the drag)
// with out-of-frame coordinates; the selector extends the selection into the
// page under the pointer, freezes the origin page's native drag meanwhile, and
// commits one selection with per-page segments on release. On Android the
// app's own handles drive the same engine through dragSelectionTo.

const h = vi.hoisted(() => ({
  contents: [] as { doc: Document; index: number }[],
  view: {
    next: vi.fn(),
    prev: vi.fn(),
    deselect: vi.fn(),
    getCFI: vi.fn((index: number) => `cfi-${index}`),
    renderer: {
      containerPosition: 0,
      scrollLocked: false,
      getContents: () => h.contents,
    },
  },
  appService: { isAndroidApp: false, isMobile: false },
  osPlatform: 'macos',
  viewSettings: { scrolled: true },
  isFixedLayout: true,
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
  useBookDataStore: () => ({ getBookData: () => ({ isFixedLayout: h.isFixedLayout }) }),
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
      vi.fn(async (range: Range) => range.toString()),
      noop,
    ),
  );
  return { ...hook, setSelection };
};

// A PDF page iframe (pdf.js text layer) at a window rect, whose caret lookup is
// pinned to a fixed text offset.
const makePage = (top: number, text: string, caretOffset: number, index: number) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  // jsdom Ranges have no layout: let every range (a glyph box probed by the
  // text-hit test, the selection the native release path measures) cover the
  // whole page.
  const win = iframe.contentWindow as Window & typeof globalThis;
  const pageBox = { left: 0, top: 0, right: 400, bottom: 400, width: 400, height: 400 };
  win.Range.prototype.getClientRects = () => [pageBox] as unknown as DOMRectList;
  win.Range.prototype.getBoundingClientRect = () => pageBox as DOMRect;
  win.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as never;
  doc.body.innerHTML = `<div id="canvas"></div><div class="textLayer"><span>${text}</span><div class="endOfContent"></div></div>`;
  iframe.getBoundingClientRect = () =>
    ({ left: 0, top, right: 400, bottom: top + 400, width: 400, height: 400 }) as DOMRect;
  const textNode = doc.querySelector('span')!.firstChild as Text;
  doc.caretPositionFromPoint = () => ({ offsetNode: textNode, offset: caretOffset }) as never;
  return { doc, index, textNode };
};

const mouse = (clientX: number, clientY: number, buttons = 1) =>
  ({
    pointerType: 'mouse',
    button: 0,
    buttons,
    clientX,
    clientY,
    target: document.createElement('span'),
    preventDefault: vi.fn(),
  }) as unknown as PointerEvent;

const flush = () => new Promise((r) => setTimeout(r, 10));

let pageA: ReturnType<typeof makePage>;
let pageB: ReturnType<typeof makePage>;

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  h.appService = { isAndroidApp: false, isMobile: false };
  h.osPlatform = 'macos';
  h.viewSettings = { scrolled: true };
  h.isFixedLayout = true;
  pageA = makePage(0, 'first page text', 6, 1);
  pageB = makePage(404, 'second page text', 6, 2);
  h.contents = [pageA, pageB];
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('cross-page mouse drag in a fixed-layout book', () => {
  test('a drag onto the next page selects both parts and commits one segmented selection', async () => {
    const { result, setSelection } = setup();
    result.current.handlePointerDown(pageA.doc, 1, mouse(50, 50));
    // Still on the origin page: the native drag owns the selection.
    result.current.handlePointerMove(pageA.doc, 1, mouse(60, 100));
    expect(pageA.doc.documentElement.style.userSelect).toBe('');
    expect(pageB.doc.getSelection()!.rangeCount).toBe(0);

    // The pointer is now over page B (reported to page A with out-of-frame y).
    result.current.handlePointerMove(pageA.doc, 1, mouse(60, 500));
    expect(pageA.doc.documentElement.style.userSelect).toBe('none');
    expect(pageA.doc.querySelector<HTMLElement>('.textLayer')!.style.userSelect).toBe('text');
    expect(pageA.doc.getSelection()!.toString()).toBe('page text');
    expect(pageB.doc.getSelection()!.toString()).toBe('second');

    await result.current.handlePointerUp(pageA.doc, 1, mouse(60, 500, 0));
    expect(pageA.doc.documentElement.style.userSelect).toBe('');
    expect(setSelection).toHaveBeenCalledTimes(1);
    const selection = setSelection.mock.calls[0]![0];
    expect(selection.text).toBe('page text second');
    expect(selection.index).toBe(1);
    expect(selection.cfi).toBe('cfi-1');
    expect(selection.segments.map((s: { index: number }) => s.index)).toEqual([1, 2]);
    expect(selection.segments.map((s: { text: string }) => s.text)).toEqual([
      'page text',
      'second',
    ]);
    // Both parts stay selected on screen.
    expect(pageA.doc.getSelection()!.toString()).toBe('page text');
    expect(pageB.doc.getSelection()!.toString()).toBe('second');
  });

  test('returning to the origin page hands the drag back and clears the other page', async () => {
    const { result, setSelection } = setup();
    result.current.handlePointerDown(pageA.doc, 1, mouse(50, 50));
    result.current.handlePointerMove(pageA.doc, 1, mouse(60, 500));
    expect(pageB.doc.getSelection()!.rangeCount).toBe(1);

    result.current.handlePointerMove(pageA.doc, 1, mouse(60, 120));
    expect(pageA.doc.documentElement.style.userSelect).toBe('');
    expect(pageB.doc.getSelection()!.rangeCount).toBe(0);

    await result.current.handlePointerUp(pageA.doc, 1, mouse(60, 120, 0));
    expect(setSelection).not.toHaveBeenCalledWith(
      expect.objectContaining({ segments: expect.anything() }),
    );
  });

  test('a drag that stays on one page never touches the other page', async () => {
    const { result } = setup();
    result.current.handlePointerDown(pageA.doc, 1, mouse(50, 50));
    result.current.handlePointerMove(pageA.doc, 1, mouse(300, 300));
    await result.current.handlePointerUp(pageA.doc, 1, mouse(300, 300, 0));
    expect(pageA.doc.documentElement.style.userSelect).toBe('');
    expect(pageB.doc.getSelection()!.rangeCount).toBe(0);
  });
});

describe('dragSelectionTo (the app handles)', () => {
  const anchorOnA = () => ({
    doc: pageA.doc,
    index: 1,
    pos: { node: pageA.textNode, offset: 6 },
  });

  test('a handle dragged onto the next page extends across and commits a segmented selection', async () => {
    const { result, setSelection } = setup();
    const live = await result.current.dragSelectionTo(anchorOnA(), { x: 60, y: 500 }, false);
    expect(pageA.doc.getSelection()!.toString()).toBe('page text');
    expect(pageB.doc.getSelection()!.toString()).toBe('second');
    expect(live).toMatchObject({
      start: { index: 1, pos: { node: pageA.textNode, offset: 6 } },
      end: { index: 2, pos: { node: pageB.textNode, offset: 6 } },
    });
    expect(setSelection).not.toHaveBeenCalled();

    await result.current.dragSelectionTo(anchorOnA(), { x: 60, y: 500 }, true);
    expect(setSelection).toHaveBeenCalledTimes(1);
    const selection = setSelection.mock.calls[0]![0];
    expect(selection.text).toBe('page text second');
    expect(selection.segments.map((s: { index: number }) => s.index)).toEqual([1, 2]);
    // The app handles stay in charge of the committed selection.
    expect(selection.handlesSuppressed).toBe(true);
  });

  test('a drag released off any page commits what it built and lets later selection changes through', async () => {
    const { result, setSelection } = setup();
    const anchor = { doc: pageA.doc, index: 1, pos: { node: pageA.textNode, offset: 0 } };
    await result.current.dragSelectionTo(anchor, { x: 60, y: 100 }, false);
    // Released in the gap between pages: nothing under the point.
    const bounds = await result.current.dragSelectionTo(anchor, { x: 60, y: 402 }, true);
    expect(bounds?.start.index).toBe(1);
    expect(setSelection).toHaveBeenCalledTimes(1);
    expect(setSelection.mock.calls[0]![0]).toMatchObject({
      text: 'first ',
      handlesSuppressed: true,
    });
    // The programmatic guard held during the drag must not outlive it: a
    // later native selection change is processed again.
    await new Promise((r) => setTimeout(r, 200));
    pageA.doc.getSelection()!.setBaseAndExtent(pageA.textNode, 6, pageA.textNode, 10);
    result.current.handleSelectionchange(pageA.doc, 1);
    await flush();
    expect(setSelection).toHaveBeenCalledTimes(2);
    expect(setSelection.mock.calls[1]![0]).toMatchObject({ text: 'page' });
  });

  test("a handle dragged back onto the anchor page drops the other page's part", async () => {
    const { result, setSelection } = setup();
    // Anchored at the page start so the caret (pinned at offset 6) spans text.
    const anchor = { doc: pageA.doc, index: 1, pos: { node: pageA.textNode, offset: 0 } };
    await result.current.dragSelectionTo(anchor, { x: 60, y: 500 }, false);
    expect(pageB.doc.getSelection()!.rangeCount).toBe(1);
    const bounds = await result.current.dragSelectionTo(anchor, { x: 60, y: 100 }, true);
    expect(pageB.doc.getSelection()!.rangeCount).toBe(0);
    expect(bounds?.start.index).toBe(1);
    expect(bounds?.end.index).toBe(1);
    expect(setSelection).toHaveBeenCalledTimes(1);
    const selection = setSelection.mock.calls[0]![0];
    expect(selection).toMatchObject({ index: 1, text: 'first ', handlesSuppressed: true });
    expect(selection.segments).toBeUndefined();
  });
});

describe('gating: only fixed-layout books in scroll mode', () => {
  const crossPageStaysOff = async (result: ReturnType<typeof setup>['result']) => {
    // A mouse drag over another section iframe never crosses.
    result.current.handlePointerDown(pageA.doc, 1, mouse(50, 50));
    result.current.handlePointerMove(pageA.doc, 1, mouse(60, 500));
    expect(pageA.doc.documentElement.style.userSelect).toBe('');
    expect(pageB.doc.getSelection()!.rangeCount).toBe(0);
    await result.current.handlePointerUp(pageA.doc, 1, mouse(60, 500, 0));
    expect(pageB.doc.getSelection()!.rangeCount).toBe(0);
    // The app handles stay in the anchor's own document: the point is mapped
    // into that document (its iframe starts at y=0, so 500 lands on its text).
    const anchor = { doc: pageA.doc, index: 1, pos: { node: pageA.textNode, offset: 0 } };
    const bounds = await result.current.dragSelectionTo(anchor, { x: 60, y: 500 }, false);
    expect(bounds?.end.index).toBe(1);
    expect(pageA.doc.getSelection()!.toString()).toBe('first ');
    expect(pageB.doc.getSelection()!.rangeCount).toBe(0);
    // A stale selection on another section is left alone.
    pageB.doc.getSelection()!.setBaseAndExtent(pageB.textNode, 0, pageB.textNode, 6);
    pageA.doc.getSelection()!.setBaseAndExtent(pageA.textNode, 0, pageA.textNode, 5);
    result.current.handleSelectionchange(pageA.doc, 1);
    await flush();
    expect(pageB.doc.getSelection()!.toString()).toBe('second');
  };

  test('a reflowable book (EPUB) keeps single-document selection behaviour', async () => {
    h.isFixedLayout = false;
    const { result } = setup();
    await crossPageStaysOff(result);
  });

  test('a paginated fixed-layout book keeps single-document selection behaviour', async () => {
    h.viewSettings = { scrolled: false };
    const { result } = setup();
    await crossPageStaysOff(result);
  });

  test('a fixed-layout book in scroll mode drops a stale selection left on another page', async () => {
    const { result } = setup();
    pageB.doc.getSelection()!.setBaseAndExtent(pageB.textNode, 0, pageB.textNode, 6);
    pageA.doc.getSelection()!.setBaseAndExtent(pageA.textNode, 0, pageA.textNode, 5);
    result.current.handleSelectionchange(pageA.doc, 1);
    await flush();
    expect(pageB.doc.getSelection()!.rangeCount).toBe(0);
  });
});

describe('Android: app handles for fixed-layout pages in scroll mode', () => {
  beforeEach(() => {
    h.appService = { isAndroidApp: true, isMobile: true };
    h.osPlatform = 'android';
  });

  // A native long-press selection on a page.
  const nativeSelect = (page: ReturnType<typeof makePage>, from: number, to: number) =>
    page.doc.getSelection()!.setBaseAndExtent(page.textNode, from, page.textNode, to);

  test('a touch selection is republished with the native handles suppressed at touch end', async () => {
    const { result, setSelection } = setup();
    result.current.handleTouchStart();
    nativeSelect(pageA, 0, 5);
    result.current.handleSelectionchange(pageA.doc, 1);
    await flush();
    expect(setSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'first', handlesSuppressed: false }),
    );
    await result.current.handlePointerUp(pageA.doc, 1);
    await flush();
    expect(setSelection).toHaveBeenLastCalledWith(
      expect.objectContaining({ text: 'first', handlesSuppressed: true }),
    );
    expect(pageA.doc.getSelection()!.toString()).toBe('first');
  });

  test('paginated fixed-layout keeps the native handles', async () => {
    h.viewSettings = { scrolled: false };
    const { result, setSelection } = setup();
    result.current.handleTouchStart();
    nativeSelect(pageA, 0, 5);
    result.current.handleSelectionchange(pageA.doc, 1);
    await flush();
    await result.current.handlePointerUp(pageA.doc, 1);
    await flush();
    expect(setSelection).not.toHaveBeenCalledWith(
      expect.objectContaining({ handlesSuppressed: true }),
    );
  });
});
