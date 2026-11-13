import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// A lookup popup can never stack above the platform's selection grabbers: iOS
// draws them as UIKit views over the whole web layer, outside the DOM. #5213
// rules out deselecting (the selection has to survive the lookup so its dismiss
// returns to the toolbar), so `suppressNativeSelectionHandles` takes the
// grabbers away and leaves the selection: empty the selection for one painted
// frame, then put the same range back programmatically. The engine only draws
// grabbers for a user-initiated selection, so they do not come back, and
// `handlesSuppressed` hands the job to the app's own handles.

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
  appService: { isAndroidApp: false, isMobile: true },
  osPlatform: 'ios',
  viewSettings: { scrolled: false },
  isFixedLayout: false,
  format: 'EPUB',
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
  ...bookDataStoreHooks(() => ({
    getBookData: () => ({ isFixedLayout: h.isFixedLayout, book: { format: h.format } }),
  })),
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
import type { TextSelection } from '@/utils/sel';

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

const setup = (
  getAnnotationText: (range: Range) => Promise<string> = async (range) => range.toString(),
) => {
  const setSelection = vi.fn();
  const noop = vi.fn();
  const hook = renderHook(() =>
    useTextSelector(
      'book-1',
      ZERO_INSETS,
      setSelection as never,
      noop,
      noop,
      getAnnotationText,
      noop,
    ),
  );
  return { ...hook, setSelection };
};

/** A section iframe with `text` selected, as a touch long-press would leave it. */
const makeSelectedPage = (text: string, index = 0) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument!;
  const win = iframe.contentWindow as Window & typeof globalThis;
  win.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as never;
  doc.body.innerHTML = `<p><span>${text}</span></p>`;
  const span = doc.querySelector('span')!;
  const range = doc.createRange();
  range.selectNodeContents(span);
  doc.getSelection()!.addRange(range);
  return { doc, index, win };
};

const flush = () => new Promise((r) => setTimeout(r, 20));

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  h.appService = { isAndroidApp: false, isMobile: true };
  h.osPlatform = 'ios';
  h.viewSettings = { scrolled: false };
  h.isFixedLayout = false;
  h.format = 'EPUB';
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('suppressNativeSelectionHandles', () => {
  test('puts the same selection back and hands the handles to the app', async () => {
    const page = makeSelectedPage('a selected phrase');
    h.contents = [page];
    const { result, setSelection } = setup();

    const done = result.current.suppressNativeSelectionHandles();
    // The selection is emptied first — that is the frame that drops the
    // platform's grabbers.
    expect(page.doc.getSelection()!.rangeCount).toBe(0);

    await done;
    await flush();

    // ...and the very same range is back, so the lookup still has its text and
    // the toolbar has something to return to (#5213).
    expect(page.doc.getSelection()!.toString()).toBe('a selected phrase');

    const update = setSelection.mock.calls.at(-1)![0] as (
      prev: TextSelection | null,
    ) => TextSelection | null;
    expect(update({ text: 'a selected phrase' } as TextSelection)).toMatchObject({
      handlesSuppressed: true,
    });
  });

  test('leaves a desktop selection alone — there are no grabbers to take away', async () => {
    h.appService = { isAndroidApp: false, isMobile: false };
    const page = makeSelectedPage('a selected phrase');
    h.contents = [page];
    const { result, setSelection } = setup();

    await result.current.suppressNativeSelectionHandles();
    await flush();

    expect(page.doc.getSelection()!.toString()).toBe('a selected phrase');
    expect(setSelection).not.toHaveBeenCalled();
  });

  test('backs off when another gesture re-selects while the frame is empty', async () => {
    const page = makeSelectedPage('a selected phrase');
    h.contents = [page];
    const { result, setSelection } = setup();

    const done = result.current.suppressNativeSelectionHandles();
    // A competing gesture lands during the empty frame: the cloned range is no
    // longer what is on screen, so it must not be forced back.
    const other = page.doc.createRange();
    other.selectNodeContents(page.doc.querySelector('p')!);
    page.doc.getSelection()!.addRange(other);

    await done;
    await flush();

    expect(setSelection).not.toHaveBeenCalled();
  });

  test('does nothing when there is no live selection', async () => {
    const page = makeSelectedPage('a selected phrase');
    page.doc.getSelection()!.removeAllRanges();
    h.contents = [page];
    const { result, setSelection } = setup();

    await result.current.suppressNativeSelectionHandles();
    await flush();

    expect(setSelection).not.toHaveBeenCalled();
  });
});

