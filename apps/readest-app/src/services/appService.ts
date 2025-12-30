import { v4 as uuidv4 } from 'uuid';
import { SystemSettings } from '@/types/settings';
import {
  AppPlatform,
  AppService,
  DistChannel,
  FileItem,
  OsPlatform,
  ResolvedPath,
  SelectDirectoryMode,
} from '@/types/system';
import { FileSystem, BaseDir, DeleteAction } from '@/types/system';
import {
  Book,
  BookConfig,
  BookContent,
  BookFormat,
  FIXED_LAYOUT_FORMATS,
  ViewSettings,
} from '@/types/book';
import {
  getDir,
  getLocalBookFilename,
  getRemoteBookFilename,
  getCoverFilename,
  getConfigFilename,
  getLibraryFilename,
  INIT_BOOK_CONFIG,
  formatTitle,
  formatAuthors,
  getPrimaryLanguage,
  getLibraryBackupFilename,
} from '@/utils/book';
import { md5, partialMD5 } from '@/utils/md5';
import { getBaseFilename, getFilename } from '@/utils/path';
import { BookDoc, DocumentLoader, EXTS } from '@/libs/document';
import {
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LANGUAGE,
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
  DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS,
  SETTINGS_FILENAME,
  DEFAULT_MOBILE_SYSTEM_SETTINGS,
  DEFAULT_ANNOTATOR_CONFIG,
} from './constants';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { getOSPlatform, getTargetLang, isCJKEnv, isContentURI, isValidURL } from '@/utils/misc';
import { deserializeConfig, serializeConfig } from '@/utils/serializer';
import {
  downloadFile,
  uploadFile,
  deleteFile,
  createProgressHandler,
  batchGetDownloadUrls,
} from '@/libs/storage';
import { ClosableFile } from '@/utils/file';
import { ProgressHandler } from '@/utils/transfer';
import { TxtToEpubConverter } from '@/utils/txt';
import { BOOK_FILE_NOT_FOUND_ERROR } from './errors';
import { CustomTextureInfo } from '@/styles/textures';
import { CustomFont, CustomFontInfo } from '@/styles/fonts';
import { parseFontInfo } from '@/utils/font';
import { svg2png } from '@/utils/svg';

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
  isPortableApp = false;
  isDesktopApp = false;
  hasTrafficLight = false;
  hasWindow = false;
  hasWindowBar = false;
  hasContextMenu = false;
  hasRoundedWindow = false;
  hasSafeAreaInset = false;
  hasHaptics = false;
  hasUpdater = false;
  hasOrientationLock = false;
  hasScreenBrightness = false;
  hasIAP = false;
  canCustomizeRootDir = false;
  canReadExternalDir = false;
  distChannel = 'readest' as DistChannel;

  protected CURRENT_MIGRATION_VERSION = 20251124;

  protected abstract fs: FileSystem;
  protected abstract resolvePath(fp: string, base: BaseDir): ResolvedPath;

  abstract init(): Promise<void>;
  abstract setCustomRootDir(customRootDir: string): Promise<void>;
  abstract selectDirectory(mode: SelectDirectoryMode): Promise<string>;
  abstract selectFiles(name: string, extensions: string[]): Promise<string[]>;

  protected async runMigrations(lastMigrationVersion: number): Promise<void> {
    if (lastMigrationVersion < 20251124) {
      try {
        await this.migrate20251124();
      } catch (error) {
        console.error('Error migrating to version 20251124:', error);
      }
    }
  }

  async prepareBooksDir() {
    this.localBooksDir = await this.fs.getPrefix('Books');
  }

  async openFile(path: string, base: BaseDir): Promise<File> {
    return await this.fs.openFile(path, base);
  }

  async copyFile(srcPath: string, dstPath: string, base: BaseDir): Promise<void> {
    return await this.fs.copyFile(srcPath, dstPath, base);
  }

  async writeFile(path: string, base: BaseDir, content: string | ArrayBuffer | File) {
    return await this.fs.writeFile(path, base, content);
  }

  async createDir(path: string, base: BaseDir, recursive: boolean = true): Promise<void> {
    return await this.fs.createDir(path, base, recursive);
  }

  async deleteFile(path: string, base: BaseDir): Promise<void> {
    return await this.fs.removeFile(path, base);
  }

  async deleteDir(path: string, base: BaseDir, recursive: boolean = true): Promise<void> {
    return await this.fs.removeDir(path, base, recursive);
  }

  async resolveFilePath(path: string, base: BaseDir): Promise<string> {
    const prefix = await this.fs.getPrefix(base);
    return path ? `${prefix}/${path}` : prefix;
  }

  async readDirectory(path: string, base: BaseDir): Promise<FileItem[]> {
    return await this.fs.readDir(path, base);
  }

  async exists(path: string, base: BaseDir): Promise<boolean> {
    return await this.fs.exists(path, base);
  }

  async getImageURL(path: string): Promise<string> {
    return await this.fs.getImageURL(path);
  }

  getCoverImageUrl = (book: Book): string => {
    return this.fs.getURL(`${this.localBooksDir}/${getCoverFilename(book)}`);
  };

  getCoverImageBlobUrl = async (book: Book): Promise<string> => {
    return this.fs.getBlobURL(`${this.localBooksDir}/${getCoverFilename(book)}`, 'None');
  };

  async getCachedImageUrl(pathOrUrl: string): Promise<string> {
    const cachedKey = `img_${md5(pathOrUrl)}`;
    const cachePrefix = await this.fs.getPrefix('Cache');
    const cachedPath = `${cachePrefix}/${cachedKey}`;
    if (await this.fs.exists(cachedPath, 'None')) {
      return await this.fs.getImageURL(cachedPath);
    } else {
      const file = await this.fs.openFile(pathOrUrl, 'None');
      await this.fs.writeFile(cachedKey, 'Cache', await file.arrayBuffer());
      return await this.fs.getImageURL(cachedPath);
    }
  }

  getDefaultViewSettings(): ViewSettings {
    return {
      ...DEFAULT_BOOK_LAYOUT,
      ...DEFAULT_BOOK_STYLE,
      ...DEFAULT_BOOK_FONT,
      ...DEFAULT_BOOK_LANGUAGE,
      ...(this.isMobile ? DEFAULT_MOBILE_VIEW_SETTINGS : {}),
      ...(isCJKEnv() ? DEFAULT_CJK_VIEW_SETTINGS : {}),
      ...DEFAULT_VIEW_CONFIG,
      ...DEFAULT_TTS_CONFIG,
      ...DEFAULT_SCREEN_CONFIG,
      ...DEFAULT_ANNOTATOR_CONFIG,
      ...{ ...DEFAULT_TRANSLATOR_CONFIG, translateTargetLang: getTargetLang() },
    };
  }

  async loadSettings(): Promise<SystemSettings> {
    const defaultSettings: SystemSettings = {
      ...DEFAULT_SYSTEM_SETTINGS,
      ...(this.isMobile ? DEFAULT_MOBILE_SYSTEM_SETTINGS : {}),
      version: SYSTEM_SETTINGS_VERSION,
      localBooksDir: await this.fs.getPrefix('Books'),
      koreaderSyncDeviceId: uuidv4(),
      globalReadSettings: {
        ...DEFAULT_READSETTINGS,
        ...(this.isMobile ? DEFAULT_MOBILE_READSETTINGS : {}),
      },
      globalViewSettings: this.getDefaultViewSettings(),
    } as SystemSettings;

    let settings = await this.safeLoadJSON<SystemSettings>(
      SETTINGS_FILENAME,
      'Settings',
      defaultSettings,
    );

    const version = settings.version ?? 0;
    if (this.isAppDataSandbox || version < SYSTEM_SETTINGS_VERSION) {
      settings.version = SYSTEM_SETTINGS_VERSION;
    }
    settings = {
      ...DEFAULT_SYSTEM_SETTINGS,
      ...(this.isMobile ? DEFAULT_MOBILE_SYSTEM_SETTINGS : {}),
      ...settings,
    };
    settings.globalReadSettings = {
      ...DEFAULT_READSETTINGS,
      ...(this.isMobile ? DEFAULT_MOBILE_READSETTINGS : {}),
      ...settings.globalReadSettings,
    };
    settings.globalViewSettings = {
      ...this.getDefaultViewSettings(),
      ...settings.globalViewSettings,
    };

    settings.localBooksDir = await this.fs.getPrefix('Books');

    if (!settings.kosync.deviceId) {
      settings.kosync.deviceId = uuidv4();
      await this.saveSettings(settings);
    }

    this.localBooksDir = settings.localBooksDir;
    return settings;
  }

  async saveSettings(settings: SystemSettings): Promise<void> {
    await this.safeSaveJSON(SETTINGS_FILENAME, 'Settings', settings);
  }

  async importFont(file?: string | File): Promise<CustomFontInfo | null> {
    let fontPath: string;
    let fontFile: File;
    if (typeof file === 'string') {
      const filePath = file;
      const fileobj = await this.fs.openFile(filePath, 'None');
      fontPath = fileobj.name || getFilename(filePath);
      await this.fs.copyFile(filePath, fontPath, 'Fonts');
      fontFile = await this.fs.openFile(fontPath, 'Fonts');
    } else if (file) {
      fontPath = getFilename(file.name);
      await this.fs.writeFile(fontPath, 'Fonts', file);
      fontFile = file;
    } else {
      return null;
    }

    return {
      path: fontPath,
      ...parseFontInfo(await fontFile.arrayBuffer(), fontPath),
    };
  }

  async deleteFont(font: CustomFont): Promise<void> {
    await this.fs.removeFile(font.path, 'Fonts');
  }

  async importImage(file?: string | File): Promise<CustomTextureInfo | null> {
    let imagePath: string;
    if (typeof file === 'string') {
      const filePath = file;
      const fileobj = await this.fs.openFile(filePath, 'None');
      imagePath = fileobj.name || getFilename(filePath);
      await this.fs.copyFile(filePath, imagePath, 'Images');
    } else if (file) {
      imagePath = getFilename(file.name);
      await this.fs.writeFile(imagePath, 'Images', file);
    } else {
      return null;
    }

    return {
      name: imagePath.replace(/\.[^/.]+$/, ''),
      path: imagePath,
    };
  }

  async deleteImage(texture: CustomTextureInfo): Promise<void> {
    await this.fs.removeFile(texture.path, 'Images');
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
        if (/\.txt$/i.test(filename)) {
          const txt2epub = new TxtToEpubConverter();
          ({ file: fileobj } = await txt2epub.convert({ file: fileobj }));
        }
        if (!fileobj || fileobj.size === 0) {
          throw new Error('Invalid or empty book file');
        }
        ({ book: loadedBook, format } = await new DocumentLoader(fileobj).open());
        if (!loadedBook) {
          throw new Error('Unsupported or corrupted book file');
        }
        const metadataTitle = formatTitle(loadedBook.metadata.title);
        if (!metadataTitle || !metadataTitle.trim() || metadataTitle === filename) {
          loadedBook.metadata.title = getBaseFilename(filename);
        }
      } catch (error) {
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

      const primaryLanguage = getPrimaryLanguage(loadedBook.metadata.language);
      const book: Book = {
        hash,
        format,
        title: formatTitle(loadedBook.metadata.title),
        sourceTitle: formatTitle(loadedBook.metadata.title),
        primaryLanguage,
        author: formatAuthors(loadedBook.metadata.author, primaryLanguage),
        createdAt: existingBook ? existingBook.createdAt : Date.now(),
        uploadedAt: existingBook ? existingBook.uploadedAt : null,
        deletedAt: transient ? Date.now() : null,
        downloadedAt: Date.now(),
        updatedAt: Date.now(),
      };
      // update book metadata when reimporting the same book
      if (existingBook) {
        existingBook.format = book.format;
        existingBook.title = existingBook.title.trim() ? existingBook.title.trim() : book.title;
        existingBook.sourceTitle = existingBook.sourceTitle ?? book.sourceTitle;
        existingBook.author = existingBook.author ?? book.author;
        existingBook.primaryLanguage = existingBook.primaryLanguage ?? book.primaryLanguage;
        existingBook.downloadedAt = Date.now();
      }

      if (!(await this.fs.exists(getDir(book), 'Books'))) {
        await this.fs.createDir(getDir(book), 'Books');
      }
      const bookFilename = getLocalBookFilename(book);
      if (saveBook && !transient && (!(await this.fs.exists(bookFilename, 'Books')) || overwrite)) {
        if (/\.txt$/i.test(filename)) {
          await this.fs.writeFile(bookFilename, 'Books', fileobj);
        } else if (typeof file === 'string' && isContentURI(file)) {
          await this.fs.copyFile(file, bookFilename, 'Books');
        } else if (typeof file === 'string' && !isValidURL(file)) {
          try {
            // try to copy the file directly first in case of large files to avoid memory issues
            // on desktop when reading recursively from selected directory the direct copy will fail
            // due to permission issues, then fallback to read and write files
            await this.fs.copyFile(file, bookFilename, 'Books');
          } catch {
            await this.fs.writeFile(bookFilename, 'Books', await fileobj.arrayBuffer());
          }
        } else {
          await this.fs.writeFile(bookFilename, 'Books', fileobj);
        }
      }
      if (saveCover && (!(await this.fs.exists(getCoverFilename(book), 'Books')) || overwrite)) {
        let cover = await loadedBook.getCover();
        if (cover?.type === 'image/svg+xml') {
          try {
            console.log('Converting SVG cover to PNG...');
            cover = await svg2png(cover);
          } catch {}
        }
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

      return existingBook || book;
    } catch (error) {
      console.error('Error importing book:', error);
      throw error;
    }
  }

  async deleteBook(book: Book, deleteAction: DeleteAction): Promise<void> {
    console.log('Deleting book with action:', deleteAction, book.title);
    if (deleteAction === 'local' || deleteAction === 'both') {
      const localDeleteFps =
        deleteAction === 'local'
          ? [getLocalBookFilename(book)]
          : [getLocalBookFilename(book), getCoverFilename(book)];
      for (const fp of localDeleteFps) {
        if (await this.fs.exists(fp, 'Books')) {
          await this.fs.removeFile(fp, 'Books');
        }
      }
      if (deleteAction === 'local') {
        book.downloadedAt = null;
      } else {
        book.deletedAt = Date.now();
        book.downloadedAt = null;
        book.coverDownloadedAt = null;
      }
    }
    if ((deleteAction === 'cloud' || deleteAction === 'both') && book.uploadedAt) {
      const fps = [getRemoteBookFilename(book), getCoverFilename(book)];
      for (const fp of fps) {
        console.log('Deleting uploaded file:', fp);
        const cfp = `${CLOUD_BOOKS_SUBDIR}/${fp}`;
        try {
          deleteFile(cfp);
        } catch (error) {
          console.log('Failed to delete uploaded file:', error);
        }
      }
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
      book.coverDownloadedAt = Date.now();
    } else {
      throw new Error('Book file not uploaded');
    }
  }

  async downloadCloudFile(lfp: string, cfp: string, onProgress: ProgressHandler) {
    console.log('Downloading file:', cfp, 'to', lfp);
    const dstPath = `${this.localBooksDir}/${lfp}`;
    await downloadFile({ appService: this, cfp, dst: dstPath, onProgress });
  }

  async downloadBookCovers(books: Book[]): Promise<void> {
    const booksLfps = new Map(
      books.map((book) => {
        const lfp = getCoverFilename(book);
        return [lfp, book];
      }),
    );
    const filePaths = books.map((book) => ({
      lfp: getCoverFilename(book),
      cfp: `${CLOUD_BOOKS_SUBDIR}/${getCoverFilename(book)}`,
    }));
    const downloadUrls = await batchGetDownloadUrls(filePaths);
    await Promise.all(
      books.map(async (book) => {
        if (!(await this.fs.exists(getDir(book), 'Books'))) {
          await this.fs.createDir(getDir(book), 'Books');
        }
      }),
    );
    await Promise.all(
      downloadUrls.map(async (file) => {
        try {
          const dst = `${this.localBooksDir}/${file.lfp}`;
          if (!file.downloadUrl) return;
          await downloadFile({ appService: this, dst, cfp: file.cfp, url: file.downloadUrl });
          const book = booksLfps.get(file.lfp);
          if (book && !book.coverDownloadedAt) {
            book.coverDownloadedAt = Date.now();
          }
        } catch (error) {
          console.log(`Failed to download cover file for book: '${file.lfp}'`, error);
        }
      }),
    );
  }

  async downloadBook(
    book: Book,
    onlyCover = false,
    redownload = false,
    onProgress?: ProgressHandler,
  ): Promise<void> {
    let bookDownloaded = false;
    let bookCoverDownloaded = false;
    const completedFiles = { count: 0 };
    let toDownloadFpCount = 0;
    const needDownCover = !(await this.fs.exists(getCoverFilename(book), 'Books')) || redownload;
    const needDownBook =
      (!onlyCover && !(await this.fs.exists(getLocalBookFilename(book), 'Books'))) || redownload;
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
        bookCoverDownloaded = true;
      }
    } catch (error) {
      // don't throw error here since some books may not have cover images at all
      console.log(`Failed to download cover file for book: '${book.title}'`, error);
    } finally {
      if (needDownCover) {
        completedFiles.count++;
      }
    }

    if (needDownBook) {
      const lfp = getLocalBookFilename(book);
      const cfp = `${CLOUD_BOOKS_SUBDIR}/${getRemoteBookFilename(book)}`;
      await this.downloadCloudFile(lfp, cfp, handleProgress);
      const localFullpath = `${this.localBooksDir}/${lfp}`;
      bookDownloaded = await this.fs.exists(localFullpath, 'None');
      completedFiles.count++;
    }
    // some books may not have cover image, so we need to check if the book is downloaded
    if (bookDownloaded || (!onlyCover && !needDownBook)) {
      book.downloadedAt = Date.now();
    }
    if ((bookCoverDownloaded || !needDownCover) && !book.coverDownloadedAt) {
      book.coverDownloadedAt = Date.now();
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

  async loadBookContent(book: Book): Promise<BookContent> {
    let file: File;
    const fp = getLocalBookFilename(book);
    if (await this.fs.exists(fp, 'Books')) {
      file = await this.fs.openFile(fp, 'Books');
    } else if (book.filePath) {
      file = await this.fs.openFile(book.filePath, 'None');
    } else if (book.url) {
      file = await this.fs.openFile(book.url, 'None');
    } else {
      // 0.9.64 has a bug that book.title might be modified but the filename is not updated
      const bookDir = getDir(book);
      const files = await this.fs.readDir(getDir(book), 'Books');
      if (files.length > 0) {
        const bookFile = files.find((f) => f.path.endsWith(`.${EXTS[book.format]}`));
        if (bookFile) {
          file = await this.fs.openFile(`${bookDir}/${bookFile.path}`, 'Books');
        } else {
          throw new Error(BOOK_FILE_NOT_FOUND_ERROR);
        }
      } else {
        throw new Error(BOOK_FILE_NOT_FOUND_ERROR);
      }
    }
    return { book, file };
  }

  async loadBookConfig(book: Book, settings: SystemSettings): Promise<BookConfig> {
    const globalViewSettings = {
      ...settings.globalViewSettings,
      ...(FIXED_LAYOUT_FORMATS.has(book.format) ? DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS : {}),
    };
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

  async fetchBookDetails(book: Book) {
    const fp = getLocalBookFilename(book);
    if (!(await this.fs.exists(fp, 'Books')) && book.uploadedAt) {
      await this.downloadBook(book);
    }
    const { file } = await this.loadBookContent(book);
    const bookDoc = (await new DocumentLoader(file).open()).book;
    const f = file as ClosableFile;
    if (f && f.close) {
      await f.close();
    }
    return bookDoc.metadata;
  }

  async saveBookConfig(book: Book, config: BookConfig, settings?: SystemSettings) {
    let serializedConfig: string;
    if (settings) {
      const globalViewSettings = {
        ...settings.globalViewSettings,
        ...(FIXED_LAYOUT_FORMATS.has(book.format) ? DEFAULT_FIXED_LAYOUT_VIEW_SETTINGS : {}),
      };
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
    const libraryFilename = getLibraryFilename();

    if (!(await this.fs.exists('', 'Books'))) {
      await this.fs.createDir('', 'Books', true);
    }

    const books = await this.safeLoadJSON<Book[]>(libraryFilename, 'Books', []);

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
    await this.safeSaveJSON(getLibraryFilename(), 'Books', libraryBooks);
  }

  private imageToArrayBuffer(imageUrl?: string, imageFile?: string): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      if (!imageUrl && !imageFile) {
        reject(new Error('No image URL or file provided'));
        return;
      }
      if (this.appPlatform === 'web' && imageUrl && imageUrl.startsWith('blob:')) {
        fetch(imageUrl)
          .then((response) => response.arrayBuffer())
          .then((buffer) => resolve(buffer))
          .catch((error) => reject(error));
      } else if (this.appPlatform === 'tauri' && imageFile) {
        this.fs
          .openFile(imageFile, 'None')
          .then((file) => file.arrayBuffer())
          .then((buffer) => resolve(buffer))
          .catch((error) => reject(error));
      } else if (this.appPlatform === 'tauri' && imageUrl) {
        tauriFetch(imageUrl, { method: 'GET' })
          .then((response) => response.arrayBuffer())
          .then((buffer) => resolve(buffer))
          .catch((error) => reject(error));
      } else {
        reject(new Error('Unsupported platform or missing image data'));
      }
    });
  }

  async updateCoverImage(book: Book, imageUrl?: string, imageFile?: string): Promise<void> {
    if (imageUrl === '_blank') {
      await this.fs.removeFile(getCoverFilename(book), 'Books');
    } else if (imageUrl || imageFile) {
      const arrayBuffer = await this.imageToArrayBuffer(imageUrl, imageFile);
      await this.fs.writeFile(getCoverFilename(book), 'Books', arrayBuffer);
    }
  }

  private async loadJSONFile(
    path: string,
    base: BaseDir,
  ): Promise<{ success: boolean; data?: unknown; error?: unknown }> {
    try {
      const txt = await this.fs.readFile(path, base, 'text');
      if (!txt || typeof txt !== 'string' || txt.trim().length === 0) {
        return { success: false, error: 'File is empty or invalid' };
      }
      try {
        const data = JSON.parse(txt as string);
        return { success: true, data };
      } catch (parseError) {
        return { success: false, error: `JSON parse error: ${parseError}` };
      }
    } catch (error) {
      return { success: false, error };
    }
  }

  /**
   * Safely loads a JSON file with automatic backup fallback.
   * If the main file is corrupted, attempts to load from backup.
   * @param filename - The name of the file to load (without .bak extension)
   * @param base - The base directory
   * @param defaultValue - Default value to return if both files fail
   */
  private async safeLoadJSON<T>(filename: string, base: BaseDir, defaultValue: T): Promise<T> {
    const backupFilename = `${filename}.bak`;

    // Try loading main file
    const mainResult = await this.loadJSONFile(filename, base);
    if (mainResult.success) {
      return mainResult.data as T;
    }

    console.warn(`Failed to load ${filename}, attempting backup...`, mainResult.error);

    // Try loading backup file
    const backupResult = await this.loadJSONFile(backupFilename, base);
    if (backupResult.success) {
      console.warn(`Loaded from backup: ${backupFilename}`);
      // Restore the main file from backup
      try {
        const backupData = JSON.stringify(backupResult.data, null, 2);
        await this.fs.writeFile(filename, base, backupData);
        console.log(`Restored ${filename} from backup`);
      } catch (error) {
        console.error(`Failed to restore ${filename} from backup:`, error);
      }
      return backupResult.data as T;
    }

    console.error(`Both ${filename} and ${backupFilename} failed to load`);
    return defaultValue;
  }

  /**
   * Safely saves a JSON file with atomic write using backup strategy.
   * Strategy: write to backup first, then to main file.
   * This ensures at least one valid copy exists at all times.
   * @param filename - The name of the file to save (without .bak extension)
   * @param base - The base directory
   * @param data - The data to save
   */
  private async safeSaveJSON(filename: string, base: BaseDir, data: unknown): Promise<void> {
    const backupFilename = `${filename}.bak`;
    const jsonData = JSON.stringify(data, null, 2);

    // Strategy: Always write to backup first, then to main file
    // This ensures we always have at least one valid copy
    try {
      // Step 1: Write to backup file
      await this.fs.writeFile(backupFilename, base, jsonData);

      // Step 2: Write to main file
      await this.fs.writeFile(filename, base, jsonData);
    } catch (error) {
      console.error(`Failed to save ${filename}:`, error);
      throw new Error(`Failed to save ${filename}: ${error}`);
    }
  }

  private async migrate20251124(): Promise<void> {
    console.log('Running migration for version 20251124 to rename the backup library file...');
    const oldBackupFilename = getLibraryBackupFilename();
    const newBackupFilename = `${getLibraryFilename()}.bak`;
    if (await this.fs.exists(oldBackupFilename, 'Books')) {
      try {
        const content = await this.fs.readFile(oldBackupFilename, 'Books', 'text');
        await this.fs.writeFile(newBackupFilename, 'Books', content);
        await this.fs.removeFile(oldBackupFilename, 'Books');
        console.log('Migration to rename backup library file completed successfully.');
      } catch (error) {
        console.error('Error during migration to rename backup library file:', error);
      }
    }
  }
}
