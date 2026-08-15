import { describe, test, expect, vi } from 'vitest';
import type { Book } from '@/types/book';

const osTypeMock = vi.fn().mockReturnValue('macos');
const invokeMock = vi.fn<(command: string, args?: unknown) => Promise<unknown>>();
invokeMock.mockResolvedValue(undefined);
type CoverEventCallback = (event: {
  payload: { bookHash: string; coverHash: string | null; thumbnailPath: string };
}) => void;
const listenMock = vi.fn<(event: string, callback: CoverEventCallback) => Promise<() => void>>();
listenMock.mockResolvedValue(() => undefined);
const setBookCoverThumbnailMock = vi.fn();
const loadLibraryBooksMock = vi.fn(
  async (
    _fs: unknown,
    generateCoverImageUrl: (book: Record<string, unknown>) => Promise<string>,
  ) => {
    const book = {
      hash: '0123456789abcdef0123456789abcdef',
      format: 'EPUB',
      title: 'Legacy cover',
      author: 'Author',
      createdAt: 1,
      updatedAt: 2,
      coverHash: null,
      coverImageUrl: 'asset://full-size-cover.png',
    };
    book.coverImageUrl = await generateCoverImageUrl(book);
    return [book];
  },
);

vi.mock('@tauri-apps/plugin-os', () => ({
  type: () => osTypeMock(),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn().mockResolvedValue(false),
  mkdir: vi.fn().mockResolvedValue(undefined),
  readTextFile: vi.fn().mockResolvedValue(''),
  readFile: vi.fn().mockResolvedValue(new Uint8Array()),
  writeTextFile: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readDir: vi.fn().mockResolvedValue([]),
  remove: vi.fn().mockResolvedValue(undefined),
  copyFile: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn().mockResolvedValue({ size: 0 }),
  BaseDirectory: {},
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (command: string, args?: unknown) => invokeMock(command, args),
  convertFileSrc: (p: string) => `asset://${p}`,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, callback: CoverEventCallback) => listenMock(event, callback),
}));

vi.mock('@/services/libraryService', () => ({
  loadLibraryBooks: (
    fs: unknown,
    generateCoverImageUrl: (book: Record<string, unknown>) => Promise<string>,
  ) => loadLibraryBooksMock(fs, generateCoverImageUrl),
}));

vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: {
    getState: () => ({ setBookCoverThumbnail: setBookCoverThumbnailMock }),
  },
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn().mockResolvedValue(null),
  save: vi.fn().mockResolvedValue(null),
  ask: vi.fn().mockResolvedValue(true),
}));

vi.mock('@tauri-apps/api/path', () => ({
  join: (...parts: string[]) => Promise.resolve(parts.join('/')),
  basename: (p: string) => Promise.resolve(p.split('/').pop() ?? p),
  appDataDir: () => Promise.resolve('/tmp/app-data'),
  appConfigDir: () => Promise.resolve('/tmp/app-config'),
  appCacheDir: () => Promise.resolve('/tmp/app-cache'),
  appLogDir: () => Promise.resolve('/tmp/app-log'),
  tempDir: () => Promise.resolve('/tmp'),
}));

vi.mock('@/utils/bridge', () => ({
  copyURIToPath: vi.fn().mockResolvedValue({ path: '' }),
  getStorefrontRegionCode: vi.fn().mockResolvedValue({ regionCode: null }),
  hasAmbientLightSensor: vi.fn().mockResolvedValue({ available: false }),
}));

vi.mock('@/utils/file', () => ({
  NativeFile: class {},
  RemoteFile: class {},
}));