describe('Android PDF endpoint handles', () => {
  test('an older asynchronous selection cannot replace the released PDF app handles', async () => {
    h.appService = { isAndroidApp: true, isMobile: true };
    h.osPlatform = 'android';
    h.format = 'PDF';
    h.isFixedLayout = true;
    const page = makeSelectedPage('a selected phrase', 3);
    const win = page.doc.defaultView as Window & typeof globalThis;
    win.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    win.Range.prototype.getBoundingClientRect = () => new DOMRect(10, 10, 100, 20);
    h.contents = [page];
    let finishOld!: (text: string) => void;
    const text = vi
      .fn<(range: Range) => Promise<string>>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockImplementation(async (range) => range.toString());
    const { result, setSelection } = setup(text);
    result.current.handleTouchStart();
    result.current.handleSelectionchange(page.doc, page.index);
    expect(text).toHaveBeenCalledTimes(1);
    await result.current.handlePointerUp(page.doc, page.index);
    await flush();
    expect(setSelection.mock.calls.at(-1)![0]).toMatchObject({ handlesSuppressed: true });
    finishOld('a selected phrase');
    await flush();
    expect(setSelection.mock.calls.at(-1)![0]).toMatchObject({ handlesSuppressed: true });
  });

  test.each([
    'PDF',
    'EPUB',
  ])('publishes app handles only for a paginated %s selection', async (format) => {
    h.appService = { isAndroidApp: true, isMobile: true };
    h.osPlatform = 'android';
    h.format = format;
    h.isFixedLayout = format === 'PDF';
    const page = makeSelectedPage('a selected phrase', 3);
    const win = page.doc.defaultView as Window & typeof globalThis;
    win.Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
    win.Range.prototype.getBoundingClientRect = () => new DOMRect(10, 10, 100, 20);
    h.contents = [page];
    const { result, setSelection } = setup();
    result.current.handleTouchStart();
    result.current.handleSelectionchange(page.doc, page.index);
    await flush();
    await result.current.handlePointerUp(page.doc, page.index);
    await flush();
    expect(page.doc.getSelection()!.toString()).toBe('a selected phrase');
    const published = setSelection.mock.calls
      .map(([value]) => value)
      .filter((value) => typeof value !== 'function');
    expect(published.at(-1)).toMatchObject({
      text: 'a selected phrase',
      handlesSuppressed: format === 'PDF',
    });
  });
});

// The other half of the same trick (#6213): the instant dictionary quick action
// deselects as it opens, and hands the selection back when the lookup closes so
// the word can still be highlighted or copied. The re-add is programmatic for
// the same reason — no grabbers come back — and it must publish nothing, or the
// Annotator would read it as a fresh selection and re-run the quick action.
describe('restoreSelectionRange', () => {
  test('puts the range back on screen without republishing the selection', () => {
    const page = makeSelectedPage('a selected phrase');
    const range = page.doc.getSelection()!.getRangeAt(0).cloneRange();
    page.doc.getSelection()!.removeAllRanges();
    h.contents = [page];
    const { result, setSelection } = setup();

    expect(result.current.restoreSelectionRange(range)).toBe(true);

    expect(page.doc.getSelection()!.toString()).toBe('a selected phrase');
    expect(result.current.isTextSelected.current).toBe(true);
    expect(setSelection).not.toHaveBeenCalled();
  });

  test('the selectionchange it fires is ignored', async () => {
    const page = makeSelectedPage('a selected phrase');
    const range = page.doc.getSelection()!.getRangeAt(0).cloneRange();
    page.doc.getSelection()!.removeAllRanges();
    h.contents = [page];
    const { result, setSelection } = setup();

    result.current.restoreSelectionRange(range);
    await result.current.handleSelectionchange(page.doc, page.index);

    expect(setSelection).not.toHaveBeenCalled();
  });

  test('refuses a collapsed range', () => {
    const page = makeSelectedPage('a selected phrase');
    const range = page.doc.createRange();
    range.setStart(page.doc.querySelector('span')!.firstChild!, 0);
    range.collapse(true);
    page.doc.getSelection()!.removeAllRanges();
    h.contents = [page];
    const { result } = setup();

    expect(result.current.restoreSelectionRange(range)).toBe(false);
    expect(page.doc.getSelection()!.rangeCount).toBe(0);
  });
});
