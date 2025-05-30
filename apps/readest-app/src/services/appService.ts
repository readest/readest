import { AppPlatform, AppService, OsPlatform } from '@/types/system';

import { SystemSettings } from '@/types/settings';
import { FileSystem, BaseDir } from '@/types/system';
import { Book, BookConfig, BookContent, BookFormat } from '@/types/book';
import {
  getDir,
  getLocalBookFilename,
  getRemoteBookFilename,
  getBaseFilename,
  getCoverFilename,
  getConfigFilename,
  getLibraryFilename,
  INIT_BOOK_CONFIG,
  formatTitle,
  formatAuthors,
  getFilename,
  getPrimaryLanguage,
} from '@/utils/book';
import { partialMD5 } from '@/utils/md5';
import { BookDoc, DocumentLoader } from '@/libs/document';
import {
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_FONT,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_READSETTINGS,
  SYSTEM_SETTINGS_VERSION,
  DEFAULT_BOOK_SEARCH_CONFIG,
  DEFAULT_TTS_CONFIG,
  CLOUD_BOOKS_SUBDIR,
  DEFAULT_MOBILE_VIEW_SETTINGS,
  DEFAULT_SYSTEM_SETTINGS,
  DEFAULT_CJK_VIEW_SETTINGS,
  DEFAULT_MOBILE_READSETTINGS,
  DEFAULT_SCREEN_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
} from './constants';
import { getOSPlatform, getTargetLang, isCJKEnv, isContentURI, isValidURL } from '@/utils/misc';
import { deserializeConfig, serializeConfig } from '@/utils/serializer';
import { downloadFile, uploadFile, deleteFile, createProgressHandler } from '@/libs/storage';
import { ClosableFile } from '@/utils/file';
import { ProgressHandler } from '@/utils/transfer';
import { TxtToEpubConverter } from '@/utils/txt';
import { BOOK_FILE_NOT_FOUND_ERROR } from './errors';

export abstract class BaseAppService implements AppService {
  osPlatform: OsPlatform = getOSPlatform();
  appPlatform: AppPlatform = 'tauri';
  localBooksDir = '';
  isMobile = false;
  isMacOSApp = false;
  isLinuxApp = false;
  isAppDataSandbox = false;
  isAndroidApp = false;
  isIOSApp = false;
  isMobileApp = false;
  hasTrafficLight = false;
  hasWindow = false;
  hasWindowBar = false;
  hasContextMenu = false;
  hasRoundedWindow = false;
  hasSafeAreaInset = false;
  hasHaptics = false;
  hasUpdater = false;

  abstract fs: FileSystem;

  abstract resolvePath(fp: string, base: BaseDir): { baseDir: number; base: BaseDir; fp: string };
  abstract getCoverImageUrl(book: Book): string;
  abstract getCoverImageBlobUrl(book: Book): Promise<string>;
  abstract getInitBooksDir(): Promise<string>;
  abstract getCacheDir(): Promise<string>;
  abstract selectDirectory(): Promise<string>;
  abstract selectFiles(name: string, extensions: string[]): Promise<string[]>;

