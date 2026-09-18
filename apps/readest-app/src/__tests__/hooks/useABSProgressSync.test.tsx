import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { AppService } from '@/types/system';
import type { ABSServer } from '@/types/audiobookshelf';
import type { Book, BookConfig, BookProgress } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';

const appService = {} as AppService;
// Held open by the test that turns a page while getTarget() is still awaiting.
let appServiceGate: Promise<unknown> | null = null;
const envConfig = {
  getAppService: async () => {
    if (appServiceGate) await appServiceGate;
    return appService;
  },
} as EnvConfigType;

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService, envConfig }),
}));
vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));
// absServerStore publishes replica upserts from its mutators; the store is
// seeded directly here, but the module still imports replicaPublish.
vi.mock('@/services/sync/replicaPublish', () => ({
  publishReplicaUpsert: vi.fn(),
  publishReplicaDelete: vi.fn(),
}));

const client = {
  getMe: vi.fn(),
  patchProgress: vi.fn(),
};
vi.mock('@/services/audiobookshelf/createClient', () => ({
  createAbsClient: vi.fn(() => client),
}));

import { useABSServerStore } from '@/store/absServerStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useReaderProgressStore } from '@/store/readerProgressStore';
import { eventDispatcher } from '@/utils/event';
import { useABSProgressSync } from '@/app/reader/hooks/useABSProgressSync';

const BOOK_KEY = 'hash1-0';
const LOCAL_CFI = 'epubcfi(/6/4!/4/2/2/1:0)';
const REMOTE_CFI = 'epubcfi(/6/14!/4/2/10/1:0)';

const server: ABSServer = {
  id: 's1',
  contentId: 's1',
  addedAt: 1,
  name: 'Home',
  url: 'http://abs.local',
};

const absEbook = {
  hash: 'hash1',
  format: 'ABS',
  filePath: 'abs://s1/item1',
  title: 'Little Women',
  metadata: { absMediaType: 'ebook' },
} as unknown as Book;

const view = { goTo: vi.fn(), goToFraction: vi.fn() };

const seedBook = (config: Partial<BookConfig>, book: Book = absEbook) => {
  useBookDataStore.setState({
    booksData: {
      hash1: {
        id: 'hash1',
        book,
        file: undefined,
        config: { updatedAt: 1000, ...config } as BookConfig,
      },
    } as unknown as ReturnType<typeof useBookDataStore.getState>['booksData'],
  });
};

const seedProgress = (progress: Partial<BookProgress>) => {
  useReaderProgressStore.setState({
    progresses: { [BOOK_KEY]: { location: LOCAL_CFI, fraction: 0.1, ...progress } as BookProgress },
  });
};

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

let restoreReaderStore: Partial<ReturnType<typeof useReaderStore.getState>>;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  appServiceGate = null;
  client.getMe.mockResolvedValue({ mediaProgress: [] });
  client.patchProgress.mockResolvedValue(undefined);
  useABSServerStore.setState({ servers: [server] });
  restoreReaderStore = {
    getView: useReaderStore.getState().getView,
    getViewState: useReaderStore.getState().getViewState,
  };
  useReaderStore.setState({
    getView: () => view as never,
    getViewState: () => ({ previewMode: false }) as never,
  });
  seedBook({ location: LOCAL_CFI, progress: [10, 100] });
  seedProgress({});
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  useReaderStore.setState(restoreReaderStore as never);
  useABSServerStore.setState({ servers: [] });
  useBookDataStore.setState({ booksData: {} });
  useReaderProgressStore.setState({ progresses: {} });
});

const remoteRow = (overrides: Record<string, unknown> = {}) => ({
  libraryItemId: 'item1',
  currentTime: 0,
  duration: 0,
  isFinished: false,
  lastUpdate: 5000,
  ebookLocation: REMOTE_CFI,
  ebookProgress: 0.42,
  ...overrides,
});

