import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// A click that dismisses the selection toolbar must clear the selection too. In
// scroll mode a click in the next chapter lands in another section's iframe, so
// the selection it should clear is not in the clicked document and only
// view.deselect() reaches it (#6583). The reader view registers after the hook
// first renders, so the click handler must not hold on to that first render's view.

const h = vi.hoisted(() => ({
  view: undefined as undefined | { deselect: () => void },
  singleClick: null as null | (() => boolean),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.view,
    getViewSettings: () => ({ scrolled: true }),
    getProgress: () => null,
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ isFixedLayout: false }) }),
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    onSync: (name: string, handler: () => boolean) => {
      if (name === 'iframe-single-click') h.singleClick = handler;
    },
    offSync: vi.fn(),
  },
}));
vi.mock('@/utils/bridge', () => ({
  setSelectionSuppressed: vi.fn(async () => {}),
}));

import { useTextSelector } from '@/app/reader/hooks/useTextSelector';

afterEach(() => {
  cleanup();
  h.view = undefined;
  h.singleClick = null;
});

describe('single click on a selection', () => {
  test('deselects through the view that registered after the first render', () => {
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
    const deselect = vi.fn();
    h.view = { deselect };
    result.current.isTextSelected.current = true;

    expect(h.singleClick?.()).toBe(true);
    expect(handleDismissPopup).toHaveBeenCalledOnce();
    expect(deselect).toHaveBeenCalledOnce();
  });
});