vi.mock('@/utils/files', () => ({
  copyFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/settingsService', () => ({
  getDefaultViewSettings: vi.fn().mockReturnValue({}),
  loadSettings: vi.fn().mockResolvedValue({ migrationVersion: 99999999 }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

async function loadServiceWithOS(os: 'macos' | 'windows' | 'linux' | 'ios' | 'android') {
  osTypeMock.mockReturnValue(os);
  vi.resetModules();
  const mod = await import('@/services/nativeAppService');
  return new mod.NativeAppService();
}

describe('NativeAppService cover optimization', () => {
  test('keeps original covers and only queues a visible cover on demand', async () => {
    let finishOptimization = () => {};
    invokeMock.mockClear();
    listenMock.mockClear();
    setBookCoverThumbnailMock.mockClear();
    invokeMock.mockImplementation((command: string) => {
      if (command !== 'optimize_cover_thumbnails') return Promise.resolve(undefined);
      return new Promise<void>((resolve) => {
        finishOptimization = resolve;
      });
    });

    try {
      const service = await loadServiceWithOS('ios');
      service.localBooksDir = '/tmp/books';

      const books = await service.loadLibraryBooks();

      expect(books[0]?.coverImageUrl).toBe(
        'asset:///tmp/books/0123456789abcdef0123456789abcdef/cover.png',
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(invokeMock).not.toHaveBeenCalledWith('optimize_cover_thumbnails', expect.anything());

      service.requestCoverThumbnail(books[0]!);
      service.requestCoverThumbnail(books[0]!);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(invokeMock).toHaveBeenCalledWith('optimize_cover_thumbnails', {
        booksDir: '/tmp/books',
        cacheDir: '/tmp/app-cache',
        covers: [
          {
            bookHash: '0123456789abcdef0123456789abcdef',
            coverHash: null,
          },
        ],
      });

      const coverReady = listenMock.mock.calls[0]?.[1];
      expect(coverReady).toBeDefined();
      coverReady?.({
        payload: {
          bookHash: '0123456789abcdef0123456789abcdef',
          coverHash: null,
          thumbnailPath: '',
        },
      });
      expect(setBookCoverThumbnailMock).not.toHaveBeenCalled();

      coverReady?.({
        payload: {
          bookHash: '0123456789abcdef0123456789abcdef',
          coverHash: null,
          thumbnailPath: '/tmp/app-cache/cover-thumbnails/cover.jpg',
        },
      });
      expect(setBookCoverThumbnailMock).toHaveBeenCalledWith(
        '0123456789abcdef0123456789abcdef',
        null,
        'asset:///tmp/app-cache/cover-thumbnails/cover.jpg',
      );
    } finally {
      finishOptimization();
      invokeMock.mockResolvedValue(undefined);
    }
  }, 15_000);

  test('microbatches distinct covers and retries after an interrupted IPC submission', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    invokeMock.mockClear();
    listenMock.mockClear();
    listenMock.mockResolvedValue(() => undefined);
    invokeMock.mockImplementation((command: string) => {
      if (command !== 'optimize_cover_thumbnails') return Promise.resolve(undefined);
      return Promise.reject(new Error('interrupted'));
    });

    try {
      const service = await loadServiceWithOS('ios');
      service.localBooksDir = '/tmp/books';
      const first = {
        hash: '0123456789abcdef0123456789abcdef',
        format: 'EPUB',
        title: 'First',
        author: 'Author',
        createdAt: 1,
        updatedAt: 2,
        coverHash: null,
      } as Book;
      const second = {
        ...first,
        hash: 'fedcba9876543210fedcba9876543210',
        title: 'Second',
        coverHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      };

      service.requestCoverThumbnail(first);
      service.requestCoverThumbnail(second);
      await new Promise((resolve) => setTimeout(resolve, 0));

      const optimizeCalls = invokeMock.mock.calls.filter(
        ([command]) => command === 'optimize_cover_thumbnails',
      );
      expect(optimizeCalls).toHaveLength(1);
      expect(optimizeCalls[0]?.[1]).toEqual({
        booksDir: '/tmp/books',
        cacheDir: '/tmp/app-cache',
        covers: [
          { bookHash: first.hash, coverHash: null },
          { bookHash: second.hash, coverHash: second.coverHash },
        ],
      });

      invokeMock.mockResolvedValue(undefined);
      service.requestCoverThumbnail(first);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(
        invokeMock.mock.calls.filter(([command]) => command === 'optimize_cover_thumbnails'),
      ).toHaveLength(2);
    } finally {
      warn.mockRestore();
      invokeMock.mockResolvedValue(undefined);
    }
  });

  test('retries listener setup after registration is interrupted', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    invokeMock.mockClear();
    listenMock.mockClear();
    listenMock
      .mockRejectedValueOnce(new Error('listener interrupted'))
      .mockResolvedValue(() => undefined);

    try {
      const service = await loadServiceWithOS('ios');
      service.localBooksDir = '/tmp/books';
      const book = {
        hash: '0123456789abcdef0123456789abcdef',
        format: 'EPUB',
        title: 'Retry',
        author: 'Author',
        createdAt: 1,
        updatedAt: 2,
        coverHash: null,
      } as Book;

      service.requestCoverThumbnail(book);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(invokeMock).not.toHaveBeenCalledWith('optimize_cover_thumbnails', expect.anything());

      service.requestCoverThumbnail(book);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(listenMock).toHaveBeenCalledTimes(2);
      expect(invokeMock).toHaveBeenCalledWith('optimize_cover_thumbnails', expect.anything());
    } finally {
      warn.mockRestore();
      listenMock.mockResolvedValue(() => undefined);
    }
  });
});

// Regression (#3682): the Linux window used to be created fully transparent to
// draw rounded corners (#1982). On WebKitGTK a transparent window whose web
// process is busy (e.g. during a library backup) fails to repaint damaged
// regions on interaction, so the whole window composites as transparent — the
// app "turns invisible". The window is now opaque, which means it can no longer
// present a rounded, transparent frame, so `hasRoundedWindow` must be false on
// every desktop platform.
describe('NativeAppService rounded-window capability', () => {
  test('Linux does not use a rounded (transparent) window', async () => {
    const service = await loadServiceWithOS('linux');
    expect(service.isLinuxApp).toBe(true);
    expect(service.hasRoundedWindow).toBe(false);
  });

  test('macOS does not use a rounded (transparent) window', async () => {
    const service = await loadServiceWithOS('macos');
    expect(service.hasRoundedWindow).toBe(false);
  });

  test('Windows does not use a rounded (transparent) window', async () => {
    const service = await loadServiceWithOS('windows');
    expect(service.hasRoundedWindow).toBe(false);
  });
});
