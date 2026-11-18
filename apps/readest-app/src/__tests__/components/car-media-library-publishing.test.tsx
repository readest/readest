// @vitest-environment happy-dom
import { Profiler } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CarMediaLibraryBridge from '@/components/CarMediaLibraryBridge';
import { useAppLockStore } from '@/store/appLockStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useReaderStore } from '@/store/readerStore';
import { eventDispatcher } from '@/utils/event';

const mocks = vi.hoisted(() => ({
  platform: 'ios',
  invoke: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue({ unregister: vi.fn() }),
  resolveNativeBookFilePath: vi.fn().mockResolvedValue('/books/book.epub'),
  resolveFilePath: vi.fn().mockResolvedValue('/books/book.json'),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  addPluginListener: mocks.listen,
}));
vi.mock('@/services/environment', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/environment')>()),
  default: { name: 'env' },
  isTauriAppPlatform: () => true,
  getInitializedAppService: () => ({
    supportsCoverThumbnailOptimization: false,
    resolveNativeBookFilePath: mocks.resolveNativeBookFilePath,
    resolveFilePath: mocks.resolveFilePath,
  }),
}));
vi.mock('@/utils/misc', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/misc')>()),
  getOSPlatform: () => mocks.platform,
}));
vi.mock('@/utils/window', () => ({ isMainAppWindow: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  useAppLockStore.setState({ isInitialized: true, isUnlocked: true });
  useLibraryStore.setState({
    libraryLoaded: true,
    library: [
      {
        hash: 'book',
        title: 'Book',
        author: 'Author',
        format: 'EPUB',
        createdAt: 1,
        updatedAt: 1,
        downloadedAt: 1,
      },
    ],
    coverThumbnails: new Map(),
  });
});
afterEach(cleanup);

describe.each(['ios', 'android'])('car library on %s', (platform) => {
  it('publishes playable books and clears the persisted list when locked', async () => {
    mocks.platform = platform;
    render(<CarMediaLibraryBridge />);
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenCalledWith('plugin:native-tts|update_media_library', {
        payload: { booksJson: expect.stringContaining('"hash":"book"') },
      }),
    );
    act(() => useAppLockStore.setState({ isUnlocked: false }));
    await waitFor(() =>
      expect(mocks.invoke).toHaveBeenLastCalledWith('plugin:native-tts|update_media_library', {
        payload: { booksJson: '[]' },
      }),
    );
  });
});

describe('car library elsewhere', () => {
  // Each page turn writes the book's progress into the library. Off Android
  // and iOS there is no car to publish to, so that must not re-render the bridge.
  it.each(['macos', 'windows', 'linux'])('does not follow the library on %s', (platform) => {
    mocks.platform = platform;
    const onRender = vi.fn();
    render(
      <Profiler id='bridge' onRender={onRender}>
        <CarMediaLibraryBridge />
      </Profiler>,
    );
    onRender.mockClear();

    act(() =>
      useLibraryStore.setState({
        library: useLibraryStore.getState().library.map((book) => ({ ...book, updatedAt: 2 })),
      }),
    );

    expect(onRender).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

// CarPlay with the phone locked starts the book in Swift, because iOS suspends
// this WebView (#7566). Once the app is back on screen the reader takes over
// from where the native player saved its position.
describe('CarPlay Read Aloud takeover on iOS', () => {
  const recreateViewer = vi.fn();
  let dispatch: ReturnType<typeof vi.spyOn>;
  let visibility: DocumentVisibilityState = 'visible';

  beforeEach(() => {
    mocks.platform = 'ios';
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    dispatch = vi.spyOn(eventDispatcher, 'dispatch').mockResolvedValue(undefined);
    useReaderStore.setState({
      viewStates: { 'book-1': { key: 'book-1' }, 'other-2': { key: 'other-2' } } as never,
      recreateViewer,
    });
  });

  const takeCalls = () =>
    mocks.invoke.mock.calls.filter(
      ([command]) => command === 'plugin:native-tts|take_cold_playback',
    );

  it('reopens the book from disk and reads on when the native player was playing', async () => {
    mocks.invoke.mockImplementation(async (command: string) =>
      command === 'plugin:native-tts|take_cold_playback'
        ? { bookHash: 'book', playing: true }
        : undefined,
    );
    render(<CarMediaLibraryBridge />);
    await waitFor(() =>
      expect(dispatch).toHaveBeenCalledWith('app-incoming-url', {
        urls: ['readest://book/book?autoplay=tts'],
      }),
    );
    expect(recreateViewer).toHaveBeenCalledTimes(1);
    expect(recreateViewer).toHaveBeenCalledWith({ name: 'env' }, 'book-1');
    expect(recreateViewer.mock.invocationCallOrder[0]).toBeLessThan(
      dispatch.mock.invocationCallOrder[0]!,
    );
  });

  it('only reloads the open book when the native player was paused', async () => {
    mocks.invoke.mockImplementation(async (command: string) =>
      command === 'plugin:native-tts|take_cold_playback'
        ? { bookHash: 'book', playing: false }
        : undefined,
    );
    render(<CarMediaLibraryBridge />);
    await waitFor(() => expect(recreateViewer).toHaveBeenCalledWith({ name: 'env' }, 'book-1'));
    expect(dispatch).not.toHaveBeenCalledWith('app-incoming-url', expect.anything());
  });

  it('asks again each time the app comes back on screen, never while hidden', async () => {
    mocks.invoke.mockImplementation(async (command: string) =>
      command === 'plugin:native-tts|take_cold_playback'
        ? { bookHash: null, playing: false }
        : undefined,
    );
    visibility = 'hidden';
    render(<CarMediaLibraryBridge />);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(takeCalls()).toHaveLength(0);

    visibility = 'visible';
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await waitFor(() => expect(takeCalls()).toHaveLength(1));
    expect(recreateViewer).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalledWith('app-incoming-url', expect.anything());
  });

  it('is iOS only', async () => {
    mocks.platform = 'android';
    render(<CarMediaLibraryBridge />);
    await waitFor(() => expect(mocks.listen).toHaveBeenCalled());
    expect(takeCalls()).toHaveLength(0);
  });
});
