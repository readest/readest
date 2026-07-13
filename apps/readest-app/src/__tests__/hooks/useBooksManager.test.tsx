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
  bookKeys: [] as string[],
  viewStates: {} as Record<string, { inited: boolean; view: object }>,
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
    () => ({
      bookKeys: h.bookKeys,
      setBookKeys: h.setBookKeysMock,
      initViewState: h.initViewStateMock,
    }),
    {
      getState: () => ({
        getView: () => null,
        setPreviewMode: vi.fn(),
        viewStates: h.viewStates,
      }),
      subscribe: () => () => {},
    },
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
import { setPendingTTSAutoplay } from '@/utils/ttsAutoplay';

describe('useBooksManager open-failure handling', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    h.bookKeys = [];
    h.viewStates = {};
    setPendingTTSAutoplay(null);
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

  // Cold-restore autoplay: the app relaunches straight into the reader with the
  // target book ALREADY mounted, and the `readest://book/{hash}?autoplay=tts`
  // deep link lands after the mount-time consumption effect has run. The
  // open-book-in-reader dispatch then hits the "existing" branch, which only
  // focuses the book — bookKeys never changes, so without consuming there the
  // pending autoplay is dropped and read-aloud never starts.
  it('starts TTS for an autoplay deep link when the book is already open', async () => {
    h.bookKeys = ['hash1-abc'];
    h.viewStates = { 'hash1-abc': { inited: true, view: {} } };
    const dispatchSpy = vi.spyOn(eventDispatcher, 'dispatch');

    renderHook(() => useBooksManager());

    await act(async () => {
      // Deep link arrives after mount (library hydration finished late).
      setPendingTTSAutoplay('hash1');
      eventDispatcher.dispatch('open-book-in-reader', { bookHash: 'hash1' });
      await Promise.resolve();
    });

    expect(dispatchSpy).toHaveBeenCalledWith('tts-speak', { bookKey: 'hash1-abc' });
    dispatchSpy.mockRestore();
  });
});
