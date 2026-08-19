import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseDir, FileSystem, ResolvedPath } from '@/types/system';
import { DatabaseOpts, DatabaseService } from '@/types/database';
import { SchemaType } from '@/services/database/migrate';

// Mock all service dependencies
vi.mock('@/services/settingsService', () => ({
  getDefaultViewSettings: vi.fn().mockReturnValue({ theme: 'light' }),
  loadSettings: vi.fn().mockResolvedValue({
    localBooksDir: 'books-dir',
    migrationVersion: 99999999,
  }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/libraryService', () => ({
  loadLibraryBooks: vi.fn().mockResolvedValue([{ title: 'Book1' }]),
  saveLibraryBooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/bookService', () => ({
  getCoverImageUrl: vi.fn().mockReturnValue('cover-url'),
  getCoverImageBlobUrl: vi.fn().mockResolvedValue('blob:cover'),
  getCachedImageUrl: vi.fn().mockResolvedValue('cached:url'),
  generateCoverImageUrl: vi.fn().mockResolvedValue('generated:url'),
  updateCoverImage: vi.fn().mockResolvedValue(undefined),
  importBook: vi.fn().mockResolvedValue(null),
  exportBook: vi.fn().mockResolvedValue(true),
  refreshBookMetadata: vi.fn().mockResolvedValue(true),
  isBookAvailable: vi.fn().mockResolvedValue(true),
  getBookFileSize: vi.fn().mockResolvedValue(1024),
  loadBookContent: vi.fn().mockResolvedValue({ html: '<p>test</p>' }),
  loadBookConfig: vi.fn().mockResolvedValue({ updatedAt: 0 }),
  fetchBookDetails: vi.fn().mockResolvedValue({ title: 'Test' }),
  saveBookConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/cloudService', () => ({
  deleteBook: vi.fn().mockResolvedValue(undefined),
  uploadFileToCloud: vi.fn().mockResolvedValue('url'),
  uploadBook: vi.fn().mockResolvedValue(undefined),
  downloadCloudFile: vi.fn().mockResolvedValue(undefined),
  downloadBookCovers: vi.fn().mockResolvedValue(undefined),
  downloadBook: vi.fn().mockResolvedValue(undefined),
  downloadReplicaFileFromCloud: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/tts/ttsDownloadManager', () => ({
  ttsDownloadManager: {
    removeBook: vi.fn(),
  },
}));

vi.mock('@/services/tts/providers/bookCacheStore', () => ({
  clearBookTTSDownloads: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/tts/TTSSessionManager', () => ({
  ttsSessionManager: {
    stopBook: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/services/fontService', () => ({
  importFont: vi.fn().mockResolvedValue({ name: 'Font', path: '/f' }),
  deleteFont: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/imageService', () => ({
  importImage: vi.fn().mockResolvedValue({ id: 'img', url: '/img' }),
  deleteImage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/dictionaries/dictionaryService', () => ({
  importDictionaries: vi.fn(),
  deleteDictionary: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/dictionaries/plugins/import', () => ({
  importPluginDictionaries: vi.fn(),
}));

vi.mock('@/services/dictionaries/registry', () => ({
  evictProvider: vi.fn(),
}));

vi.mock('@/services/dictionaries/plugins/controlService', () => ({
  getDictionaryPluginControlStore: vi.fn(),
}));

vi.mock('@/utils/book', () => ({
  getLibraryFilename: vi.fn().mockReturnValue('library.json'),
  getLibraryBackupFilename: vi.fn().mockReturnValue('library_backup.json'),
}));

vi.mock('@/utils/misc', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getOSPlatform: vi.fn().mockReturnValue('macos'),
  };
});

// Keep the real isStoragePermissionError; only stub the interactive request.
vi.mock('@/utils/permission', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    requestStoragePermission: vi.fn(),
  };
});

import { BaseAppService } from '@/services/appService';
import * as Settings from '@/services/settingsService';
import * as BookSvc from '@/services/bookService';
import * as CloudSvc from '@/services/cloudService';
import * as LibrarySvc from '@/services/libraryService';
import * as DictSvc from '@/services/dictionaries/dictionaryService';
import * as PluginImport from '@/services/dictionaries/plugins/import';
import type { ImportedDictionary } from '@/services/dictionaries/types';
import { evictProvider } from '@/services/dictionaries/registry';
import { getDictionaryPluginControlStore } from '@/services/dictionaries/plugins/controlService';
import { ttsDownloadManager } from '@/services/tts/ttsDownloadManager';
import { clearBookTTSDownloads } from '@/services/tts/providers/bookCacheStore';
import { ttsSessionManager } from '@/services/tts/TTSSessionManager';
import { requestStoragePermission } from '@/utils/permission';

