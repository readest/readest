// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { createBackupZip, restoreFromBackupZip } from '@/services/backupService';
import type { Book } from '@/types/book';
import type { AppService } from '@/types/system';

/**
 * #7752: a backup can hold the library, the settings, or both, and a restore
 * takes whichever parts the zip carries.
 */

vi.mock('@/utils/zip', async () => {
  const { configure } = await import('@zip.js/zip.js');
  return {
    configureZip: async () => configure({ useWebWorkers: false, useCompressionStream: false }),
  };
});

const book = { hash: 'abc', title: 'Book', format: 'EPUB', createdAt: 1, updatedAt: 1 } as Book;

const makeAppService = (books: Book[] = [], settings: Record<string, unknown> = {}) =>
  ({
    loadLibraryBooks: vi.fn(async () => structuredClone(books)),
    saveLibraryBooks: vi.fn(async () => {}),
    loadSettings: vi.fn(async () => structuredClone(settings)),
    saveSettings: vi.fn(async () => {}),
    resolveFilePath: async () => '/data/Books',
    readDirectory: async () => [],
    exists: async () => true,
    createDir: async () => {},
  }) as unknown as AppService & {
    saveLibraryBooks: ReturnType<typeof vi.fn>;
    saveSettings: ReturnType<typeof vi.fn>;
  };

const entryNames = async (zip: ArrayBuffer) => {
  const { BlobReader, ZipReader } = await import('@zip.js/zip.js');
  const reader = new ZipReader(new BlobReader(new Blob([zip])));
  const names = (await reader.getEntries()).map((e) => e.filename);
  await reader.close();
  return names.sort();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('selective backups (#7752)', () => {
  it('leaves the library out of a settings-only backup', async () => {
    vi.spyOn(StatisticsDb, 'open').mockRejectedValue(new Error('unused'));
    const appService = makeAppService([book], { libraryColumns: 4 });
    const zip = await createBackupZip(appService, { includeLibrary: false });
    expect(await entryNames(zip)).toEqual(['settings.json']);
    expect(StatisticsDb.open).not.toHaveBeenCalled();
  });

  it('leaves the settings out of a library-only backup', async () => {
    vi.spyOn(StatisticsDb, 'open').mockRejectedValue(new Error('no statistics.db'));
    const appService = makeAppService([book], { libraryColumns: 4 });
    const zip = await createBackupZip(appService, { includeSettings: false });
    expect(await entryNames(zip)).toEqual(['library.json']);
  });

  it('restores a settings-only backup without touching the library', async () => {
    vi.spyOn(StatisticsDb, 'open').mockRejectedValue(new Error('unused'));
    const zip = await createBackupZip(makeAppService([book], { libraryColumns: 6 }), {
      includeLibrary: false,
    });

    const target = makeAppService([], { libraryColumns: 3, keepLogin: true });
    const result = await restoreFromBackupZip(target, new Blob([zip]));

    expect(result).toEqual({
      booksAdded: 0,
      booksUpdated: 0,
      libraryRestored: false,
      settingsRestored: true,
    });
    expect(target.saveLibraryBooks).not.toHaveBeenCalled();
    expect(target.saveSettings).toHaveBeenCalledWith({ libraryColumns: 6, keepLogin: true });
  });

  it('restores a library-only backup without touching the settings', async () => {
    vi.spyOn(StatisticsDb, 'open').mockRejectedValue(new Error('no statistics.db'));
    const zip = await createBackupZip(makeAppService([book], { libraryColumns: 6 }), {
      includeSettings: false,
    });

    const target = makeAppService([], { libraryColumns: 3 });
    const result = await restoreFromBackupZip(target, new Blob([zip]));

    expect(result).toEqual({
      booksAdded: 1,
      booksUpdated: 0,
      libraryRestored: true,
      settingsRestored: false,
    });
    expect(target.saveLibraryBooks).toHaveBeenCalledWith([book]);
    expect(target.saveSettings).not.toHaveBeenCalled();
  });

  it('still rejects a zip that is not a backup', async () => {
    const { BlobWriter, TextReader, ZipWriter } = await import('@zip.js/zip.js');
    const blobWriter = new BlobWriter('application/zip');
    const writer = new ZipWriter(blobWriter);
    await writer.add('notes.txt', new TextReader('hello'));
    await writer.close();
    await expect(
      restoreFromBackupZip(makeAppService(), await blobWriter.getData()),
    ).rejects.toThrow('Invalid backup file');
  });
});