  async loadSettings(): Promise<SystemSettings> {
    let settings: SystemSettings;
    const { fp, base } = this.resolvePath('settings.json', 'Settings');

    try {
      await this.fs.exists(fp, base);
      const txt = await this.fs.readFile(fp, base, 'text');
      settings = JSON.parse(txt as string);
      const version = settings.version ?? 0;
      if (this.isAppDataSandbox || version < SYSTEM_SETTINGS_VERSION) {
        settings.localBooksDir = await this.getInitBooksDir();
        settings.version = SYSTEM_SETTINGS_VERSION;
      }
      settings = { ...DEFAULT_SYSTEM_SETTINGS, ...settings };
      settings.globalReadSettings = { ...DEFAULT_READSETTINGS, ...settings.globalReadSettings };
      settings.globalViewSettings = {
        ...DEFAULT_BOOK_LAYOUT,
        ...DEFAULT_BOOK_STYLE,
        ...DEFAULT_BOOK_FONT,
        ...(this.isMobile ? DEFAULT_MOBILE_VIEW_SETTINGS : {}),
        ...(isCJKEnv() ? DEFAULT_CJK_VIEW_SETTINGS : {}),
        ...DEFAULT_VIEW_CONFIG,
        ...DEFAULT_TTS_CONFIG,
        ...DEFAULT_SCREEN_CONFIG,
        ...{ ...DEFAULT_TRANSLATOR_CONFIG, translateTargetLang: getTargetLang() },
        ...settings.globalViewSettings,
      };
    } catch {
      settings = {
        ...DEFAULT_SYSTEM_SETTINGS,
        version: SYSTEM_SETTINGS_VERSION,
        localBooksDir: await this.getInitBooksDir(),
        globalReadSettings: {
          ...DEFAULT_READSETTINGS,
          ...(this.isMobile ? DEFAULT_MOBILE_READSETTINGS : {}),
        },
        globalViewSettings: {
          ...DEFAULT_BOOK_LAYOUT,
          ...DEFAULT_BOOK_STYLE,
          ...DEFAULT_BOOK_FONT,
          ...(this.isMobile ? DEFAULT_MOBILE_VIEW_SETTINGS : {}),
          ...(isCJKEnv() ? DEFAULT_CJK_VIEW_SETTINGS : {}),
          ...DEFAULT_VIEW_CONFIG,
          ...DEFAULT_TTS_CONFIG,
          ...DEFAULT_SCREEN_CONFIG,
          ...{ ...DEFAULT_TRANSLATOR_CONFIG, translateTargetLang: getTargetLang() },
        },
      } as SystemSettings;

      await this.fs.createDir('', 'Books', true);
      await this.fs.createDir('', base, true);
      await this.fs.writeFile(fp, base, JSON.stringify(settings));
    }

    this.localBooksDir = settings.localBooksDir;
    const cacheDir = await this.getCacheDir();
    this.fs.getPrefix = (baseDir: BaseDir) => {
      if (baseDir === 'Books') {
        return this.localBooksDir;
      } else if (baseDir === 'Cache') {
        return cacheDir;
      }
      return null;
    };
    return settings;
  }

  async saveSettings(settings: SystemSettings): Promise<void> {
    const { fp, base } = this.resolvePath('settings.json', 'Settings');
    await this.fs.createDir('', base, true);
    await this.fs.writeFile(fp, base, JSON.stringify(settings));
  }

