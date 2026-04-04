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
}));

vi.mock('@/services/fontService', () => ({
  importFont: vi.fn().mockResolvedValue({ name: 'Font', path: '/f' }),
  deleteFont: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/imageService', () => ({
  importImage: vi.fn().mockResolvedValue({ id: 'img', url: '/img' }),
  deleteImage: vi.fn().mockResolvedValue(undefined),
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

import { BaseAppService } from '@/services/appService';
import * as Settings from '@/services/settingsService';
import * as BookSvc from '@/services/bookService';

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

  describe('file operations', () => {
    test('openFile delegates to fs', async () => {
      await service.openFile('test.epub', 'Books');
      expect(mockFs.openFile).toHaveBeenCalledWith('test.epub', 'Books');
    });

    test('copyFile delegates to fs', async () => {
      await service.copyFile('src.epub', 'dst.epub', 'Books');
      expect(mockFs.copyFile).toHaveBeenCalledWith('src.epub', 'dst.epub', 'Books');
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
      expect(mockFs.readDir).toHaveBeenCalledWith('dir', 'Books');
      expect(result).toEqual([{ path: 'a.txt', size: 10 }]);
    });

    test('getImageURL delegates to fs', async () => {
      const result = await service.getImageURL('/img.png');
      expect(mockFs.getImageURL).toHaveBeenCalledWith('/img.png');
      expect(result).toBe('image:url');
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

    test('saveLibraryBooks delegates', async () => {
      await service.saveLibraryBooks([]);
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
});
