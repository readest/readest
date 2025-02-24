import { AppPlatform, AppService, ToastType } from '@/types/system';

import { SystemSettings } from '@/types/settings';
import { FileSystem, BaseDir } from '@/types/system';
import { Book, BookConfig, BookContent, BookFormat } from '@/types/book';
import {
  getDir,
  getFilename,
  getBaseFilename,
  getCoverFilename,
  getConfigFilename,
  getLibraryFilename,
  INIT_BOOK_CONFIG,
  formatTitle,
  formatAuthors,
} from '@/utils/book';
import { RemoteFile } from '@/utils/file';
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
} from './constants';
import { isWebAppPlatform } from './environment';
import { getOSPlatform, isCJKEnv, isValidURL } from '@/utils/misc';
import { deserializeConfig, serializeConfig } from '@/utils/serializer';
import { downloadFile, uploadFile, deleteFile, createProgressHandler } from '@/libs/storage';
import { ProgressHandler } from '@/utils/transfer';
import { BOOK_FILE_NOT_FOUND_ERROR } from './errors';

export abstract class BaseAppService implements AppService {
  osPlatform: string = getOSPlatform();
  localBooksDir: string = '';
  abstract fs: FileSystem;
  abstract appPlatform: AppPlatform;
  abstract isAppDataSandbox: boolean;
  abstract isMobile: boolean;
  abstract isAndroidApp: boolean;
  abstract isIOSApp: boolean;
  abstract hasTrafficLight: boolean;
  abstract hasWindowBar: boolean;
  abstract hasContextMenu: boolean;
  abstract hasRoundedWindow: boolean;
  abstract hasSafeAreaInset: boolean;
  abstract hasHaptics: boolean;