  async importBook(
    // file might be:
    // 1.1 absolute path for local file on Desktop
    // 1.2 /private/var inbox file path on iOS
    // 2. remote url
    // 3. content provider uri
    // 4. File object from browsers
    file: string | File,
    books: Book[],
    saveBook: boolean = true,
    saveCover: boolean = true,
    overwrite: boolean = false,
    transient: boolean = false,
  ): Promise<Book | null> {
    try {
      let loadedBook: BookDoc;
      let format: BookFormat;
      let filename: string;
      let fileobj: File;

      if (transient && typeof file !== 'string') {
        throw new Error('Transient import is only supported for file paths');
      }

      try {
        if (typeof file === 'string') {
          fileobj = await this.fs.openFile(file, 'None');
          filename = fileobj.name || getFilename(file);
        } else {
          fileobj = file;
          filename = file.name;
        }
        if (filename.endsWith('.txt')) {
          const txt2epub = new TxtToEpubConverter();
          ({ file: fileobj } = await txt2epub.convert({ file: fileobj }));
        }
        ({ book: loadedBook, format } = await new DocumentLoader(fileobj).open());
        if (!loadedBook.metadata.title) {
          loadedBook.metadata.title = getBaseFilename(filename);
        }
      } catch (error) {
        console.error(error);
        throw new Error(`Failed to open the book: ${(error as Error).message || error}`);
      }

      const hash = await partialMD5(fileobj);
      const existingBook = books.filter((b) => b.hash === hash)[0];
      if (existingBook) {
        if (!transient) {
          existingBook.deletedAt = null;
        }
        existingBook.createdAt = Date.now();
        existingBook.updatedAt = Date.now();
      }

      const book: Book = {
        hash,
        format,
        title: formatTitle(loadedBook.metadata.title),
        author: formatAuthors(loadedBook.metadata.author, loadedBook.metadata.language),
        primaryLanguage: getPrimaryLanguage(loadedBook.metadata.language),
        createdAt: existingBook ? existingBook.createdAt : Date.now(),
        uploadedAt: existingBook ? existingBook.uploadedAt : null,
        deletedAt: transient ? Date.now() : null,
        downloadedAt: Date.now(),
        updatedAt: Date.now(),
      };
      // update book metadata when reimporting the same book
      if (existingBook) {
        existingBook.title = book.title;
        existingBook.author = book.author;
        existingBook.primaryLanguage = existingBook.primaryLanguage ?? book.primaryLanguage;
      }

      if (!(await this.fs.exists(getDir(book), 'Books'))) {
        await this.fs.createDir(getDir(book), 'Books');
      }
      if (
        saveBook &&
        !transient &&
        (!(await this.fs.exists(getLocalBookFilename(book), 'Books')) || overwrite)
      ) {
        if (filename.endsWith('.txt')) {
          await this.fs.writeFile(getLocalBookFilename(book), 'Books', fileobj);
        } else if (typeof file === 'string' && isContentURI(file)) {
          await this.fs.copyFile(file, getLocalBookFilename(book), 'Books');
        } else if (typeof file === 'string' && !isValidURL(file)) {
          await this.fs.copyFile(file, getLocalBookFilename(book), 'Books');
        } else {
          await this.fs.writeFile(getLocalBookFilename(book), 'Books', fileobj);
        }
      }
      if (saveCover && (!(await this.fs.exists(getCoverFilename(book), 'Books')) || overwrite)) {
        const cover = await loadedBook.getCover();
        if (cover) {
          await this.fs.writeFile(getCoverFilename(book), 'Books', await cover.arrayBuffer());
        }
      }
      // Never overwrite the config file only when it's not existed
      if (!existingBook) {
        await this.saveBookConfig(book, INIT_BOOK_CONFIG);
        books.splice(0, 0, book);
      }

      // update file links with url or path or content uri
      if (typeof file === 'string') {
        if (isValidURL(file)) {
          book.url = file;
          if (existingBook) existingBook.url = file;
        }
        if (transient) {
          book.filePath = file;
          if (existingBook) existingBook.filePath = file;
        }
      }
      book.coverImageUrl = await this.generateCoverImageUrl(book);
      const f = file as ClosableFile;
      if (f && f.close) {
        await f.close();
      }

      return book;
    } catch (error) {
      throw error;
    }
  }

  async deleteBook(book: Book, includingUploaded = false): Promise<void> {
    const fps = [getRemoteBookFilename(book), getCoverFilename(book)];
    const localDeleteFps = [getLocalBookFilename(book), getCoverFilename(book)];
    for (const fp of localDeleteFps) {
      if (await this.fs.exists(fp, 'Books')) {
        await this.fs.removeFile(fp, 'Books');
      }
    }
    for (const fp of fps) {
      if (includingUploaded) {
        console.log('Deleting uploaded file:', fp);
        const cfp = `${CLOUD_BOOKS_SUBDIR}/${fp}`;
        try {
          deleteFile(cfp);
        } catch (error) {
          console.log('Failed to delete uploaded file:', error);
        }
      }
    }
    book.deletedAt = Date.now();
    book.downloadedAt = null;
    if (includingUploaded) {
      book.uploadedAt = null;
    }
  }

  async uploadFileToCloud(lfp: string, cfp: string, handleProgress: ProgressHandler, hash: string) {
    console.log('Uploading file:', lfp, 'to', cfp);
    const file = await this.fs.openFile(lfp, 'Books', cfp);
    const localFullpath = `${this.localBooksDir}/${lfp}`;
    await uploadFile(file, localFullpath, handleProgress, hash);
    const f = file as ClosableFile;
    if (f && f.close) {
      await f.close();
    }
  }

