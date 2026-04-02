import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock getOSPlatform before importing the service
vi.mock('@/utils/misc', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    getOSPlatform: vi.fn().mockReturnValue('macos'),
    isValidURL: (url: string) => {
      try {
        new URL(url);
        return true;
      } catch {
        return false;
      }
    },
  };
});

vi.mock('@/services/environment', () => ({
  isPWA: vi.fn().mockReturnValue(false),
}));

// Mock settingsService, bookService, etc. to avoid deep deps
vi.mock('@/services/settingsService', () => ({
  getDefaultViewSettings: vi.fn().mockReturnValue({}),
  loadSettings: vi.fn().mockResolvedValue({
    localBooksDir: '',
    migrationVersion: 99999999,
  }),
  saveSettings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/libraryService', () => ({
  loadLibraryBooks: vi.fn().mockResolvedValue([]),
  saveLibraryBooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/bookService', () => ({
  getCoverImageUrl: vi.fn().mockReturnValue(''),
  getCoverImageBlobUrl: vi.fn().mockResolvedValue(''),
  getCachedImageUrl: vi.fn().mockResolvedValue(''),
  generateCoverImageUrl: vi.fn().mockResolvedValue(''),
  updateCoverImage: vi.fn().mockResolvedValue(undefined),
  importBook: vi.fn().mockResolvedValue(null),
  exportBook: vi.fn().mockResolvedValue(false),
  refreshBookMetadata: vi.fn().mockResolvedValue(false),
  isBookAvailable: vi.fn().mockResolvedValue(false),
  getBookFileSize: vi.fn().mockResolvedValue(null),
  loadBookContent: vi.fn().mockResolvedValue({}),
  loadBookConfig: vi.fn().mockResolvedValue({}),
  fetchBookDetails: vi.fn().mockResolvedValue({}),
  saveBookConfig: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/cloudService', () => ({
  deleteBook: vi.fn().mockResolvedValue(undefined),
  uploadFileToCloud: vi.fn().mockResolvedValue(undefined),
  uploadBook: vi.fn().mockResolvedValue(undefined),
  downloadCloudFile: vi.fn().mockResolvedValue(undefined),
  downloadBookCovers: vi.fn().mockResolvedValue(undefined),
  downloadBook: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/fontService', () => ({
  importFont: vi.fn().mockResolvedValue(null),
  deleteFont: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/services/imageService', () => ({
  importImage: vi.fn().mockResolvedValue(null),
  deleteImage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/book', () => ({
  getLibraryFilename: vi.fn().mockReturnValue('library.json'),
  getLibraryBackupFilename: vi.fn().mockReturnValue('library_backup.json'),
}));

import { WebAppService } from '@/services/webAppService';
import { isPWA } from '@/services/environment';
import { getOSPlatform } from '@/utils/misc';

// Helper: resolvePath is a module-level function, extract it for direct testing
// We test through the WebAppService instance's fs.resolvePath

