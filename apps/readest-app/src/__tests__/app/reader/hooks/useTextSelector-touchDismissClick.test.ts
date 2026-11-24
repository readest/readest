// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// A touch tap away from the selection dismisses its toolbar. The webview clears
// the selection after the touch release, so the toolbar is gone before the tap's
// click turns into a single click. That click must only dismiss, not also turn
// the page. WebView2 sends pointerdown, touchstart, pointerup, touchend, then
// mousedown (which clears the selection), mouseup, click and selectionchange.

const h = vi.hoisted(() => ({
  view: { deselect: vi.fn(), getCFI: vi.fn(() => 'cfi'), renderer: { containerPosition: 0 } },
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isAndroidApp: false, isMobile: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewSettings: () => ({ scrolled: false }),
    getProgress: () => null,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(() => ({ getBookData: () => ({ isFixedLayout: false }) })),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { onSync: vi.fn(), offSync: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/utils/misc', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: () => 'windows' };
});

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';
import { eventDispatcher } from '@/utils/event';

const pointer = (pointerType: string, x: number, y: number) =>
  ({ pointerType, button: 0, clientX: x, clientY: y }) as PointerEvent;

const setup = () => {
  const hook: { current?: ReturnType<typeof useTextSelector> } = {};
  // The Annotator closes the toolbar, which reports back through handleShowPopup.
  const handleDismissPopup = vi.fn(() => hook.current?.handleShowPopup(false));
  const noop = vi.fn();
  const { result } = renderHook(() =>
    useTextSelector(
      'book-1',
      { top: 0, right: 0, bottom: 0, left: 0 },
      noop,
      noop,
      noop,
      vi.fn(async () => ''),
      handleDismissPopup,
    ),
  );
  hook.current = result.current;
  const singleClick = vi
    .mocked(eventDispatcher.onSync)
    .mock.calls.filter(([type]) => type === 'iframe-single-click')
    .at(-1)?.[1] as () => boolean;
  return { result, handleDismissPopup, singleClick };
};

// A selection with its toolbar up, at (50, 50). happy-dom has no layout.
const showSelection = (result: { current: ReturnType<typeof useTextSelector> }) => {
  const node = document.createTextNode('Hello world test');
  document.body.appendChild(node);
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, 5);
  Object.assign(range, {
    getClientRects: () => [{ left: 40, right: 60, top: 45, bottom: 55 }],
  });
  document.getSelection()!.addRange(range);
  result.current.isTextSelected.current = true;
  result.current.handleShowPopup(true);
};

// The webview clears the selection either with the tap's compatibility
// mousedown (WebView2) or already at the release.
const clearSelection = (result: { current: ReturnType<typeof useTextSelector> }) => {
  if (!document.getSelection()!.rangeCount) return;
  document.getSelection()!.removeAllRanges();
  result.current.handleSelectionchange(document, 0);
};

// A tap away from the selection at (500, 500), up to its click.
const tapUntilClick = async (
  result: { current: ReturnType<typeof useTextSelector> },
  pointerType = 'touch',
  clearedAt: 'mousedown' | 'release' = 'mousedown',
) => {
  const ev = pointer(pointerType, 500, 500);
  result.current.handlePointerDown(document, 0, ev);
  result.current.handleTouchStart();
  await result.current.handlePointerUp(document, 0, ev);
  result.current.handleTouchEnd(document, 0);
  if (clearedAt === 'release') clearSelection(result);
  result.current.handleMouseDown(new MouseEvent('mousedown', { button: 0, detail: 1 }));
  clearSelection(result);
};

// The same tap through its single click. Returns whether the reader consumed
// the click (true) or let it turn the page (false).
const tap = async (
  result: { current: ReturnType<typeof useTextSelector> },
  singleClick: () => boolean,
  pointerType = 'touch',
  clearedAt: 'mousedown' | 'release' = 'mousedown',
) => {
  await tapUntilClick(result, pointerType, clearedAt);
  return singleClick();
};

beforeEach(() => {
  document.getSelection()?.removeAllRanges();
  vi.mocked(eventDispatcher.onSync).mockClear();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('a tap away from the selection', () => {
  test.each([
    ['touch', 'mousedown'],
    ['pen', 'mousedown'],
    ['touch', 'release'],
  ] as const)('by %s, cleared at the %s, dismisses the toolbar without turning the page', async (type, clearedAt) => {
    const { result, handleDismissPopup, singleClick } = setup();
    showSelection(result);

    expect(await tap(result, singleClick, type, clearedAt)).toBe(true);
    expect(handleDismissPopup).toHaveBeenCalledOnce();
    expect(result.current.isTextSelected.current).toBe(false);
  });

  test('the next touch tap turns the page again', async () => {
    const { result, singleClick } = setup();
    showSelection(result);
    await tap(result, singleClick);

    expect(await tap(result, singleClick)).toBe(false);
  });

  test('a touch tap with no toolbar up turns the page', async () => {
    const { result, singleClick } = setup();

    expect(await tap(result, singleClick)).toBe(false);
  });
});

// A cancelled press (the webview took it over to scroll) never clicks. Once the
// toolbar is closed from its own buttons, a tap outside the page (the header, or
// beside the page) must still do its job.
test.each([
  ['pointercancel, then the native release', 'pointer'],
  ['touchcancel', 'touch'],
] as const)('a press ended by %s leaves the next click alone', (_, cancel) => {
  const { result, singleClick } = setup();
  showSelection(result);

  result.current.handlePointerDown(document, 0, pointer('touch', 500, 500));
  result.current.handleTouchStart();
  if (cancel === 'pointer') {
    result.current.handlePointerCancel(document, 0, pointer('touch', 500, 500));
    result.current.handleTouchEnd();
  } else {
    result.current.handleTouchCancel();
  }
  clearSelection(result);

  expect(result.current.isTextSelected.current).toBe(false);
  expect(singleClick()).toBe(false);
});

// Another iframe-single-click listener (auto-scroll, handwriting) can consume
// the dismissing tap before the reader sees it. A later click outside the page
// iframes starts with a press in the reader window and must not find the mark.
test('a tap another listener consumed leaves no mark for a click beside the page', async () => {
  const { result, singleClick } = setup();
  showSelection(result);
  await tapUntilClick(result);

  window.dispatchEvent(new Event('pointerdown'));

  expect(singleClick()).toBe(false);
});