  abstract resolvePath(fp: string, base: BaseDir): { baseDir: number; base: BaseDir; fp: string };
  abstract getCoverImageUrl(book: Book): string;
  abstract getCoverImageBlobUrl(book: Book): Promise<string>;
  abstract getInitBooksDir(): Promise<string>;
  abstract selectFiles(name: string, extensions: string[]): Promise<string[]>;
  abstract showMessage(
    msg: string,
    kind?: ToastType,
    title?: string,
    okLabel?: string,
  ): Promise<void>;

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
        ...settings.globalViewSettings,
      };
    } catch {
      settings = {
        ...DEFAULT_SYSTEM_SETTINGS,
        version: SYSTEM_SETTINGS_VERSION,
        localBooksDir: await this.getInitBooksDir(),
        globalReadSettings: DEFAULT_READSETTINGS,
        globalViewSettings: {
          ...DEFAULT_BOOK_LAYOUT,
          ...DEFAULT_BOOK_STYLE,
          ...DEFAULT_BOOK_FONT,
          ...(this.isMobile ? DEFAULT_MOBILE_VIEW_SETTINGS : {}),
          ...(isCJKEnv() ? DEFAULT_CJK_VIEW_SETTINGS : {}),
          ...DEFAULT_VIEW_CONFIG,
          ...DEFAULT_TTS_CONFIG,
        },
      } as SystemSettings;

      await this.fs.createDir('', 'Books', true);
      await this.fs.createDir('', base, true);
      await this.fs.writeFile(fp, base, JSON.stringify(settings));
    }

    this.localBooksDir = settings.localBooksDir;
    return settings;
  }

  async saveSettings(settings: SystemSettings): Promise<void> {
    const { fp, base } = this.resolvePath('settings.json', 'Settings');
    await this.fs.createDir('', base, true);
    await this.fs.writeFile(fp, base, JSON.stringify(settings));
  }

  async importBook(
    file: string | File,
    books: Book[],
    saveBook: boolean = true,
    saveCover: boolean = true,
    overwrite: boolean = false,
  ): Promise<Book | null> {
    try {
      let loadedBook: BookDoc;
      let format: BookFormat;
      let filename: string;
      let fileobj: File;

      try {
        if (typeof file === 'string') {
          filename = file;
          fileobj = await new RemoteFile(this.fs.getURL(file), file).open();
        } else {
          filename = file.name;
          fileobj = file;
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
        if (existingBook.deletedAt) {
          existingBook.deletedAt = null;
        }
        existingBook.updatedAt = Date.now();
      }

      const book: Book = {
        hash,
        format,
        title: formatTitle(loadedBook.metadata.title),
        author: formatAuthors(loadedBook.metadata.author, loadedBook.metadata.language),
        createdAt: existingBook ? existingBook.createdAt : Date.now(),
        uploadedAt: existingBook ? existingBook.uploadedAt : null,
        downloadedAt: Date.now(),
        updatedAt: Date.now(),
      };
      if (!(await this.fs.exists(getDir(book), 'Books'))) {
        await this.fs.createDir(getDir(book), 'Books');
      }
      if (saveBook && (!(await this.fs.exists(getFilename(book), 'Books')) || overwrite)) {
        if (typeof file === 'string' && !isValidURL(file)) {
          await this.fs.copyFile(file, getFilename(book), 'Books');
        } else {
          await this.fs.writeFile(getFilename(book), 'Books', await fileobj.arrayBuffer());
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

      if (typeof file === 'string' && isValidURL(file)) {
        book.url = file;
      }
      book.coverImageUrl = await this.generateCoverImageUrl(book);

      return book;
    } catch (error) {
      throw error;
    }
  }

  async deleteBook(book: Book, includingUploaded = false): Promise<void> {
    const fps = [getFilename(book), getCoverFilename(book)];
    const localDeleteFps = (
      await Promise.all(fps.map(async (fp) => ((await this.fs.exists(fp, 'Books')) ? fp : null)))
    ).filter(Boolean) as string[];
    for (const fp of localDeleteFps) {
      await this.fs.removeFile(fp, 'Books');
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

  async uploadBook(book: Book, onProgress?: ProgressHandler): Promise<void> {
    let file: File;
    let uploaded = false;
    const completedFiles = { count: 0 };
    const fps = (
      await Promise.all(
        [getCoverFilename(book), getFilename(book)].map(async (fp) =>
          (await this.fs.exists(fp, 'Books')) ? fp : null,
        ),
      )
    ).filter(Boolean) as string[];
    if (!fps.includes(getFilename(book)) && book.url) {
      // download the book from the URL
      const fileobj = await new RemoteFile(book.url).open();
      await this.fs.writeFile(getFilename(book), 'Books', await fileobj.arrayBuffer());
      fps.push(getFilename(book));
    }
    const handleProgress = createProgressHandler(fps.length, completedFiles, onProgress);
    for (const fp of fps) {
      const cfp = `${CLOUD_BOOKS_SUBDIR}/${fp}`;
      const fullpath = `${this.localBooksDir}/${fp}`;
      if (this.appPlatform === 'web') {
        const content = await this.fs.readFile(fp, 'Books', 'binary');
        file = new File([content], cfp);
      } else {
        file = await new RemoteFile(this.fs.getURL(`${this.localBooksDir}/${fp}`), cfp).open();
      }
      console.log('Uploading file:', fp);
      await uploadFile(file, fullpath, handleProgress, book.hash);
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

  async downloadBook(book: Book, onlyCover = false, onProgress?: ProgressHandler): Promise<void> {
    const fps = onlyCover ? [getCoverFilename(book)] : [getCoverFilename(book), getFilename(book)];

    let bookDownloaded = false;
    const completedFiles = { count: 0 };
    const toDownloadFps = (
      await Promise.all(
        [getFilename(book), getCoverFilename(book)].map(async (fp) =>
          (await this.fs.exists(fp, 'Books')) ? null : fp,
        ),
      )
    ).filter(Boolean) as string[];
    const handleProgress = createProgressHandler(toDownloadFps.length, completedFiles, onProgress);
    for (const fp of fps) {
      let downloaded = false;
      const existed = !toDownloadFps.includes(fp);
      if (existed) {
        downloaded = true;
      } else {
        console.log('Downloading file:', fp);
        const cfp = `${CLOUD_BOOKS_SUBDIR}/${fp}`;
        const fullpath = `${this.localBooksDir}/${fp}`;
        if (!(await this.fs.exists(getDir(book), 'Books'))) {
          await this.fs.createDir(getDir(book), 'Books');
        }
        try {
          const result = await downloadFile(cfp, fullpath, handleProgress);
          if (isWebAppPlatform()) {
            const fileobj = result as Blob;
            await this.fs.writeFile(fp, 'Books', await fileobj.arrayBuffer());
            downloaded = true;
          } else {
            downloaded = await this.fs.exists(fp, 'Books');
          }
        } catch {
          if (fp === getCoverFilename(book)) {
            console.log('Failed to download cover image:', fp);
          } else {
            throw new Error('Failed to download book file');
          }
        }
        completedFiles.count++;
      }
      if (fp === getFilename(book)) {
        bookDownloaded = downloaded;
      }
    }
    // some books may not have cover image, so we need to check if the book is downloaded
    if (bookDownloaded) {
      book.downloadedAt = Date.now();
    }
  }

  async loadBookContent(book: Book, settings: SystemSettings): Promise<BookContent> {
    let file: File;
    const fp = getFilename(book);
    if (await this.fs.exists(fp, 'Books')) {
      // TODO: fix random access for android
      if (this.appPlatform === 'web' || getOSPlatform() === 'android') {
        const content = await this.fs.readFile(fp, 'Books', 'binary');
        file = new File([content], fp);
      } else {
        file = await new RemoteFile(this.fs.getURL(`${this.localBooksDir}/${fp}`), fp).open();
      }
    } else if (book.url) {
      file = await new RemoteFile(book.url).open();
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
    const fp = getFilename(book);
    if (!(await this.fs.exists(fp, 'Books')) && book.uploadedAt) {
      await this.downloadBook(book);
    }
    const { file } = (await this.loadBookContent(book, settings)) as BookContent;
    const bookDoc = (await new DocumentLoader(file).open()).book as BookDoc;
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
