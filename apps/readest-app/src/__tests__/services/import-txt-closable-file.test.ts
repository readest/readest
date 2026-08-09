import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Book } from '@/types/book';
import type { ClosableFile } from '@/utils/file';

const mockOpen = vi.hoisted(() => vi.fn());
const mockPartialMD5 = vi.hoisted(() => vi.fn());
const mockConvert = vi.hoisted(() => vi.fn());

vi.mock('@/utils/md5', async () => {
  const actual = await vi.importActual<typeof import('@/utils/md5')>('@/utils/md5');
  return { ...actual, partialMD5: mockPartialMD5 };
});

vi.mock('@/libs/document', async () => {
  const actual = await vi.importActual<typeof import('@/libs/document')>('@/libs/document');
  class MockDocumentLoader {
    open() {
      return mockOpen();
    }
  }
  return { ...actual, DocumentLoader: MockDocumentLoader };
});

vi.mock('@/utils/txt', () => ({
  TxtToEpubConverter: class {
    convert = mockConvert;
  },
}));
vi.mock('@/utils/svg', () => ({ svg2png: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/libs/storage', () => ({
  downloadFile: vi.fn(),
  uploadFile: vi.fn(),
  deleteFile: vi.fn(),
  createProgressHandler: vi.fn(),
  batchGetDownloadUrls: vi.fn(),
}));

import { BaseAppService } from '@/services/appService';

class TestAppService extends BaseAppService {
  protected fs = {
    openFile: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    copyFile: vi.fn(),
    removeFile: vi.fn(),
    readDir: vi.fn(),
    createDir: vi.fn(),
    removeDir: vi.fn(),
    exists: vi.fn(),
    stats: vi.fn(),
    resolvePath: vi.fn(),
    getURL: vi.fn(),
    getBlobURL: vi.fn().mockResolvedValue(''),
    getImageURL: vi.fn(),
    getPrefix: vi.fn(),
  };

  protected resolvePath() {
    return { baseDir: 0, basePrefix: async () => '', fp: '', base: 'Books' as const };
  }

  async init() {}
  async setCustomRootDir() {}
  async selectDirectory() {
    return '';
  }
  async selectFiles() {
    return [];
  }
  async saveFile() {
    return false;
  }
  async saveImageToGallery() {
    return false;
  }
  async ask() {
    return false;
  }
  async openDatabase() {
    return {} as ReturnType<BaseAppService['openDatabase']>;
  }
  async createWindow() {}
  async getCacheDir() {
    return '';
  }
  async clearWebviewCache() {}
  async showNotification() {}

  getFs() {
    return this.fs;
  }
}

const TEST_METADATA = {
  title: 'Test Book',
  author: 'Test Author',
  language: 'en',
  identifier: 'txt-id-1',
};

/**
 * Folder/desktop TXT import opens a ClosableFile, then replaces `fileobj` with
 * the converted EPUB File. The finally block must still close the *source*
 * handle — otherwise every TXT import leaks the opened RemoteFile/NativeFile
 * (same cleanup contract as #5387's destroy/close finally).
 */
describe('importBook TXT ClosableFile lifecycle', () => {
  let service: TestAppService;
  let mockClose: ReturnType<typeof vi.fn>;

  const makeSourceTxt = (): ClosableFile => {
    mockClose = vi.fn(async () => undefined);
    const file = new File(['chapter one\n\nhello'], 'novel.txt', {
      type: 'text/plain',
    }) as ClosableFile;
    file.close = mockClose as ClosableFile['close'];
    file.open = (async () => file) as ClosableFile['open'];
    return file;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestAppService();
    const fs = service.getFs();
    fs.exists.mockResolvedValue(false);
    fs.createDir.mockResolvedValue(undefined);
    fs.writeFile.mockResolvedValue(undefined);
    fs.removeDir.mockResolvedValue(undefined);
    fs.readFile.mockResolvedValue('{}');
    mockPartialMD5.mockResolvedValue('hash-txt-abc');

    mockOpen.mockResolvedValue({
      book: {
        metadata: TEST_METADATA,
        getCover: vi.fn().mockResolvedValue(null),
        destroy: vi.fn(),
      },
      format: 'EPUB',
    });

    mockConvert.mockResolvedValue({
      file: new File(['epub-bytes'], 'novel.epub', { type: 'application/epub+zip' }),
      bookTitle: 'novel',
      chapterCount: 1,
      language: 'en',
    });
  });

  it('closes the source ClosableFile after a successful TXT import from a path', async () => {
    const source = makeSourceTxt();
    service.getFs().openFile.mockResolvedValue(source);
    const books: Book[] = [];

    const result = await service.importBook('/library/novel.txt', books);

    expect(result).not.toBeNull();
    expect(mockConvert).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('closes the source ClosableFile before DocumentLoader.open runs', async () => {
    const source = makeSourceTxt();
    service.getFs().openFile.mockResolvedValue(source);
    mockOpen.mockImplementation(async () => {
      expect(mockClose).toHaveBeenCalledTimes(1);
      return {
        book: {
          metadata: TEST_METADATA,
          getCover: vi.fn().mockResolvedValue(null),
          destroy: vi.fn(),
        },
        format: 'EPUB',
      };
    });

    await service.importBook('/library/novel.txt', []);
    expect(mockOpen).toHaveBeenCalledTimes(1);
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('closes the source ClosableFile when TXT conversion fails', async () => {
    const source = makeSourceTxt();
    service.getFs().openFile.mockResolvedValue(source);
    mockConvert.mockRejectedValue(new Error('No chapters detected.'));

    await expect(service.importBook('/library/novel.txt', [])).rejects.toThrow();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });
});
