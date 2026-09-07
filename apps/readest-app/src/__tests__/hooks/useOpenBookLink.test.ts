import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// Defect B (see the pause-investigation report's "unrelated defects" section):
// a `readest://book/<abs-hash>` deep link arriving while a regular book's
// reader is already mounted used to be treated like any other book and
// dispatched into the reader in place ('open-book-in-reader'), which drives
// useBooksManager's initViewState down the document-loader path a streaming
// ABS book has no file for - the reader hangs on the spinner. An audiobook
// must route to the player instead, the same way a library tap on an ABS
// book already does (router.push('/player?id=...')), regardless of whether
// a reader happens to be mounted underneath.
const navigateToReaderMock = vi.fn();
const getCurrentMock = vi.fn(async () => [] as string[]);
const routerPushMock = vi.fn();

const books: Record<string, { hash: string; format: string }> = {
  epubBook: { hash: 'epubBook', format: 'EPUB' },
  absBook: { hash: 'absBook', format: 'ABS' },
};

const libraryState = {
  libraryLoaded: true,
  getBookByHash: (hash: string) => books[hash],
};

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: () => getCurrentMock(),
}));
vi.mock('@/services/environment', async (orig) => {
  const actual = await orig<typeof import('@/services/environment')>();
  return { ...actual, isTauriAppPlatform: () => true };
});
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (k: string) => k }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPushMock }) }));
vi.mock('@/utils/nav', () => ({
  navigateToReader: (...a: unknown[]) => navigateToReaderMock(...a),
}));
vi.mock('@/store/libraryStore', () => {
  const useLibraryStore = ((selector: (s: typeof libraryState) => unknown) =>
    selector(libraryState)) as unknown as {
    (selector: (s: typeof libraryState) => unknown): unknown;
    getState: () => typeof libraryState;
  };
  useLibraryStore.getState = () => libraryState;
  return { useLibraryStore };
});

import { useOpenBookLink } from '@/hooks/useOpenBookLink';
import { eventDispatcher } from '@/utils/event';

const urlFor = (hash: string) => `readest://book/${hash}`;

const collectSwitch = () => {
  const switched = vi.fn();
  const handler = (e: Event) => switched((e as CustomEvent).detail);
  eventDispatcher.on('open-book-in-reader', handler);
  return {
    switched,
    stop: () => eventDispatcher.off('open-book-in-reader', handler),
  };
};

describe('useOpenBookLink — audiobook deep link', () => {
  beforeEach(() => {
    navigateToReaderMock.mockReset();
    routerPushMock.mockReset();
  });
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('routes a plain-book deep link into the already-mounted reader as before', async () => {
    window.history.replaceState({}, '', '/reader?ids=other');
    const { switched, stop } = collectSwitch();

    renderHook(() => useOpenBookLink());
    await eventDispatcher.dispatch('app-incoming-url', { urls: [urlFor('epubBook')] });
    await Promise.resolve();
    stop();

    expect(switched).toHaveBeenCalledWith(expect.objectContaining({ bookHash: 'epubBook' }));
    expect(routerPushMock).not.toHaveBeenCalled();
  });

  it('routes an audiobook deep link straight to the player when no reader is mounted', async () => {
    window.history.replaceState({}, '', '/library');

    renderHook(() => useOpenBookLink());
    await eventDispatcher.dispatch('app-incoming-url', { urls: [urlFor('absBook')] });
    await Promise.resolve();

    expect(routerPushMock).toHaveBeenCalledWith('/player?id=absBook');
    expect(navigateToReaderMock).not.toHaveBeenCalled();
  });

  it('routes an audiobook deep link to the player instead of pushing it into an already-mounted reader', async () => {
    window.history.replaceState({}, '', '/reader?ids=epubBook');
    const { switched, stop } = collectSwitch();

    renderHook(() => useOpenBookLink());
    await eventDispatcher.dispatch('app-incoming-url', { urls: [urlFor('absBook')] });
    await Promise.resolve();
    stop();

    expect(routerPushMock).toHaveBeenCalledWith('/player?id=absBook');
    // Must not take the reader in-place-switch ingress - that drives
    // initViewState down the document-loader path and hangs (no file to load
    // for a streaming ABS book).
    expect(switched).not.toHaveBeenCalled();
    expect(navigateToReaderMock).not.toHaveBeenCalled();
  });
});