describe('useABSProgressSync', () => {
  it('moves the reader to the newer position stored on the server', async () => {
    client.getMe.mockResolvedValue({ mediaProgress: [remoteRow()] });
    const hint = vi.fn();
    eventDispatcher.on('hint', hint);

    renderHook(() => useABSProgressSync(BOOK_KEY));
    await settle();

    expect(client.getMe).toHaveBeenCalledTimes(1);
    expect(view.goTo).toHaveBeenCalledWith(REMOTE_CFI);
    expect(hint).toHaveBeenCalled();
    eventDispatcher.off('hint', hint);
  });

  it('leaves the reader alone when this device read more recently', async () => {
    localStorage.setItem('abs-last-played-hash1', '9000');
    client.getMe.mockResolvedValue({ mediaProgress: [remoteRow()] });

    renderHook(() => useABSProgressSync(BOOK_KEY));
    await settle();

    expect(view.goTo).not.toHaveBeenCalled();
  });

  it('pushes the reading position after the debounce', async () => {
    renderHook(() => useABSProgressSync(BOOK_KEY));
    await settle();

    seedProgress({ location: 'epubcfi(/6/8!/4/2/6/1:0)', fraction: 0.33 });
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    await settle();

    expect(client.patchProgress).toHaveBeenCalledWith('item1', {
      ebookLocation: 'epubcfi(/6/8!/4/2/6/1:0)',
      ebookProgress: 0.33,
      progress: 0.33,
    });
  });

  it('stamps this device as the latest writer when it pushes', async () => {
    renderHook(() => useABSProgressSync(BOOK_KEY));
    await settle();

    seedProgress({ location: 'epubcfi(/6/8!/4/2/6/1:0)', fraction: 0.33 });
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    await settle();

    expect(Number(localStorage.getItem('abs-last-played-hash1'))).toBeGreaterThan(0);
  });

  it('never pushes before the server position has been read', async () => {
    let releaseGetMe: (value: { mediaProgress: unknown[] }) => void = () => {};
    client.getMe.mockReturnValue(
      new Promise((resolve) => {
        releaseGetMe = resolve as typeof releaseGetMe;
      }),
    );

    renderHook(() => useABSProgressSync(BOOK_KEY));
    await settle();
    seedProgress({ location: 'epubcfi(/6/8!/4/2/6/1:0)', fraction: 0.33 });
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    await settle();

    expect(client.patchProgress).not.toHaveBeenCalled();

    await act(async () => {
      releaseGetMe({ mediaProgress: [] });
    });
    await settle();
    seedProgress({ location: 'epubcfi(/6/10!/4/2/6/1:0)', fraction: 0.4 });
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    await settle();

    expect(client.patchProgress).toHaveBeenCalledTimes(1);
  });

  it('pushes a page turned while the first pull was still in flight', async () => {
    let releaseGetMe: (value: { mediaProgress: unknown[] }) => void = () => {};
    client.getMe.mockReturnValue(
      new Promise((resolve) => {
        releaseGetMe = resolve as typeof releaseGetMe;
      }),
    );

    renderHook(() => useABSProgressSync(BOOK_KEY));
    await settle();
    // The page turn lands while the pull is still open, so the push effect
    // refuses it — and a ref flipping to "settled" re-renders nothing, so
    // without the pull scheduling it, closing here would lose the position.
    seedProgress({ location: 'epubcfi(/6/8!/4/2/6/1:0)', fraction: 0.33 });
    await settle();

    await act(async () => {
      releaseGetMe({ mediaProgress: [] });
    });
    await settle();
    await act(async () => {
      await eventDispatcher.dispatch('sync-book-progress', { bookKey: BOOK_KEY });
    });
    await settle();

    expect(client.patchProgress).toHaveBeenCalledWith('item1', {
      ebookLocation: 'epubcfi(/6/8!/4/2/6/1:0)',
      ebookProgress: 0.33,
      progress: 0.33,
    });
  });

  it('keeps a page turned during the pull instead of resuming the server position', async () => {
    // The push that would stamp this device as the newest writer is still
    // gated while the pull is open, so the remote row can look fresher than a
    // page the reader just turned to. Reading here has to win anyway.
    let releaseGetMe: (value: { mediaProgress: unknown[] }) => void = () => {};
    client.getMe.mockReturnValue(
      new Promise((resolve) => {
        releaseGetMe = resolve as typeof releaseGetMe;
      }),
    );

    renderHook(() => useABSProgressSync(BOOK_KEY));
    await settle();
    seedProgress({ location: 'epubcfi(/6/8!/4/2/6/1:0)', fraction: 0.33 });
    await settle();
    await act(async () => {
      releaseGetMe({ mediaProgress: [remoteRow()] });
    });
    await settle();

    expect(view.goTo).not.toHaveBeenCalled();
    expect(view.goToFraction).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    await settle();

    expect(client.patchProgress).toHaveBeenCalledWith('item1', {
      ebookLocation: 'epubcfi(/6/8!/4/2/6/1:0)',
      ebookProgress: 0.33,
      progress: 0.33,
    });
  });

  it('keeps a page turned while the pull is still resolving its server', async () => {
    // The pull snapshots the local position to tell later whether the reader
    // moved under it. Resolving the app service is itself awaited, so the
    // snapshot has to be taken before that, or a page turned in the meantime
    // reads back as "nothing moved" and the server position overwrites it.
    let releaseAppService: () => void = () => {};
    appServiceGate = new Promise<void>((resolve) => {
      releaseAppService = resolve;
    });
    client.getMe.mockResolvedValue({ mediaProgress: [remoteRow()] });

    renderHook(() => useABSProgressSync(BOOK_KEY));
    await settle();
    seedProgress({ location: 'epubcfi(/6/8!/4/2/6/1:0)', fraction: 0.33 });
    await settle();
    await act(async () => {
      releaseAppService();
    });
    await settle();

    expect(view.goTo).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    await settle();

    expect(client.patchProgress).toHaveBeenCalledWith('item1', {
      ebookLocation: 'epubcfi(/6/8!/4/2/6/1:0)',
      ebookProgress: 0.33,
      progress: 0.33,
    });
  });

  it('flushes the pending push when the book is closed', async () => {
    renderHook(() => useABSProgressSync(BOOK_KEY));
    await settle();

    seedProgress({ location: 'epubcfi(/6/8!/4/2/6/1:0)', fraction: 0.33 });
    await settle();
    await act(async () => {
      await eventDispatcher.dispatch('sync-book-progress', { bookKey: BOOK_KEY });
    });
    await settle();

    expect(client.patchProgress).toHaveBeenCalledTimes(1);
  });

  it('stays out of the way for books that are not ABS ebooks', async () => {
    seedBook({ location: LOCAL_CFI }, {
      hash: 'hash1',
      format: 'EPUB',
      filePath: '/books/local.epub',
      title: 'Local',
    } as unknown as Book);

    renderHook(() => useABSProgressSync(BOOK_KEY));
    await settle();
    seedProgress({ location: 'epubcfi(/6/8!/4/2/6/1:0)', fraction: 0.33 });
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(10000);
    });
    await settle();

    expect(client.getMe).not.toHaveBeenCalled();
    expect(client.patchProgress).not.toHaveBeenCalled();
  });
});
