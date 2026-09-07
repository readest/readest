import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// #6104: tauri-plugin-deep-link keeps the launch URL in PROCESS-global state for
// the whole app session — macOS's `RunEvent::Opened` replaces it and nothing ever
// clears it — so getCurrent() keeps handing back `readest://book/<hash>` long
// after that book was opened. Both JS consume-once guards (the module-scoped
// `coldStartConsumed` flag and the `consumedColdStartBookUrl` sessionStorage key)
// are per-webview, and `openBookInNewWindow` defaults to true on desktop, so
// every bookshelf click spawned a fresh reader window that re-read the stale URL
// and swapped the clicked book for the deep-linked one. A cold-start URL belongs
// to the window that received the launch; windows the app spawns itself carry
// their own intent in their URL and must never consume it.

let currentWindowLabel = 'main';
let coldStartUrls: string[] = [];
const navigateToReaderMock = vi.fn();
const routerPushMock = vi.fn();

const books: Record<string, { hash: string; format: string }> = {
  linkedBook: { hash: 'linkedBook', format: 'EPUB' },
  clickedBook: { hash: 'clickedBook', format: 'EPUB' },
};

const libraryState = {
  libraryLoaded: true,
  getBookByHash: (hash: string) => books[hash],
};

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: async () => coldStartUrls,
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: currentWindowLabel }),
  getAllWindows: async () => [],
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

// Warm the module graph once at file scope: vi.resetModules() below only has to
// re-execute cached modules instead of resolving and transforming the whole
// hook graph inside a test's timeout.
import '@/hooks/useOpenBookLink';

// The hook's cold-start guard is module state, so each case needs a fresh module
// registry — and with it a fresh eventDispatcher to listen on.
const loadHook = async () => {
  vi.resetModules();
  const { useOpenBookLink } = await import('@/hooks/useOpenBookLink');
  const { eventDispatcher } = await import('@/utils/event');
  return { useOpenBookLink, eventDispatcher };
};

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

const runColdStart = async (label: string, pathname: string) => {
  currentWindowLabel = label;
  window.history.replaceState({}, '', pathname);
  const { useOpenBookLink, eventDispatcher } = await loadHook();
  const switched = vi.fn();
  const handler = (e: Event) => switched((e as CustomEvent).detail);
  eventDispatcher.on('open-book-in-reader', handler);
  renderHook(() => useOpenBookLink());
  await flush();
  eventDispatcher.off('open-book-in-reader', handler);
  return switched;
};

describe('useOpenBookLink — cold-start deep link ownership (#6104)', () => {
  beforeEach(() => {
    coldStartUrls = ['readest://book/linkedBook'];
    navigateToReaderMock.mockReset();
    routerPushMock.mockReset();
    sessionStorage.clear();
  });
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('does not hijack a reader window the app spawned for another book', async () => {
    const switched = await runColdStart('reader-0', '/reader?ids=clickedBook');

    expect(switched).not.toHaveBeenCalled();
    expect(navigateToReaderMock).not.toHaveBeenCalled();
  });

  it('does not re-open the deep-linked book in a spawned library window', async () => {
    const switched = await runColdStart('reader-1', '/library');

    expect(switched).not.toHaveBeenCalled();
    expect(navigateToReaderMock).not.toHaveBeenCalled();
  });

  it('still opens the deep-linked book in the main window that received the launch', async () => {
    await runColdStart('main', '/library');

    expect(navigateToReaderMock).toHaveBeenCalledWith(expect.anything(), ['linkedBook']);
  });
});

// The launch URL also comes back as a LIVE delivery: Android re-reads the sticky
// `activity.intent` and re-emits it every time the OS recreates the Activity, so
// the replay lands on `app-incoming-url` — the path that is deliberately never
// deduped. It has to be ignored without breaking the reporter's actual workflow,
// which is opening the same `readest://book/<hash>` bookmark over and over.
describe('useOpenBookLink — launch-URL replay after a resume (#6104)', () => {
  const LAUNCH_URL = 'readest://book/linkedBook';

  beforeEach(() => {
    coldStartUrls = [LAUNCH_URL];
    currentWindowLabel = 'main';
    navigateToReaderMock.mockReset();
    routerPushMock.mockReset();
    sessionStorage.clear();
    localStorage.clear();
    window.__READEST_APP_RUN_ID__ = 'run-1';
  });
  afterEach(() => {
    cleanup();
    delete window.__READEST_APP_RUN_ID__;
    vi.restoreAllMocks();
    window.history.replaceState({}, '', '/');
  });

  it('ignores the launch URL replayed as a live event during startup', async () => {
    window.history.replaceState({}, '', '/library');
    const { useOpenBookLink, eventDispatcher } = await loadHook();
    renderHook(() => useOpenBookLink());
    await flush();
    expect(navigateToReaderMock).toHaveBeenCalledTimes(1);

    navigateToReaderMock.mockReset();
    await eventDispatcher.dispatch('app-incoming-url', { urls: [LAUNCH_URL] });
    await flush();

    expect(navigateToReaderMock).not.toHaveBeenCalled();
  });

  it('still opens the book when the user taps the same bookmark later', async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    window.history.replaceState({}, '', '/library');
    const { useOpenBookLink, eventDispatcher } = await loadHook();
    renderHook(() => useOpenBookLink());
    await flush();
    expect(navigateToReaderMock).toHaveBeenCalledTimes(1);

    // Well past startup: this is the user acting on their bookmark, not a replay.
    now.mockReturnValue(start + 11_000);
    navigateToReaderMock.mockReset();
    await eventDispatcher.dispatch('app-incoming-url', { urls: [LAUNCH_URL] });
    await flush();

    expect(navigateToReaderMock).toHaveBeenCalledWith(expect.anything(), ['linkedBook']);
  });
});
