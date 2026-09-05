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
import type { TextSelection } from '@/utils/sel';

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