  async uploadBook(book: Book, onProgress?: ProgressHandler): Promise<void> {
    let uploaded = false;
    const completedFiles = { count: 0 };
    let toUploadFpCount = 0;
    const coverExist = await this.fs.exists(getCoverFilename(book), 'Books');
    let bookFileExist = await this.fs.exists(getLocalBookFilename(book), 'Books');
    if (coverExist) {
      toUploadFpCount++;
    }
    if (bookFileExist) {
      toUploadFpCount++;
    }
    if (!bookFileExist && book.url) {
      // download the book from the URL
      const fileobj = await this.fs.openFile(book.url, 'None');
      await this.fs.writeFile(getLocalBookFilename(book), 'Books', await fileobj.arrayBuffer());
      bookFileExist = true;
    }

    const handleProgress = createProgressHandler(toUploadFpCount, completedFiles, onProgress);

    if (coverExist) {
      const lfp = getCoverFilename(book);
      const cfp = `${CLOUD_BOOKS_SUBDIR}/${getCoverFilename(book)}`;
      await this.uploadFileToCloud(lfp, cfp, handleProgress, book.hash);
      uploaded = true;
      completedFiles.count++;
    }

    if (bookFileExist) {
      const lfp = getLocalBookFilename(book);
      const cfp = `${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`;
      await this.uploadFileToCloud(lfp, cfp, handleProgress, book.hash);
      uploaded = true;
      completedFiles.count++;
    }

    if (uploaded) {
      book.deletedAt = null;
      book.updatedAt = Date.now();
      book.uploadedAt = Date.now();
      book.downloadedAt = Date.now();
    } else {
      throw new Error('Book file not uploaded');
    }
  }

  async downloadCloudFile(lfp: string, cfp: string, handleProgress: ProgressHandler) {
    console.log('Downloading file:', cfp, 'to', lfp);
    const localFullpath = `${this.localBooksDir}/${lfp}`;
    const result = await downloadFile(cfp, localFullpath, handleProgress);
    try {
      if (this.appPlatform === 'web') {
        const fileobj = result as Blob;
        await this.fs.writeFile(lfp, 'Books', await fileobj.arrayBuffer());
      }
    } catch {
      console.log('Failed to download file:', cfp);
      throw new Error('Failed to download file');
    }
  }

  async downloadBook(book: Book, onlyCover = false, onProgress?: ProgressHandler): Promise<void> {
    let bookDownloaded = false;
    const completedFiles = { count: 0 };
    let toDownloadFpCount = 0;
    const needDownCover = !(await this.fs.exists(getCoverFilename(book), 'Books'));
    const needDownBook = !onlyCover && !(await this.fs.exists(getLocalBookFilename(book), 'Books'));
    if (needDownCover) {
      toDownloadFpCount++;
    }
    if (needDownBook) {
      toDownloadFpCount++;
    }

    const handleProgress = createProgressHandler(toDownloadFpCount, completedFiles, onProgress);

    if (!(await this.fs.exists(getDir(book), 'Books'))) {
      await this.fs.createDir(getDir(book), 'Books');
    }

    try {
      if (needDownCover) {
        const lfp = getCoverFilename(book);
        const cfp = `${CLOUD_BOOKS_SUBDIR}/${lfp}`;
        await this.downloadCloudFile(lfp, cfp, handleProgress);
        completedFiles.count++;
      }
    } catch (error) {
      // don't throw error here since some books may not have cover images at all
      console.log(`Failed to download cover file for book: '${book.title}'`, error);
    }

    if (needDownBook) {
      const lfp = getLocalBookFilename(book);
      const cfp = `${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`;
      await this.downloadCloudFile(lfp, cfp, handleProgress);
      const localFullpath = `${this.localBooksDir}/${lfp}`;
      bookDownloaded = await this.fs.exists(localFullpath, 'Books');
      completedFiles.count++;
    }
    // some books may not have cover image, so we need to check if the book is downloaded
    if (bookDownloaded || (!onlyCover && !needDownBook)) {
      book.downloadedAt = Date.now();
    }
  }