// Concrete test implementation of BaseAppService
class TestAppService extends BaseAppService {
  fs: FileSystem;

  constructor(fs: FileSystem) {
    super();
    this.fs = fs;
  }

  resolvePath(fp: string, base: BaseDir): ResolvedPath {
    return this.fs.resolvePath(fp, base);
  }

  async init() {
    await this.loadSettings();
  }

  async setCustomRootDir(_dir: string) {}

  async selectDirectory(): Promise<string> {
    return '/test/dir';
  }

  async selectFiles(): Promise<string[]> {
    return ['/test/file.epub'];
  }

  async saveFile(): Promise<boolean> {
    return true;
  }

  async saveImageToGallery(): Promise<boolean> {
    return true;
  }

  async ask(): Promise<boolean> {
    return true;
  }

  async openDatabase(
    _schema: SchemaType,
    _path: string,
    _base: BaseDir,
    _opts?: DatabaseOpts,
  ): Promise<DatabaseService> {
    return {} as DatabaseService;
  }
}

function createMockFs(): FileSystem {
  return {
    resolvePath: vi.fn().mockReturnValue({
      baseDir: 0,
      basePrefix: async () => '/base',
      fp: 'path',
      base: 'Books' as BaseDir,
    }),
    getURL: vi.fn().mockReturnValue('url'),
    getBlobURL: vi.fn().mockResolvedValue('blob:url'),
    getImageURL: vi.fn().mockResolvedValue('image:url'),
    openFile: vi.fn().mockResolvedValue(new File(['content'], 'test.epub')),
    copyFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue('content'),
    writeFile: vi.fn().mockResolvedValue(undefined),
    removeFile: vi.fn().mockResolvedValue(undefined),
    readDir: vi.fn().mockResolvedValue([{ path: 'a.txt', size: 10 }]),
    createDir: vi.fn().mockResolvedValue(undefined),
    removeDir: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(true),
    stats: vi.fn().mockResolvedValue({
      isFile: true,
      isDirectory: false,
      size: 100,
      mtime: null,
      atime: null,
      birthtime: null,
    }),
    getPrefix: vi.fn().mockResolvedValue('/base/books'),
  };
}

