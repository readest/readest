import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { eventDispatcher } from '@/utils/event';

// initViewState rejects with "Book not found" when a library reload drops the
// in-memory entry (readerStore). appendBook / openBookInReader call it
// fire-and-forget, so the rejection surfaced as an unhandled rejection
// (READEST-1V). The hook must catch it and surface a toast instead.
const h = vi.hoisted(() => ({
  initViewStateMock: vi.fn(() => Promise.resolve()),
  setBookKeysMock: vi.fn(),
  setSideBarBookKeyMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ toString: () => '' }),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {} }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    () => ({ bookKeys: [], setBookKeys: h.setBookKeysMock, initViewState: h.initViewStateMock }),
    { getState: () => ({ getView: () => null, setPreviewMode: vi.fn() }) },
  ),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ sideBarBookKey: null, setSideBarBookKey: h.setSideBarBookKeyMock }),
}));
vi.mock('@/store/parallelViewStore', () => ({
  useParallelViewStore: () => ({ setParallel: vi.fn() }),
}));
vi.mock('@/utils/nav', () => ({ navigateToReader: vi.fn() }));

import useBooksManager from '@/app/reader/hooks/useBooksManager';

describe('useBooksManager open-failure handling', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('toasts instead of leaking an unhandled rejection when the book is missing (READEST-1V)', async () => {
    h.initViewStateMock.mockReturnValueOnce(Promise.reject(new Error('Book not found')));
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    const { result } = renderHook(() => useBooksManager());

    await act(async () => {
      result.current.appendBook('missing-hash', true, false);
      // Flush the rejected initViewState microtask chain.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(dispatchSpy).toHaveBeenCalledWith('toast', expect.objectContaining({ type: 'error' }));
    dispatchSpy.mockRestore();
  });
});