  async isBookAvailable(book: Book): Promise<boolean> {
    const fp = getLocalBookFilename(book);
    if (await this.fs.exists(fp, 'Books')) {
      return true;
    }
    if (book.filePath) {
      return await this.fs.exists(book.filePath, 'None');
    }
    if (book.url) {
      return isValidURL(book.url);
    }
    return false;
  }

  async getBookFileSize(book: Book): Promise<number | null> {
    const fp = getLocalBookFilename(book);
    if (await this.fs.exists(fp, 'Books')) {
      const file = await this.fs.openFile(fp, 'Books');
      const size = file.size;
      const f = file as ClosableFile;
      if (f && f.close) {
        await f.close();
      }
      return size;
    }
    return null;
  }

  async loadBookContent(book: Book, settings: SystemSettings): Promise<BookContent> {
    let file: File;
    const fp = getLocalBookFilename(book);
    if (await this.fs.exists(fp, 'Books')) {
      file = await this.fs.openFile(fp, 'Books');
    } else if (book.filePath) {
      file = await this.fs.openFile(book.filePath, 'None');
    } else if (book.url) {
      file = await this.fs.openFile(book.url, 'None');
    } else {
      throw new Error(BOOK_FILE_NOT_FOUND_ERROR);
    }
    return { book, file, config: await this.loadBookConfig(book, settings) };
  }

  async loadBookConfig(book: Book, settings: SystemSettings): Promise<BookConfig> {
    const { globalViewSettings } = settings;
    try {
      let str = '{}';
      if (await this.fs.exists(getConfigFilename(book), 'Books')) {
        str = (await this.fs.readFile(getConfigFilename(book), 'Books', 'text')) as string;
      }
      return deserializeConfig(str, globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
    } catch {
      return deserializeConfig('{}', globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
    }
  }

  async fetchBookDetails(book: Book, settings: SystemSettings) {
    const fp = getLocalBookFilename(book);
    if (!(await this.fs.exists(fp, 'Books')) && book.uploadedAt) {
      await this.downloadBook(book);
    }
    const { file } = (await this.loadBookContent(book, settings)) as BookContent;
    const bookDoc = (await new DocumentLoader(file).open()).book as BookDoc;
    const f = file as ClosableFile;
    if (f && f.close) {
      await f.close();
    }
    return bookDoc.metadata;
  }

  async saveBookConfig(book: Book, config: BookConfig, settings?: SystemSettings) {
    let serializedConfig: string;
    if (settings) {
      const { globalViewSettings } = settings;
      serializedConfig = serializeConfig(config, globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG);
    } else {
      serializedConfig = JSON.stringify(config);
    }
    await this.fs.writeFile(getConfigFilename(book), 'Books', serializedConfig);
  }

  async generateCoverImageUrl(book: Book): Promise<string> {
    return this.appPlatform === 'web'
      ? await this.getCoverImageBlobUrl(book)
      : this.getCoverImageUrl(book);
  }

  async loadLibraryBooks(): Promise<Book[]> {
    console.log('Loading library books...');
    let books: Book[] = [];
    const libraryFilename = getLibraryFilename();

    try {
      const txt = await this.fs.readFile(libraryFilename, 'Books', 'text');
      books = JSON.parse(txt as string);
    } catch {
      await this.fs.createDir('', 'Books', true);
      await this.fs.writeFile(libraryFilename, 'Books', '[]');
    }

    await Promise.all(
      books.map(async (book) => {
        book.coverImageUrl = await this.generateCoverImageUrl(book);
        book.updatedAt ??= book.lastUpdated || Date.now();
        return book;
      }),
    );

    return books;
  }

  async saveLibraryBooks(books: Book[]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const libraryBooks = books.map(({ coverImageUrl, ...rest }) => rest);
    await this.fs.writeFile(getLibraryFilename(), 'Books', JSON.stringify(libraryBooks));
  }
}
