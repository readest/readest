import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Book } from '@/types/book';
import type { ClosableFile } from '@/utils/file';

const mockOpen = vi.hoisted(() => vi.fn());
const mockPartialMD5 = vi.hoisted(() => vi.fn());
const mockConvertDocx = vi.hoisted(() => vi.fn());

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

vi.mock('@/services/send/conversion/conversionWorker', () => ({
  convertToEpubWithWorker: mockConvertDocx,
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
import { collectKnownSourcePaths } from '@/services/bookService';

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
  identifier: 'docx-id-1',
};

/**
 * DOCX/RTF import converts the source to EPUB via the send-conversion worker
 * before the pipeline opens it. The converted EPUB — not the source document —
 * must be what DocumentLoader sees and what lands in Books/<hash>/, and the
 * source ClosableFile must be closed either way (same lifecycle contract as
 * the TXT conversion).
 */
describe('importBook DOCX/RTF conversion', () => {
  let service: TestAppService;
  let mockClose: ReturnType<typeof vi.fn>;

  const makeSourceDoc = (name = 'report.docx'): ClosableFile => {
    mockClose = vi.fn(async () => undefined);
    const file = new File(['docx-bytes'], name, {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
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
    mockPartialMD5.mockResolvedValue('hash-docx-abc');

    mockOpen.mockResolvedValue({
      book: {
        metadata: TEST_METADATA,
        getCover: vi.fn().mockResolvedValue(null),
        destroy: vi.fn(),
      },
      format: 'EPUB',
    });

    mockConvertDocx.mockResolvedValue({
      file: new File(['epub-bytes'], 'report.epub', { type: 'application/epub+zip' }),
      title: 'Test Book',
      author: 'Test Author',
    });
  });

  it('converts a DOCX via the worker and imports the resulting EPUB', async () => {
    const source = makeSourceDoc();
    service.getFs().openFile.mockResolvedValue(source);
    const books: Book[] = [];

    const result = await service.importBook('/library/report.docx', books);

    expect(result).not.toBeNull();
    expect(mockConvertDocx).toHaveBeenCalledTimes(1);
    expect(mockConvertDocx).toHaveBeenCalledWith({
      kind: 'docx',
      bytes: expect.any(ArrayBuffer),
      fileName: 'report.docx',
    });
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('stores the converted EPUB, never a copy of the source document', async () => {
    const source = makeSourceDoc();
    service.getFs().openFile.mockResolvedValue(source);

    await service.importBook('/library/report.docx', []);

    const fs = service.getFs();
    expect(fs.copyFile).not.toHaveBeenCalled();
    // The flow writes several files (book file, config, ...); the book file
    // itself must be the converted EPUB, written from memory.
    const bookWrite = fs.writeFile.mock.calls.find(([name]) => /\.epub$/.test(name));
    expect(bookWrite).toBeDefined();
    const [, baseDir] = bookWrite!;
    expect(baseDir).toBe('Books');
  });

  it('converts an RTF through the same worker path', async () => {
    const source = makeSourceDoc('notes.rtf');
    service.getFs().openFile.mockResolvedValue(source);

    const result = await service.importBook('/library/notes.rtf', []);

    expect(result).not.toBeNull();
    expect(mockConvertDocx).toHaveBeenCalledWith({
      kind: 'rtf',
      bytes: expect.any(ArrayBuffer),
      fileName: 'notes.rtf',
    });
  });

  it('rejects and still closes the source when conversion fails', async () => {
    const source = makeSourceDoc();
    service.getFs().openFile.mockResolvedValue(source);
    mockConvertDocx.mockRejectedValue(new Error('Could not parse document'));

    await expect(service.importBook('/library/report.docx', [])).rejects.toThrow();
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it('falls back to a managed copy for in-place DOCX imports', async () => {
    const source = makeSourceDoc();
    service.getFs().openFile.mockResolvedValue(source);

    // In-place binds the book to the source path, but the reader can only
    // open the converted EPUB — so an in-place docx import must be persisted
    // into Books/ instead, and the book must not carry the source path.
    const result = await service.importBook('/watched/report.docx', [], {
      inPlace: true,
    });

    expect(result).not.toBeNull();
    expect(result!.filePath).toBeUndefined();
    const fs = service.getFs();
    const bookWrite = fs.writeFile.mock.calls.find(([name]) => /\.epub$/.test(name));
    expect(bookWrite).toBeDefined();
    expect(fs.copyFile).not.toHaveBeenCalled();
  });

  it('remembers the watched source so the auto-import scan skips it next time', async () => {
    const source = makeSourceDoc();
    service.getFs().openFile.mockResolvedValue(source);

    const result = await service.importBook('/watched/report.docx', [], { inPlace: true });

    expect(collectKnownSourcePaths([result!], 'linux').has('/watched/report.docx')).toBe(true);
  });

  it('fails fast when a DOCX is opened transiently', async () => {
    const source = makeSourceDoc();
    service.getFs().openFile.mockResolvedValue(source);

    // Transient mode never persists anything, so the converted EPUB would
    // have nowhere readable to live — reject instead of returning a book
    // bound to the raw document.
    await expect(
      service.importBook('/library/report.docx', [], { transient: true }),
    ).rejects.toThrow();
    expect(mockConvertDocx).not.toHaveBeenCalled();
  });
});
