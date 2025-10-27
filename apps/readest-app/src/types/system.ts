import { SystemSettings } from './settings';
import { Book, BookConfig, BookContent, ViewSettings } from './book';
import { BookMetadata } from '@/libs/document';
import { ProgressHandler } from '@/utils/transfer';
import { CustomFont, CustomFontInfo } from '@/styles/fonts';
import { CustomTextureInfo } from '@/styles/textures';

export type AppPlatform = 'web' | 'tauri';
export type OsPlatform = 'android' | 'ios' | 'macos' | 'windows' | 'linux' | 'unknown';
// prettier-ignore
export type BaseDir = | 'Books' | 'Settings' | 'Data' | 'Fonts' | 'Images' | 'Log' | 'Cache' | 'Temp' | 'None';
export type DeleteAction = 'cloud' | 'local' | 'both';
export type SelectDirectoryMode = 'read' | 'write';
export type DistChannel = 'readest' | 'playstore' | 'appstore' | 'unknown';

export type ResolvedPath = {
  baseDir: number;
  basePrefix: () => Promise<string>;
  fp: string;
  base: BaseDir;
};

export type FileItem = {
  path: string;
  size: number;
};

export interface FileSystem {
  resolvePath(path: string, base: BaseDir): ResolvedPath;
  getURL(path: string): string;
  getBlobURL(path: string, base: BaseDir): Promise<string>;
  openFile(path: string, base: BaseDir, filename?: string): Promise<File>;
  copyFile(srcPath: string, dstPath: string, base: BaseDir): Promise<void>;
  readFile(path: string, base: BaseDir, mode: 'text' | 'binary'): Promise<string | ArrayBuffer>;
  writeFile(path: string, base: BaseDir, content: string | ArrayBuffer | File): Promise<void>;
  removeFile(path: string, base: BaseDir): Promise<void>;
  readDir(path: string, base: BaseDir): Promise<FileItem[]>;
  createDir(path: string, base: BaseDir, recursive?: boolean): Promise<void>;
  removeDir(path: string, base: BaseDir, recursive?: boolean): Promise<void>;
  exists(path: string, base: BaseDir): Promise<boolean>;
  getPrefix(base: BaseDir): Promise<string>;
}

export interface AppService {
  osPlatform: OsPlatform;
  appPlatform: AppPlatform;
  hasTrafficLight: boolean;
  hasWindow: boolean;
  hasWindowBar: boolean;
  hasContextMenu: boolean;
  hasRoundedWindow: boolean;
  hasSafeAreaInset: boolean;
  hasHaptics: boolean;
  hasUpdater: boolean;
  hasOrientationLock: boolean;
  hasScreenBrightness: boolean;
  hasIAP: boolean;
  isMobile: boolean;
  isAppDataSandbox: boolean;
  isMobileApp: boolean;
  isAndroidApp: boolean;
  isIOSApp: boolean;
  isMacOSApp: boolean;
  isLinuxApp: boolean;
  isPortableApp: boolean;
  isDesktopApp: boolean;
  canCustomizeRootDir: boolean;
  distChannel: DistChannel;

  init(): Promise<void>;
  openFile(path: string, base: BaseDir): Promise<File>;
  copyFile(srcPath: string, dstPath: string, base: BaseDir): Promise<void>;
  writeFile(path: string, base: BaseDir, content: string | ArrayBuffer | File): Promise<void>;
  createDir(path: string, base: BaseDir, recursive?: boolean): Promise<void>;
  deleteFile(path: string, base: BaseDir): Promise<void>;
  deleteDir(path: string, base: BaseDir, recursive?: boolean): Promise<void>;

  setCustomRootDir(customRootDir: string): Promise<void>;
  resolveFilePath(path: string, base: BaseDir): Promise<string>;
  getCachedImageUrl(pathOrUrl: string): Promise<string>;
  selectDirectory(mode: SelectDirectoryMode): Promise<string>;
  selectFiles(name: string, extensions: string[]): Promise<string[]>;
  readDirectory(path: string, base: BaseDir): Promise<FileItem[]>;

  getDefaultViewSettings(): ViewSettings;
  loadSettings(): Promise<SystemSettings>;
  saveSettings(settings: SystemSettings): Promise<void>;
  importFont(file?: string | File): Promise<CustomFontInfo | null>;
  deleteFont(font: CustomFont): Promise<void>;
  importImage(file?: string | File): Promise<CustomTextureInfo | null>;
  deleteImage(texture: CustomTextureInfo): Promise<void>;
  importBook(
    file: string | File,
    books: Book[],
    saveBook?: boolean,
    saveCover?: boolean,
    overwrite?: boolean,
    transient?: boolean,
  ): Promise<Book | null>;
  deleteBook(book: Book, deleteAction: DeleteAction): Promise<void>;
  uploadBook(book: Book, onProgress?: ProgressHandler): Promise<void>;
  downloadBook(
    book: Book,
    onlyCover?: boolean,
    redownload?: boolean,
    onProgress?: ProgressHandler,
  ): Promise<void>;
  downloadBookCovers(books: Book[], redownload?: boolean): Promise<void>;
  isBookAvailable(book: Book): Promise<boolean>;
  getBookFileSize(book: Book): Promise<number | null>;
  loadBookConfig(book: Book, settings: SystemSettings): Promise<BookConfig>;
  fetchBookDetails(book: Book, settings: SystemSettings): Promise<BookMetadata>;
  saveBookConfig(book: Book, config: BookConfig, settings?: SystemSettings): Promise<void>;
  loadBookContent(book: Book, settings: SystemSettings): Promise<BookContent>;
  loadLibraryBooks(): Promise<Book[]>;
  saveLibraryBooks(books: Book[]): Promise<void>;
  getCoverImageUrl(book: Book): string;
  getCoverImageBlobUrl(book: Book): Promise<string>;
  generateCoverImageUrl(book: Book): Promise<string>;
  updateCoverImage(book: Book, imageUrl?: string, imageFile?: string): Promise<void>;
}