describe('WebAppService', () => {
  let service: WebAppService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new WebAppService();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('class properties', () => {
    test('appPlatform is web', () => {
      expect(service.appPlatform).toBe('web');
    });

    test('isMobile is false for macos', () => {
      // getOSPlatform mocked to return 'macos'
      expect(service.isMobile).toBe(false);
    });

    test('isMobile is true for android', () => {
      vi.mocked(getOSPlatform).mockReturnValue('android');
      const s = new WebAppService();
      expect(s.isMobile).toBe(true);
    });

    test('isMobile is true for ios', () => {
      vi.mocked(getOSPlatform).mockReturnValue('ios');
      const s = new WebAppService();
      expect(s.isMobile).toBe(true);
    });

    test('hasSafeAreaInset reflects isPWA', () => {
      expect(service.hasSafeAreaInset).toBe(false);
      vi.mocked(isPWA).mockReturnValue(true);
      const s = new WebAppService();
      expect(s.hasSafeAreaInset).toBe(true);
    });
  });

  describe('resolvePath', () => {
    test('resolves Data base dir', () => {
      const resolved = service.resolvePath('test.json', 'Data');
      expect(resolved.fp).toBe('Readest/test.json');
      expect(resolved.base).toBe('Data');
      expect(resolved.baseDir).toBe(0);
    });

    test('resolves Books base dir', () => {
      const resolved = service.resolvePath('mybook.epub', 'Books');
      expect(resolved.fp).toBe('Readest/Books/mybook.epub');
      expect(resolved.base).toBe('Books');
    });

    test('resolves Fonts base dir', () => {
      const resolved = service.resolvePath('myfont.ttf', 'Fonts');
      expect(resolved.fp).toBe('Readest/Fonts/myfont.ttf');
    });

    test('resolves Images base dir', () => {
      const resolved = service.resolvePath('img.png', 'Images');
      expect(resolved.fp).toBe('Readest/Images/img.png');
    });

    test('resolves None base dir as raw path', () => {
      const resolved = service.resolvePath('/absolute/path', 'None');
      expect(resolved.fp).toBe('/absolute/path');
    });

    test('resolves unknown base dir with base as prefix', () => {
      const resolved = service.resolvePath('file.txt', 'Cache');
      expect(resolved.fp).toBe('Cache/file.txt');
    });
  });

  describe('fs.getURL', () => {
    test('returns valid URL directly', () => {
      const url = service.fs.getURL('https://example.com/book.epub');
      expect(url).toBe('https://example.com/book.epub');
    });

    test('creates blob URL for non-URL string', () => {
      const url = service.fs.getURL('some-content');
      expect(url).toMatch(/^blob:/);
    });
  });

  describe('selectDirectory', () => {
    test('throws not supported error', async () => {
      await expect(service.selectDirectory()).rejects.toThrow(
        'selectDirectory is not supported in browser',
      );
    });
  });

  describe('selectFiles', () => {
    test('throws not supported error', async () => {
      await expect(service.selectFiles()).rejects.toThrow(
        'selectFiles is not supported in browser',
      );
    });
  });

  describe('setCustomRootDir', () => {
    test('is a no-op', async () => {
      // Should not throw
      await service.setCustomRootDir();
    });
  });

  describe('ask', () => {
    test('delegates to window.confirm', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
      const result = await service.ask('Delete?');
      expect(result).toBe(true);
      expect(confirmSpy).toHaveBeenCalledWith('Delete?');
    });

    test('returns false when confirm returns false', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const result = await service.ask('Sure?');
      expect(result).toBe(false);
    });
  });

  describe('saveFile', () => {
    test('creates a download link and clicks it', async () => {
      const clickSpy = vi.fn();
      const appendChildSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((node) => {
        // Intercept click
        (node as HTMLAnchorElement).click = clickSpy;
        return node;
      });
      const removeChildSpy = vi
        .spyOn(document.body, 'removeChild')
        .mockImplementation((node) => node);
      const revokeURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

      const result = await service.saveFile('book.epub', 'content', {
        mimeType: 'application/epub+zip',
      });
      expect(result).toBe(true);
      expect(appendChildSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
      expect(removeChildSpy).toHaveBeenCalled();
      expect(revokeURLSpy).toHaveBeenCalled();
    });

    test('returns false on error', async () => {
      vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        throw new Error('fail');
      });
      const result = await service.saveFile('book.epub', 'content');
      expect(result).toBe(false);
    });
  });

  describe('fs.resolvePath basePrefix', () => {
    test('basePrefix returns empty string', async () => {
      const resolved = service.fs.resolvePath('test', 'Data');
      const prefix = await resolved.basePrefix();
      expect(prefix).toBe('');
    });
  });

  describe('fs.getPrefix', () => {
    test('returns correct prefix for Books', async () => {
      const prefix = await service.fs.getPrefix('Books');
      expect(prefix).toBe('Readest/Books');
    });

    test('returns correct prefix for Data', async () => {
      const prefix = await service.fs.getPrefix('Data');
      expect(prefix).toBe('Readest');
    });

    test('returns correct prefix for empty fp with None', async () => {
      const prefix = await service.fs.getPrefix('None');
      expect(prefix).toBe('');
    });
  });
});
