import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Book } from '@/types/book';
import type { AppService, FileItem } from '@/types/system';

/**
 * #6291: on Android every byte of a backup or restore crossed the Tauri IPC
 * bridge as a JSON number array (3.9 MB/s measured on a Xiaomi 13). On Tauri
 * the bulk zip work is handed to the Rust `write_backup_zip` /
 * `extract_backup_zip` commands, which get entry names and paths only.
 */

type ZipProgress = { current: number; total: number; name: string };
type FakeEntry = {
  filename: string;
  directory: boolean;
  getData: () => Promise<Uint8Array>;
};

const mocks = vi.hoisted(() => {
  class Channel<T> {
    onmessage: ((message: T) => void) | null = null;
  }
  return {
    invoke: vi.fn(),
    Channel,
    entries: [] as FakeEntry[],
  };
});

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, Channel: mocks.Channel }));
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn() }));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => true,
  isWebAppPlatform: () => false,
}));
vi.mock('@/utils/zip', () => ({ configureZip: vi.fn() }));
vi.mock('@zip.js/zip.js', () => ({
  BlobReader: class {},
  Uint8ArrayReader: class {},
  Uint8ArrayWriter: class {},
  ZipReader: class {
    async getEntries() {
      return mocks.entries;
    }
    async close() {}
  },
}));

import { createBackupZipToFile, restoreFromBackupZip } from '@/services/backupService';

const LIVE_HASH = '1111111111111111111111111111aaaa';
const NEW_HASH = '2222222222222222222222222222bbbb';
const ORPHAN_HASH = '3333333333333333333333333333cccc';