describe('BaseAppService', () => {
  let service: TestAppService;
  let mockFs: FileSystem;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs = createMockFs();
    service = new TestAppService(mockFs);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('default properties', () => {
    test('has correct default platform flags', () => {
      expect(service.appPlatform).toBe('tauri');
      expect(service.isMobile).toBe(false);
      expect(service.isMacOSApp).toBe(false);
      expect(service.isAndroidApp).toBe(false);
      expect(service.isIOSApp).toBe(false);
      expect(service.isDesktopApp).toBe(false);
      expect(service.hasTrafficLight).toBe(false);
      expect(service.hasWindow).toBe(false);
      expect(service.hasHaptics).toBe(false);
      expect(service.hasUpdater).toBe(false);
      expect(service.isEink).toBe(false);
      expect(service.localBooksDir).toBe('');
    });
  });

  describe('prepareBooksDir', () => {
    test('sets localBooksDir from fs.getPrefix', async () => {
      await service.prepareBooksDir();
      expect(mockFs.getPrefix).toHaveBeenCalledWith('Books');
      expect(service.localBooksDir).toBe('/base/books');
    });
  });

  describe('isRootDirUsable', () => {
    test('defaults to no unavailable root', () => {
      expect(service.unavailableRootDir).toBeNull();
    });

    test('reports usable without creating anything when the dir already exists', async () => {
      vi.mocked(mockFs.exists).mockResolvedValue(true);
      await expect(service.isRootDirUsable()).resolves.toBe(true);
      expect(mockFs.createDir).not.toHaveBeenCalled();
    });

    test('creates the books dir when missing and reports usable', async () => {
      vi.mocked(mockFs.exists).mockResolvedValue(false);
      await expect(service.isRootDirUsable()).resolves.toBe(true);
      expect(mockFs.createDir).toHaveBeenCalledWith('', 'Books', true);
    });

    // The macOS App Sandbox denies `file-write-create` for any path outside the
    // app container. A stale `customRootDir` therefore made the first library
    // read throw, and that rejection was never caught — the App Store build sat
    // on a blank window forever. Probing the root has to answer "no", not throw.
    test('reports unusable when the books dir cannot be created', async () => {
      vi.mocked(mockFs.exists).mockResolvedValue(false);
      vi.mocked(mockFs.createDir).mockRejectedValue(new Error('forbidden path'));
      await expect(service.isRootDirUsable()).resolves.toBe(false);
    });

    test('reports unusable when the root cannot even be probed', async () => {
      vi.mocked(mockFs.exists).mockRejectedValue(new Error('forbidden path'));
      await expect(service.isRootDirUsable()).resolves.toBe(false);
    });
  });

  describe('saveLibraryBooks storage permission (READEST-A)', () => {
    // clearAllMocks resets call history but not implementations, so restore the
    // shared saveLibraryBooks mock's default after these override it.
    afterEach(() => {
      vi.mocked(LibrarySvc.saveLibraryBooks).mockReset().mockResolvedValue(undefined);
      vi.mocked(requestStoragePermission).mockReset();
    });

    const permError = () =>
      new Error(
        'Failed to save library.json: failed to open file at path: ' +
          '/storage/emulated/0/Readest/Books/library.json.bak with error: ' +
          'Permission denied (os error 13)',
      );

    test('on Android, requests storage permission and retries once when granted', async () => {
      service.isAndroidApp = true;
      vi.mocked(LibrarySvc.saveLibraryBooks)
        .mockRejectedValueOnce(permError())
        .mockResolvedValueOnce(undefined);
      vi.mocked(requestStoragePermission).mockResolvedValue(true);

      await expect(service.saveLibraryBooks([])).resolves.toBeUndefined();
      expect(requestStoragePermission).toHaveBeenCalledTimes(1);
      expect(LibrarySvc.saveLibraryBooks).toHaveBeenCalledTimes(2);
    });

    test('on Android, does not crash when permission is denied', async () => {
      service.isAndroidApp = true;
      vi.mocked(LibrarySvc.saveLibraryBooks).mockRejectedValue(permError());
      vi.mocked(requestStoragePermission).mockResolvedValue(false);

      await expect(service.saveLibraryBooks([])).resolves.toBeUndefined();
      // No retry when the permission was declined.
      expect(LibrarySvc.saveLibraryBooks).toHaveBeenCalledTimes(1);
    });

    test('only prompts once per session across repeated failing saves', async () => {
      service.isAndroidApp = true;
      vi.mocked(LibrarySvc.saveLibraryBooks).mockRejectedValue(permError());
      vi.mocked(requestStoragePermission).mockResolvedValue(false);

      await service.saveLibraryBooks([]);
      await service.saveLibraryBooks([]);
      expect(requestStoragePermission).toHaveBeenCalledTimes(1);
    });

    test('re-throws non-permission errors', async () => {
      service.isAndroidApp = true;
      vi.mocked(LibrarySvc.saveLibraryBooks).mockRejectedValue(new Error('disk full'));

      await expect(service.saveLibraryBooks([])).rejects.toThrow('disk full');
      expect(requestStoragePermission).not.toHaveBeenCalled();
    });

    test('does not intercept on non-Android platforms', async () => {
      service.isAndroidApp = false;
      vi.mocked(LibrarySvc.saveLibraryBooks).mockRejectedValue(permError());

      await expect(service.saveLibraryBooks([])).rejects.toThrow('Permission denied');
      expect(requestStoragePermission).not.toHaveBeenCalled();
    });
  });

  describe('file operations', () => {
    test('openFile delegates to fs', async () => {
      await service.openFile('test.epub', 'Books');
      expect(mockFs.openFile).toHaveBeenCalledWith('test.epub', 'Books');
    });

    test('copyFile delegates to fs', async () => {
      await service.copyFile('src.epub', 'None', 'dst.epub', 'Books');
      expect(mockFs.copyFile).toHaveBeenCalledWith('src.epub', 'None', 'dst.epub', 'Books');
    });

    test('readFile delegates to fs', async () => {
      const result = await service.readFile('test.txt', 'Data', 'text');
      expect(mockFs.readFile).toHaveBeenCalledWith('test.txt', 'Data', 'text');
      expect(result).toBe('content');
    });

    test('writeFile delegates to fs', async () => {
      await service.writeFile('test.txt', 'Data', 'hello');
      expect(mockFs.writeFile).toHaveBeenCalledWith('test.txt', 'Data', 'hello');
    });

    test('createDir delegates to fs', async () => {
      await service.createDir('newdir', 'Books');
      expect(mockFs.createDir).toHaveBeenCalledWith('newdir', 'Books', true);
    });

    test('createDir respects recursive parameter', async () => {
      await service.createDir('newdir', 'Books', false);
      expect(mockFs.createDir).toHaveBeenCalledWith('newdir', 'Books', false);
    });

    test('deleteFile delegates to fs.removeFile', async () => {
      await service.deleteFile('old.txt', 'Data');
      expect(mockFs.removeFile).toHaveBeenCalledWith('old.txt', 'Data');
    });

    test('deleteDir delegates to fs.removeDir', async () => {
      await service.deleteDir('olddir', 'Books');
      expect(mockFs.removeDir).toHaveBeenCalledWith('olddir', 'Books', true);
    });

    test('deleteDir respects recursive parameter', async () => {
      await service.deleteDir('olddir', 'Books', false);
      expect(mockFs.removeDir).toHaveBeenCalledWith('olddir', 'Books', false);
    });

    test('exists delegates to fs', async () => {
      const result = await service.exists('test.txt', 'Data');
      expect(mockFs.exists).toHaveBeenCalledWith('test.txt', 'Data');
      expect(result).toBe(true);
    });

    test('readDirectory delegates to fs.readDir', async () => {
      const result = await service.readDirectory('dir', 'Books');
      expect(mockFs.readDir).toHaveBeenCalledWith('dir', 'Books', undefined);
      expect(result).toEqual([{ path: 'a.txt', size: 10 }]);
    });

    test('readDirectory forwards the extensions filter to fs.readDir', async () => {
      await service.readDirectory('dir', 'Books', ['epub', 'mobi']);
      expect(mockFs.readDir).toHaveBeenCalledWith('dir', 'Books', ['epub', 'mobi']);
    });

    test('getImageURL delegates to fs', async () => {
      const result = await service.getImageURL('/img.png');
      expect(mockFs.getImageURL).toHaveBeenCalledWith('/img.png');
      expect(result).toBe('image:url');
    });
  });

  describe('dictionary operations', () => {
    test('passes plugin imports and replacements into legacy duplicate detection', async () => {
      const oldPlugin = {
        id: 'old-plugin',
        kind: 'plugin',
        name: 'Old plugin',
        bundleDir: 'old-plugin-dir',
        files: { pluginSource: 'old.zip' },
        addedAt: 1,
      } as ImportedDictionary;
      const untouched = {
        id: 'untouched',
        kind: 'bgl',
        name: 'Untouched',
        bundleDir: 'untouched-dir',
        files: { bgl: 'untouched.bgl' },
        addedAt: 1,
      } as ImportedDictionary;
      const importedPlugin = {
        ...oldPlugin,
        id: 'imported-plugin',
        name: 'Imported plugin',
      };
      const replacementPlugin = {
        ...oldPlugin,
        id: 'replacement-plugin',
        name: 'Replacement plugin',
      };
      const unclaimed = [{ file: new File(['legacy'], 'legacy.bgl') }];
      const pluginImportResult = {
        imported: [importedPlugin],
        replacements: [{ oldIds: [oldPlugin.id], newDict: replacementPlugin }],
        unclaimed,
        failures: [{ name: 'broken.zip', message: 'Invalid Yomitan bank' }],
      };
      vi.mocked(PluginImport.importPluginDictionaries).mockResolvedValue(pluginImportResult);
      vi.mocked(DictSvc.importDictionaries).mockResolvedValue({
        imported: [],
        replacements: [],
        orphanFiles: [],
      });

      const result = await service.importDictionaries(unclaimed, [oldPlugin, untouched]);

      expect(DictSvc.importDictionaries).toHaveBeenCalledWith(mockFs, unclaimed, [
        untouched,
        importedPlugin,
        replacementPlugin,
      ]);
      expect(result).toMatchObject({ importErrors: pluginImportResult.failures });
    });

    test('returns committed plugin replacements when a legacy import fails', async () => {
      const oldPlugin = {
        id: 'old-plugin',
        kind: 'plugin',
        name: 'Old plugin',
        bundleDir: 'old-plugin-dir',
        files: { pluginSource: 'old.zip' },
        addedAt: 1,
      } as ImportedDictionary;
      const replacementPlugin = {
        ...oldPlugin,
        id: 'replacement-plugin',
        bundleDir: 'replacement-plugin-dir',
      };
      const legacyFile = { file: new File(['legacy'], 'legacy.bgl') };
      vi.mocked(PluginImport.importPluginDictionaries).mockResolvedValue({
        imported: [],
        replacements: [{ oldIds: [oldPlugin.id], newDict: replacementPlugin }],
        unclaimed: [legacyFile],
        failures: [],
      });
      vi.mocked(DictSvc.importDictionaries).mockRejectedValue(
        new Error('injected legacy write failure'),
      );

      await expect(service.importDictionaries([legacyFile], [oldPlugin])).resolves.toEqual({
        imported: [],
        replacements: [{ oldIds: [oldPlugin.id], newDict: replacementPlugin }],
        orphanFiles: [],
        importErrors: [{ name: 'legacy.bgl', message: 'injected legacy write failure' }],
      });
    });

    test('evicts lookup state and removes derived plugin indexes before deleting the source', async () => {
      const removeDictionary = vi.fn().mockResolvedValue(undefined);
      vi.mocked(getDictionaryPluginControlStore).mockResolvedValue({
        removeDictionary,
      } as unknown as Awaited<ReturnType<typeof getDictionaryPluginControlStore>>);
      const dict = {
        id: 'plugin-dict',
        kind: 'plugin',
        name: 'Plugin dictionary',
        bundleDir: 'plugin-dir',
        files: { pluginSource: 'source.zip' },
        addedAt: 1,
      } as ImportedDictionary;

      await service.deleteDictionary(dict);

      expect(evictProvider).toHaveBeenCalledWith(dict.id);
      expect(removeDictionary).toHaveBeenCalledWith(dict.id);
      expect(DictSvc.deleteDictionary).toHaveBeenCalledWith(mockFs, dict);
    });
  });

  describe('resolveFilePath', () => {
    test('combines prefix with path', async () => {
      const result = await service.resolveFilePath('test.json', 'Data');
      expect(result).toBe('/base/books/test.json');
    });

    test('returns just prefix when path is empty', async () => {
      const result = await service.resolveFilePath('', 'Data');
      expect(result).toBe('/base/books');
    });

    // base 'None' carries a complete, absolute source path (in-place /
    // external books point `book.filePath` outside Books/<hash>/). Its prefix
    // is empty, so the path must be returned verbatim. Prepending a separator
    // produced `/C:\Users\...` on Windows (and `//Users/...` on POSIX), which
    // the native upload guard (transfer_file.rs `ensure_path_allowed`) rejects
    // as "path not in filesystem scope" — issue #4720.
    test('returns an absolute path unchanged when the prefix is empty (base None)', async () => {
      vi.mocked(mockFs.getPrefix).mockResolvedValue('');

      const windowsPath = "C:\\Users\\me\\Documents\\books\\Alice's Adventures.epub";
      expect(await service.resolveFilePath(windowsPath, 'None')).toBe(windowsPath);

      const posixPath = '/Users/me/Documents/books/Alice.epub';
      expect(await service.resolveFilePath(posixPath, 'None')).toBe(posixPath);
    });
  });

  describe('settings', () => {
    test('loadSettings delegates and updates localBooksDir', async () => {
      const settings = await service.loadSettings();
      expect(Settings.loadSettings).toHaveBeenCalled();
      expect(settings.localBooksDir).toBe('books-dir');
      expect(service.localBooksDir).toBe('books-dir');
    });

    test('saveSettings delegates to settingsService', async () => {
      const settings = { localBooksDir: 'dir' } as Parameters<typeof service.saveSettings>[0];
      await service.saveSettings(settings);
      expect(Settings.saveSettings).toHaveBeenCalledWith(mockFs, settings);
    });

    test('getDefaultViewSettings delegates', () => {
      const result = service.getDefaultViewSettings();
      expect(Settings.getDefaultViewSettings).toHaveBeenCalled();
      expect(result).toEqual({ theme: 'light' });
    });
  });

  describe('cover image operations', () => {
    const mockBook = { hash: 'h1', title: 'Book' } as Parameters<
      typeof service.getCoverImageUrl
    >[0];

    test('getCoverImageUrl delegates', () => {
      const result = service.getCoverImageUrl(mockBook);
      expect(BookSvc.getCoverImageUrl).toHaveBeenCalled();
      expect(result).toBe('cover-url');
    });

    test('getCoverImageBlobUrl delegates', async () => {
      const result = await service.getCoverImageBlobUrl(mockBook);
      expect(BookSvc.getCoverImageBlobUrl).toHaveBeenCalled();
      expect(result).toBe('blob:cover');
    });

    test('getCachedImageUrl delegates', async () => {
      const result = await service.getCachedImageUrl('http://img.com/x.png');
      expect(BookSvc.getCachedImageUrl).toHaveBeenCalled();
      expect(result).toBe('cached:url');
    });

    test('generateCoverImageUrl delegates', async () => {
      const result = await service.generateCoverImageUrl(mockBook);
      expect(BookSvc.generateCoverImageUrl).toHaveBeenCalled();
      expect(result).toBe('generated:url');
    });
  });

  describe('library operations', () => {
    test('loadLibraryBooks delegates', async () => {
      const result = await service.loadLibraryBooks();
      expect(result).toEqual([{ title: 'Book1' }]);
    });
  });

  describe('deleteBook TTS queue lifecycle', () => {
    const book = { hash: 'book-hash', title: 'Book' } as Parameters<
      TestAppService['deleteBook']
    >[0];

    test('clears queued downloads only when the local copy is deleted', async () => {
      await service.deleteBook(book, 'cloud');
      expect(ttsDownloadManager.removeBook).not.toHaveBeenCalled();
      expect(clearBookTTSDownloads).not.toHaveBeenCalled();

      await service.deleteBook(book, 'local');
      expect(ttsDownloadManager.removeBook).toHaveBeenCalledTimes(1);
      expect(ttsDownloadManager.removeBook).toHaveBeenCalledWith('book-hash');
      expect(clearBookTTSDownloads).toHaveBeenCalledWith(service, 'book-hash');
    });

    test('does not clear queued downloads when local deletion fails', async () => {
      vi.mocked(CloudSvc.deleteBook).mockRejectedValueOnce(new Error('disk failure'));

      await expect(service.deleteBook(book, 'local')).rejects.toThrow('disk failure');
      expect(ttsDownloadManager.removeBook).not.toHaveBeenCalled();
      expect(clearBookTTSDownloads).not.toHaveBeenCalled();
    });

    test('quiesces downloads and the live session before purging the cache directory', async () => {
      let finishDownloadCancellation: () => void = () => {};
      let finishSessionStop: () => void = () => {};
      vi.mocked(ttsDownloadManager.removeBook).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishDownloadCancellation = resolve;
        }),
      );
      vi.mocked(ttsSessionManager.stopBook).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishSessionStop = resolve;
        }),
      );

      const deletion = service.deleteBook(book, 'purge');

      await vi.waitFor(() => expect(ttsDownloadManager.removeBook).toHaveBeenCalled());
      expect(ttsDownloadManager.removeBook).toHaveBeenCalledWith('book-hash');
      expect(ttsSessionManager.stopBook).not.toHaveBeenCalled();
      expect(CloudSvc.deleteBook).not.toHaveBeenCalled();

      finishDownloadCancellation();
      await vi.waitFor(() => expect(ttsSessionManager.stopBook).toHaveBeenCalled());
      expect(ttsSessionManager.stopBook).toHaveBeenCalledWith('book-hash', 'deleted');
      expect(CloudSvc.deleteBook).not.toHaveBeenCalled();

      finishSessionStop();
      await deletion;
      expect(CloudSvc.deleteBook).toHaveBeenCalled();
    });

    test('waits for active download cancellation before clearing pinned audio', async () => {
      let finishCancellation: () => void = () => {};
      vi.mocked(ttsDownloadManager.removeBook).mockReturnValueOnce(
        new Promise<void>((resolve) => {
          finishCancellation = resolve;
        }),
      );

      const deletion = service.deleteBook(book, 'local');
      await vi.waitFor(() => expect(ttsDownloadManager.removeBook).toHaveBeenCalled());
      expect(clearBookTTSDownloads).not.toHaveBeenCalled();

      finishCancellation();
      await deletion;
      expect(clearBookTTSDownloads).toHaveBeenCalledWith(service, 'book-hash');
    });
  });

  describe('runMigrations', () => {
    test('runs migration when version is lower', async () => {
      vi.mocked(mockFs.exists).mockResolvedValue(true);
      vi.mocked(mockFs.readFile).mockResolvedValue('library data');

      // Access protected method through init -> loadSettings -> runMigrations flow
      vi.mocked(Settings.loadSettings).mockResolvedValue({
        localBooksDir: 'dir',
        migrationVersion: 0,
      } as ReturnType<typeof Settings.loadSettings> extends Promise<infer T> ? T : never);

      // Create a service that calls runMigrations in init
      class MigratingService extends TestAppService {
        override async init() {
          await this.loadSettings();
          await this.runMigrations(0);
        }
      }

      const svc = new MigratingService(mockFs);
      await svc.init();

      // Migration should have checked for the old backup file
      expect(mockFs.exists).toHaveBeenCalledWith('library_backup.json', 'Books');
    });

    test('skips migration when version is current', async () => {
      class MigratingService extends TestAppService {
        override async init() {
          await this.runMigrations(99999999);
        }
      }

      const svc = new MigratingService(mockFs);
      await svc.init();

      // Should not have tried to read the backup file
      expect(mockFs.readFile).not.toHaveBeenCalledWith('library_backup.json', 'Books', 'text');
    });
  });

  // Issue #5675: the native downloader writes with `File::create`, which does
  // NOT create parent directories — a missing bundle dir surfaces as
  // "No such file or directory (os error 2)". The pull path only mints (and
  // mkdirs) a bundle dir for records it has never seen; a record whose
  // directory was lost afterwards, a transfer replayed from the persisted
  // queue, or a Retry All all reach the download with no directory. Book
  // downloads already guard this (cloudService.downloadBook), replica
  // downloads did not.
  describe('downloadReplicaFile', () => {
    test('creates the bundle directory before downloading', async () => {
      await service.downloadReplicaFile(
        'font',
        'c1',
        'Georgia.ttf',
        'v04c1uy/Georgia.ttf',
        'Fonts',
      );

      expect(mockFs.createDir).toHaveBeenCalledWith('v04c1uy', 'Fonts', true);
    });

    test('creates the directory before the download starts, not after', async () => {
      const CloudSvc = await import('@/services/cloudService');
      await service.downloadReplicaFile(
        'font',
        'c1',
        'Georgia.ttf',
        'v04c1uy/Georgia.ttf',
        'Fonts',
      );

      const mkdirOrder = (mockFs.createDir as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]!;
      const downloadOrder = (CloudSvc.downloadReplicaFileFromCloud as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0]!;
      expect(mkdirOrder).toBeLessThan(downloadOrder);
    });

    test('nested bundle paths create the full parent chain', async () => {
      await service.downloadReplicaFile(
        'dictionary',
        'd1',
        'concise.css',
        'bundle-1/assets/concise.css',
        'Dictionaries',
      );

      expect(mockFs.createDir).toHaveBeenCalledWith('bundle-1/assets', 'Dictionaries', true);
    });

    test('a flat legacy path with no bundle dir does not create a directory', async () => {
      await service.downloadReplicaFile('font', 'c1', 'Georgia.ttf', 'Georgia.ttf', 'Fonts');

      expect(mockFs.createDir).not.toHaveBeenCalled();
    });

    test('still downloads to the resolved absolute destination', async () => {
      const CloudSvc = await import('@/services/cloudService');
      await service.downloadReplicaFile(
        'font',
        'c1',
        'Georgia.ttf',
        'v04c1uy/Georgia.ttf',
        'Fonts',
      );

      expect(CloudSvc.downloadReplicaFileFromCloud).toHaveBeenCalledWith(
        service,
        expect.objectContaining({
          kind: 'font',
          replicaId: 'c1',
          filename: 'Georgia.ttf',
          dst: expect.stringContaining('v04c1uy/Georgia.ttf'),
        }),
      );
    });
  });
});
