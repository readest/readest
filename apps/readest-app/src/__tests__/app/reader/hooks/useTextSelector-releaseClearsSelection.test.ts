// @vitest-environment happy-dom
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// A mouse press defers selectionchange to the release. A press that clears the
// selection (a click on a blank part of a PDF page) must dismiss the selection
// toolbar at that release: pdf.js moves `.endOfContent` under the pointer as the
// selection collapses, so Chromium sends no click and the single-click dismissal
// never runs (#6958).

const h = vi.hoisted(() => ({
  view: { deselect: vi.fn(), renderer: { containerPosition: 0 } },
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
  ...bookDataStoreHooks(() => ({ getBookData: () => ({ isFixedLayout: true }) })),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: { onSync: vi.fn(), offSync: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/utils/misc', async (importActual) => {
  const actual = await importActual<typeof import('@/utils/misc')>();
  return { ...actual, getOSPlatform: () => 'windows' };
});

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';
import { handleClickCapture, handleMousedown } from '@/app/reader/utils/iframeEventHandlers';
import { eventDispatcher } from '@/utils/event';

const mousePointer = (x: number, y: number) =>
  ({ pointerType: 'mouse', button: 0, clientX: x, clientY: y }) as PointerEvent;

const setup = () => {
  const handleDismissPopup = vi.fn();
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
  return { result, handleDismissPopup };
};

const selectText = () => {
  const node = document.createTextNode('Hello world test');
  document.body.appendChild(node);
  const range = document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, 5);
  // jsdom has no layout: put the selected text at (50, 50).
  Object.assign(range, {
    getClientRects: () => [{ left: 40, right: 60, top: 45, bottom: 55 }],
  });
  document.getSelection()!.addRange(range);
};

beforeEach(() => {
  document.getSelection()?.removeAllRanges();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('a mouse release that leaves no selection', () => {
  test('a separate click is not consumed by the previous popup-opening gesture', async () => {
    const { result, handleDismissPopup } = setup();
    result.current.handleUpToPopup();
    result.current.isTextSelected.current = true;
    await result.current.handlePointerUp(document, 0, mousePointer(5, 5));

    expect(handleDismissPopup).toHaveBeenCalledOnce();
    const clickListener = vi.mocked(eventDispatcher.onSync).mock.calls.at(-1)?.[1];
    expect(clickListener?.(new CustomEvent('iframe-single-click'))).toBe(false);
  });

  test.each([
    true,
    false,
  ])('consumes only the dismissing click (browser emits click: %s)', async (emitsClick) => {
    const { result, handleDismissPopup } = setup();
    selectText();
    result.current.isTextSelected.current = true;

    const target = document.body;
    const onMouseDown = (event: MouseEvent) => handleMousedown('book-1', event);
    const onClick = (event: MouseEvent) => handleClickCapture('book-1', event);
    const click = () =>
      target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 1 }));
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('click', onClick, true);

    try {
      result.current.handlePointerDown(document, 0, mousePointer(5, 5));
      document.getSelection()!.removeAllRanges();
      await result.current.handlePointerUp(document, 0, mousePointer(5, 5));
      expect(handleDismissPopup).toHaveBeenCalledOnce();
      if (emitsClick) expect(click()).toBe(false);

      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(click()).toBe(true);
    } finally {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('click', onClick, true);
    }
  });

  test('dismisses the selection toolbar', async () => {
    const { result, handleDismissPopup } = setup();
    selectText();
    result.current.isTextSelected.current = true;

    result.current.handlePointerDown(document, 0, mousePointer(5, 5));
    document.getSelection()!.removeAllRanges();
    result.current.handleSelectionchange(document, 0);
    expect(handleDismissPopup).not.toHaveBeenCalled();

    await result.current.handlePointerUp(document, 0, mousePointer(5, 5));

    expect(handleDismissPopup).toHaveBeenCalledOnce();
    expect(result.current.isTextSelected.current).toBe(false);
  });

  test('keeps the toolbar when the selection is still there', async () => {
    const { result, handleDismissPopup } = setup();
    selectText();
    result.current.isTextSelected.current = true;

    result.current.handlePointerDown(document, 0, mousePointer(500, 500));
    await result.current.handlePointerUp(document, 0, mousePointer(500, 500));

    expect(handleDismissPopup).not.toHaveBeenCalled();
    expect(result.current.isTextSelected.current).toBe(true);
  });
});