function makeBook(overrides: Partial<Book>): Book {
  return {
    hash: LIVE_HASH,
    format: 'EPUB',
    title: 'Book',
    author: 'Author',
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

const text = (s: string) => async () => new TextEncoder().encode(s);
const entry = (filename: string, content = 'bytes'): FakeEntry => ({
  filename,
  directory: false,
  getData: text(content),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.entries = [];
});

describe('createBackupZipToFile on Tauri', () => {
  const files: FileItem[] = [
    { path: 'library.json', size: 10 },
    { path: `${LIVE_HASH}/book.epub`, size: 1000 },
    { path: `${LIVE_HASH}/cover.png`, size: 200 },
    { path: `${LIVE_HASH}/book.epub.part`, size: 500 },
  ];
  const readFile = vi.fn(async () => new ArrayBuffer(8));
  const appService = {
    loadLibraryBooks: async () => [makeBook({ hash: LIVE_HASH })],
    loadSettings: async () => ({ globalReadSettings: {} }) as never,
    resolveFilePath: async () => '/data/Books',
    readDirectory: async () => files,
    readFile,
  } as unknown as AppService;

  it('hands the native writer entry names and book paths, never the bytes', async () => {
    const progress: [number, number, string][] = [];
    mocks.invoke.mockImplementation(
      async (
        _cmd: string,
        args: { onProgress: { onmessage: ((p: ZipProgress) => void) | null } },
      ) => {
        // The writer reports every entry, JSON ones included.
        for (const [current, name] of [
          [1, 'library.json'],
          [2, 'settings.json'],
          [3, `${LIVE_HASH}/book.epub`],
          [4, `${LIVE_HASH}/cover.png`],
        ] as const) {
          args.onProgress.onmessage?.({ current, total: 4, name });
        }
      },
    );

    await createBackupZipToFile(appService, '/picked/backup.zip', {}, (c, t, n) => {
      progress.push([c, t, n]);
    });

    expect(mocks.invoke).toHaveBeenCalledOnce();
    const [cmd, args] = mocks.invoke.mock.calls[0] as [
      string,
      { dest: string; srcDir: string; entries: unknown[] },
    ];
    expect(cmd).toBe('write_backup_zip');
    expect(args.dest).toBe('/picked/backup.zip');
    expect(args.srcDir).toBe('/data/Books');
    // The stale `.part` file from an interrupted restore stays out.
    expect(args.entries).toEqual([
      { name: 'library.json', content: expect.stringContaining(LIVE_HASH) },
      { name: 'settings.json', content: expect.any(String) },
      { name: `${LIVE_HASH}/book.epub` },
      { name: `${LIVE_HASH}/cover.png` },
    ]);
    expect(readFile).not.toHaveBeenCalled();
    // Same contract as the zip.js writer: book files only, on-disk paths.
    expect(progress).toEqual([
      [1, 2, `${LIVE_HASH}/book.epub`],
      [2, 2, `${LIVE_HASH}/cover.png`],
    ]);
  });
});

describe('restoreFromBackupZip on Tauri', () => {
  const calls: string[] = [];
  const writeFile = vi.fn(async (path: string) => {
    calls.push(`write:${path}`);
  });
  const importBook = vi.fn(async (path: string) => {
    calls.push(`import:${path}`);
    return makeBook({ hash: ORPHAN_HASH, title: 'Orphan' });
  });
  const appService = {
    loadLibraryBooks: async () => [makeBook({ hash: LIVE_HASH })],
    loadSettings: async () => ({}) as never,
    saveSettings: vi.fn(),
    saveLibraryBooks: vi.fn(),
    resolveFilePath: async (path: string) => (path ? `/data/Books/${path}` : '/data/Books'),
    readFile: async () => JSON.stringify({ progress: [1, 10], updatedAt: 1 }),
    writeFile,
    exists: async () => false,
    createDir: vi.fn(),
    importBook,
  } as unknown as AppService;

  beforeEach(() => {
    calls.length = 0;
    mocks.entries = [
      entry(
        'library.json',
        JSON.stringify([makeBook({ hash: LIVE_HASH }), makeBook({ hash: NEW_HASH })]),
      ),
      entry(`${LIVE_HASH}/book.epub`),
      entry(`${LIVE_HASH}/config.json`, JSON.stringify({ progress: [5, 10], updatedAt: 2 })),
      entry(`${NEW_HASH}/book.epub`),
      entry(`${NEW_HASH}/config.json`, '{}'),
      entry(`${ORPHAN_HASH}/book.pdf`),
    ];
  });

  it('extracts the bulk entries natively, merges config.json in JS, then imports orphans', async () => {
    const progress: [number, number, string][] = [];
    mocks.invoke.mockImplementation(
      async (
        _cmd: string,
        args: { entries: string[]; onProgress: { onmessage: ((p: ZipProgress) => void) | null } },
      ) => {
        calls.push('extract');
        args.entries.forEach((name, i) => {
          args.onProgress.onmessage?.({ current: i + 1, total: args.entries.length, name });
        });
      },
    );

    const result = await restoreFromBackupZip(
      appService,
      new Blob(),
      (c, t, n) => {
        progress.push([c, t, n]);
      },
      'content://picked/zip',
    );

    expect(mocks.invoke).toHaveBeenCalledOnce();
    const [cmd, args] = mocks.invoke.mock.calls[0] as [
      string,
      { src: string; destDir: string; entries: unknown[] },
    ];
    expect(cmd).toBe('extract_backup_zip');
    expect(args.src).toBe('content://picked/zip');
    expect(args.destDir).toBe('/data/Books');
    expect(args.entries).toEqual([
      `${LIVE_HASH}/book.epub`,
      `${NEW_HASH}/book.epub`,
      `${NEW_HASH}/config.json`,
      `${ORPHAN_HASH}/book.pdf`,
    ]);
    // The existing book's config is merged in JS, not overwritten by the extractor.
    expect(writeFile).toHaveBeenCalledOnce();
    expect(writeFile).toHaveBeenCalledWith(
      `${LIVE_HASH}/config.json`,
      'Books',
      expect.stringContaining('"progress":[5,10]'),
    );
    // Merged configs land only after the books they describe are on disk,
    // and the orphan import needs its files on disk first.
    expect(calls).toEqual([
      'extract',
      `write:${LIVE_HASH}/config.json`,
      `import:/data/Books/${ORPHAN_HASH}/book.pdf`,
    ]);
    expect(result).toMatchObject({ booksAdded: 2, booksUpdated: 1 });
    // One total across the merge, the extraction and the orphan import.
    expect(progress).toEqual([
      [1, 6, `${LIVE_HASH}/config.json`],
      [2, 6, `${LIVE_HASH}/book.epub`],
      [3, 6, `${NEW_HASH}/book.epub`],
      [4, 6, `${NEW_HASH}/config.json`],
      [5, 6, `${ORPHAN_HASH}/book.pdf`],
      [6, 6, `${ORPHAN_HASH}/book.pdf`],
    ]);
  });

  it('falls back to writing through the IPC bridge when the native extractor fails', async () => {
    mocks.invoke.mockRejectedValue(new Error('extract_backup_zip not allowed'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await restoreFromBackupZip(appService, new Blob(), undefined, 'content://picked/zip');

    const written = writeFile.mock.calls.map(([path]) => path);
    expect(written).toEqual([
      `${LIVE_HASH}/book.epub`,
      `${NEW_HASH}/book.epub`,
      `${NEW_HASH}/config.json`,
      `${ORPHAN_HASH}/book.pdf`,
      `${LIVE_HASH}/config.json`,
    ]);
    expect(importBook).toHaveBeenCalledWith(
      `/data/Books/${ORPHAN_HASH}/book.pdf`,
      expect.anything(),
      { overwrite: true },
    );
  });

  it('keeps the JS path when no source location is known (web)', async () => {
    await restoreFromBackupZip(appService, new Blob());
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(writeFile).toHaveBeenCalledTimes(5);
  });
});
